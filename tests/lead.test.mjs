// /api/lead — website enquiries: validation, storage, CRM hand-off, guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

process.env.PASSPORT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pp-lead-test-"));
process.env.PASSPORT_ADMIN_KEY = "test-key";
for (const name of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RESEND_API_KEY", "PASSPORT_NOTIFY_TO", "CRM_WEBHOOK_URL", "CRM_WEBHOOK_SECRET", "VERCEL"]) {
  delete process.env[name];
}

const leadRoute = (await import("../api/lead.js")).default;
const adminActivity = (await import("../api/admin/activity.js")).default;
const ADMIN = { "x-passport-key": "test-key" };

function call(handler, { method = "POST", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(raw ? [Buffer.from(raw)] : []);
    req.method = method;
    req.url = "/api/lead";
    req.query = {};
    req.socket = { remoteAddress: "127.0.0.1" };
    req.headers = {
      host: "localhost:8000",
      ...(body !== undefined ? { "content-type": "application/json", origin: "http://localhost:8000" } : {}),
      ...headers,
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        resolve({ status: this.statusCode, body: chunk ? JSON.parse(chunk) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

const demo = () => ({
  kind: "demo",
  requestKey: randomUUID(),
  fullName: "Dr Priya Shah",
  email: "Priya@Example.com",
  phone: "07700 900321",
  practice: "Kensington Dental Studio",
  profession: "Dentistry",
  postcode: "W8 5NP",
  magnificationInterest: "3.5×",
  preferredContact: "Phone",
  message: "Mornings are best for a demo.",
});

const quote = () => ({
  kind: "quote",
  requestKey: randomUUID(),
  name: "Mr Tom Okafor",
  email: "tom@example.com",
  phone: "+44 7700 900654",
  practice: "St Bede's Hospital",
  configuration: { colour: "Black", magnification: "3.5×", lenses: "Yes", light: "Wireless LED", use: "Medical practice" },
});

async function activityList() {
  const res = await call(adminActivity, { method: "GET", headers: ADMIN });
  return res.body.activity;
}

test("a demonstration request is stored and shows in the manager as a website enquiry", async () => {
  const res = await call(leadRoute, { body: demo() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, stored: true, crm: "unconfigured" });

  const items = await activityList();
  const item = items.find((a) => a.kind === "enquiry" && a.topic === "Demonstration request");
  assert.ok(item, "enquiry listed");
  assert.equal(item.name, "Dr Priya Shah");
  assert.equal(item.email, "priya@example.com");
  assert.equal(item.profession, "Dentistry");
  assert.equal(item.postcode, "W8 5NP");
  assert.equal(item.passport_name, "Website");
  assert.equal(item.passport_id, "website");
  assert.equal(item.status, "open");
  assert.equal(item.crm_status, "unconfigured");
  assert.deepEqual(item.details, { magnification_interest: "3.5×", preferred_contact: "Phone" });
});

test("a quote request keeps the configuration", async () => {
  const res = await call(leadRoute, { body: quote() });
  assert.equal(res.status, 200);
  const item = (await activityList()).find((a) => a.topic === "Quote request");
  assert.ok(item);
  assert.equal(item.name, "Mr Tom Okafor");
  assert.equal(item.practice, "St Bede's Hospital");
  assert.deepEqual(item.details, { colour: "Black", magnification: "3.5×", lenses: "Yes", light: "Wireless LED", use: "Medical practice" });
});

test("every field is validated on the server", async () => {
  const bad = async (body, field) => {
    const res = await call(leadRoute, { body });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    if (field) assert.equal(res.body.field, field);
  };
  await bad({ ...demo(), profession: "Plumber" }, "profession");
  await bad({ ...demo(), phone: "" }, "phone");
  await bad({ ...demo(), phone: "call me" }, "phone");
  await bad({ ...demo(), email: "not-an-email" }, "email");
  await bad({ ...demo(), postcode: "" }, "postcode");
  await bad({ ...demo(), magnificationInterest: "9×" }, "magnificationInterest");
  await bad({ ...quote(), configuration: { ...quote().configuration, magnification: "10×" } }, "magnification");
  await bad({ ...quote(), configuration: "Black" }, "colour");
  await bad({ ...demo(), kind: "newsletter" });
  await bad({ ...demo(), website: "http://spam.example" });
  await bad({ ...demo(), requestKey: "x" });
});

test("guards: same-origin, method, per-IP limit", async () => {
  assert.equal((await call(leadRoute, { body: demo(), headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(leadRoute, { method: "GET" })).status, 405);
  let limited = null;
  for (let i = 0; i < 12 && !limited; i++) {
    const res = await call(leadRoute, { body: demo(), headers: { "x-forwarded-for": "198.51.100.7" } });
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, "the hourly per-IP limit kicks in");
});

test("duplicate request keys are accepted once", async () => {
  const body = demo();
  const before = (await activityList()).length;
  assert.equal((await call(leadRoute, { body, headers: { "x-forwarded-for": "203.0.113.50" } })).status, 200);
  const again = await call(leadRoute, { body, headers: { "x-forwarded-for": "203.0.113.50" } });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal((await activityList()).length, before + 1);
});

test("enquiries are forwarded to the CRM with the secret, and failures never block the customer", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  process.env.CRM_WEBHOOK_URL = "https://crm.example/api/webhooks/website";
  process.env.CRM_WEBHOOK_SECRET = "s3cret";
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202, json: async () => ({}) };
    };
    const res = await call(leadRoute, { body: demo(), headers: { "x-forwarded-for": "203.0.113.60" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.crm, "sent");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://crm.example/api/webhooks/website");
    assert.equal(calls[0].init.headers.Authorization, "Bearer s3cret");
    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.source, "pentaxloupes.co.uk");
    assert.equal(payload.event, "enquiry");
    assert.equal(payload.topic, "Demonstration request");
    assert.equal(payload.name, "Dr Priya Shah");
    assert.equal(payload.email, "priya@example.com");
    assert.equal(payload.passport, null);
    assert.deepEqual(payload.details, { magnification_interest: "3.5×", preferred_contact: "Phone" });
    const stored = (await activityList()).find((a) => a.id === payload.id);
    assert.equal(stored.crm_status, "sent");

    globalThis.fetch = async () => {
      throw new Error("connection refused");
    };
    const failed = await call(leadRoute, { body: quote(), headers: { "x-forwarded-for": "203.0.113.61" } });
    assert.equal(failed.status, 200, "the customer still gets a success");
    assert.equal(failed.body.crm, "failed");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_SECRET;
  }
});

test("without storage: forwarded to the CRM when configured, otherwise a clear 503", async () => {
  const saved = process.env.PASSPORT_DATA_DIR;
  const realFetch = globalThis.fetch;
  delete process.env.PASSPORT_DATA_DIR;
  process.env.VERCEL = "1";
  try {
    const none = await call(leadRoute, { body: demo() });
    assert.equal(none.status, 503);
    assert.equal(none.body.code, "unconfigured");

    process.env.CRM_WEBHOOK_URL = "https://crm.example/api/webhooks/website";
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const sent = await call(leadRoute, { body: demo() });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { ok: true, stored: false, crm: "sent" });
  } finally {
    globalThis.fetch = realFetch;
    process.env.PASSPORT_DATA_DIR = saved;
    delete process.env.VERCEL;
    delete process.env.CRM_WEBHOOK_URL;
  }
});
