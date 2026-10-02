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
for (const name of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RESEND_API_KEY", "PASSPORT_NOTIFY_TO", "CRM_WEBHOOK_URL", "CRM_WEBHOOK_SECRET", "WEBSITE_WEBHOOK_SECRET", "SMTP_HOST", "VERCEL"]) {
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
  assert.equal((await call(leadRoute, { method: "DELETE" })).status, 405);
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

test("enquiries reach the CRM as signed structured leads, and failures never block the customer", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  process.env.CRM_WEBHOOK_URL = "https://pentax-crm.example/api/ingest/webhook";
  process.env.CRM_WEBHOOK_SECRET = "s3cret";
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ status: "created", leadId: "uuid", reference: "PL-001042" }) };
    };
    const res = await call(leadRoute, { body: demo(), headers: { "x-forwarded-for": "203.0.113.60" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.crm, "sent");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://pentax-crm.example/api/ingest/webhook");

    // Signed exactly the way the CRM verifies it: hex HMAC-SHA256 over the raw body.
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", "s3cret").update(calls[0].init.body, "utf8").digest("hex");
    assert.equal(calls[0].init.headers["X-Pentax-Signature"], expected);
    assert.equal(calls[0].init.headers.Authorization, undefined);

    const payload = JSON.parse(calls[0].init.body);
    assert.match(payload.message_id, /^website:[0-9a-f-]{36}$/);
    assert.equal(payload.lead.full_name, "Dr Priya Shah");
    assert.equal(payload.lead.email, "priya@example.com");
    assert.equal(payload.lead.phone, "07700 900321");
    assert.equal(payload.lead.postcode, "W8 5NP");
    assert.equal(payload.lead.practice_name, "Kensington Dental Studio");
    assert.equal(payload.lead.profession, "Dentistry");
    assert.equal(payload.lead.country, "GB");
    assert.equal(payload.lead.source_key, "website");
    assert.match(payload.lead.enquiry_details, /Demonstration request via the website form/);
    assert.match(payload.lead.enquiry_details, /Magnification interest: 3\.5×/);
    assert.match(payload.lead.enquiry_details, /Message: Mornings are best for a demo\./);

    const stored = (await activityList()).find((a) => `website:${a.id}` === payload.message_id);
    assert.equal(stored.crm_status, "sent");
    assert.equal(stored.crm_outcome, "created");
    assert.equal(stored.crm_reference, "PL-001042");

    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Invalid signature" }) });
    const rejected = await call(leadRoute, { body: quote(), headers: { "x-forwarded-for": "203.0.113.61" } });
    assert.equal(rejected.status, 200, "the customer still gets a success");
    assert.equal(rejected.body.crm, "failed");
    const failedItem = (await activityList()).find((a) => a.topic === "Quote request" && a.crm_status === "failed");
    assert.equal(failedItem.crm_error, "Invalid signature");

    globalThis.fetch = async () => {
      throw new Error("connection refused");
    };
    const down = await call(leadRoute, { body: quote(), headers: { "x-forwarded-for": "203.0.113.62" } });
    assert.equal(down.status, 200);
    assert.equal(down.body.crm, "failed");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_SECRET;
  }
});

test("submitting beside the statement records the agreement, with the words the server holds, and sends it to the CRM", async () => {
  const { CONSENT_STATEMENTS, CONSENT_VERSION } = await import("../lib/passport/leads.js");
  const realFetch = globalThis.fetch;
  const sent = [];
  process.env.CRM_WEBHOOK_URL = "https://pentax-crm.example/api/ingest/webhook";
  process.env.CRM_WEBHOOK_SECRET = "s3cret";
  try {
    globalThis.fetch = async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ status: "created", reference: "PL-001043" }) };
    };
    const agreed = await call(leadRoute, { body: { ...demo(), consent: CONSENT_VERSION }, headers: { "x-forwarded-for": "203.0.113.80" } });
    assert.equal(agreed.status, 200);
    assert.equal(sent[0].lead.whatsapp_consent, "yes");
    assert.ok(sent[0].lead.whatsapp_consent_source.includes(CONSENT_STATEMENTS.demo), "the CRM is given the exact words shown");
    assert.match(sent[0].lead.whatsapp_consent_source, /^Website demonstration form, statement v1/);

    const asked = await call(leadRoute, { body: { ...quote(), consent: CONSENT_VERSION }, headers: { "x-forwarded-for": "203.0.113.81" } });
    assert.equal(asked.status, 200);
    assert.ok(sent[1].lead.whatsapp_consent_source.includes(CONSENT_STATEMENTS.quote));

    const stored = (await activityList()).find((a) => a.id === sent[0].message_id.replace("website:", ""));
    assert.deepEqual(stored.consent, { version: "v1", form: "demo", statement: CONSENT_STATEMENTS.demo });

    // A page that showed no statement (an older cached copy, a changed form), or a made-up version, records nothing.
    for (const [index, consent] of [[2, undefined], [3, ""], [4, "v0"], [5, "V1"], [6, "yes"], [7, true]]) {
      const res = await call(leadRoute, { body: { ...demo(), consent }, headers: { "x-forwarded-for": `203.0.113.${82 + index}` } });
      assert.equal(res.status, 200, String(consent));
      assert.equal("whatsapp_consent" in sent[index].lead, false, `consent ${JSON.stringify(consent)} is not an agreement`);
    }
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_SECRET;
  }
});

test("the words beside each submit button are the words the server records", async () => {
  const { CONSENT_STATEMENTS, CONSENT_VERSION } = await import("../lib/passport/leads.js");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const notes = [...html.matchAll(/<p class="consent-note" data-consent="([^"]*)">([\s\S]*?)<\/p>/g)].map((m) => ({
    version: m[1],
    text: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  }));
  assert.equal(notes.length, 2, "one statement beside each of the two forms");
  assert.ok(notes.every((n) => n.version === CONSENT_VERSION), "both pages show the version the server knows");
  for (const statement of Object.values(CONSENT_STATEMENTS)) {
    assert.equal(notes.filter((n) => n.text.startsWith(statement)).length, 1, `printed beside a button: ${statement}`);
  }
  for (const n of notes) {
    assert.match(n.text, /WhatsApp/);
    assert.ok(n.text.includes("PENTAX Loupes UK (Smooth Optics) may contact you"), "names the business customers know");
    assert.match(n.text, /STOP/);
  }
});

test("a quote request carries its postcode so the CRM can route it", async () => {
  const res = await call(leadRoute, { body: { ...quote(), postcode: "ne1 4lp" }, headers: { "x-forwarded-for": "203.0.113.70" } });
  assert.equal(res.status, 200);
  const item = (await activityList()).find((a) => a.topic === "Quote request" && a.postcode === "ne1 4lp");
  assert.ok(item, "postcode stored with the quote request");
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
    assert.deepEqual(none.body.detail, { storage: false, crm: "unconfigured", email: false, crm_result: "unconfigured", crm_reason: null });

    const status = await call(leadRoute, { method: "GET" });
    assert.equal(status.status, 200);
    assert.equal(status.body.ok, false);
    assert.equal(status.body.storage, false);
    assert.equal(status.body.crm, "unconfigured");
    assert.match(status.body.hint, /CRM_WEBHOOK_URL/);

    process.env.CRM_WEBHOOK_URL = "https://pentax-crm.example/api/ingest/webhook";
    process.env.CRM_WEBHOOK_SECRET = "s3cret";
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: "created" }) });
    const sent = await call(leadRoute, { body: demo() });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { ok: true, stored: false, crm: "sent" });
  } finally {
    globalThis.fetch = realFetch;
    process.env.PASSPORT_DATA_DIR = saved;
    delete process.env.VERCEL;
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_SECRET;
  }
});
