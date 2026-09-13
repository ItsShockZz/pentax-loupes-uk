// End-to-end checks of the passport API handlers against the file store,
// using the same (req, res) contract Vercel and scripts/dev-server.mjs provide.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

process.env.PASSPORT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pp-api-test-"));
process.env.PASSPORT_ADMIN_KEY = "test-key";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RESEND_API_KEY;

const passportRoute = (await import("../api/passport/[token].js")).default;
const inviteRoute = (await import("../api/invite/[token].js")).default;
const adminPassports = (await import("../api/admin/passports.js")).default;
const adminActivity = (await import("../api/admin/activity.js")).default;

const ADMIN = { "x-passport-key": "test-key" };

function call(handler, { method = "GET", query = {}, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(raw ? [Buffer.from(raw)] : []);
    req.method = method;
    req.url = "/api/test";
    req.query = query;
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
        resolve({ status: this.statusCode, body: chunk ? JSON.parse(chunk) : null, headers: this.headers });
      },
    };
    handler(req, res).catch(reject);
  });
}

const validPassport = {
  name: "Dr Alex Morgan",
  email: "Alex@Example.com",
  phone: "07700 900123",
  practice: "Riverside Dental",
  discipline: "Dentistry",
  magnification: "3.5",
  colour: "Black",
  light: "Wireless LED",
  lenses: "Yes",
  prescription: "Prescription insert",
  working_distance: "45",
  pupillary_distance: "64",
  fitted_at: "2026-09-04",
  fitted_by: "Puyan",
  reference: "",
  notes: "Prefers afternoon calls",
};

let issued;

test("example passport is public, sample-only and never stores anything", async () => {
  const res = await call(passportRoute, { query: { token: "example" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.passport.name, "Dr Alex Morgan");
  assert.equal(res.body.passport.example, true);
  assert.equal("email" in res.body.passport, false);
  assert.equal(res.headers["cache-control"], "no-store");

  const post = await call(passportRoute, {
    method: "POST",
    query: { token: "example" },
    body: { kind: "checkin", feeling: "good", requestKey: randomUUID() },
  });
  assert.equal(post.status, 200);
  assert.equal(post.body.example, true);
});

test("manager endpoints require the key", async () => {
  assert.equal((await call(adminPassports)).status, 401);
  assert.equal((await call(adminPassports, { headers: { "x-passport-key": "nope" } })).status, 401);
  assert.equal((await call(adminActivity)).status, 401);
  const ok = await call(adminPassports, { headers: ADMIN });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.passports, []);
  assert.equal(ok.body.storage.kind, "file");
});

test("issuing a passport validates fields and numbers the reference", async () => {
  const bad = await call(adminPassports, { method: "POST", headers: ADMIN, body: { ...validPassport, magnification: "9.0" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "magnification");

  const badDistance = await call(adminPassports, { method: "POST", headers: ADMIN, body: { ...validPassport, working_distance: "90" } });
  assert.equal(badDistance.status, 400);
  assert.equal(badDistance.body.field, "working_distance");

  const res = await call(adminPassports, { method: "POST", headers: ADMIN, body: validPassport });
  assert.equal(res.status, 201);
  issued = res.body.passport;
  assert.match(issued.token, /^[a-f0-9]{32}$/);
  assert.match(issued.referral_token, /^[a-f0-9]{32}$/);
  assert.notEqual(issued.token, issued.referral_token);
  assert.equal(issued.reference, "PX-0001");
  assert.equal(issued.email, "alex@example.com");
  assert.equal(issued.working_distance, 45);
  assert.equal(issued.active, 1);
});

test("customers see their setup but never contact details or notes", async () => {
  const res = await call(passportRoute, { query: { token: issued.token } });
  assert.equal(res.status, 200);
  const p = res.body.passport;
  assert.equal(p.name, "Dr Alex Morgan");
  assert.equal(p.magnification, "3.5");
  assert.equal(p.referral_token, issued.referral_token);
  for (const hidden of ["email", "phone", "notes", "token"]) assert.equal(hidden in p, false, hidden);

  assert.equal((await call(passportRoute, { query: { token: "0".repeat(32) } })).status, 404);
  assert.equal((await call(passportRoute, { query: { token: "not-a-token" } })).status, 404);
  assert.equal((await call(passportRoute, { query: { token: issued.referral_token } })).status, 404);
});

test("check-ins and support requests are recorded once per request key", async () => {
  const good = await call(passportRoute, {
    method: "POST",
    query: { token: issued.token },
    body: { kind: "checkin", feeling: "good", requestKey: randomUUID() },
  });
  assert.equal(good.status, 200);

  const helpKey = randomUUID();
  for (let i = 0; i < 2; i++) {
    const help = await call(passportRoute, {
      method: "POST",
      query: { token: issued.token },
      body: { kind: "checkin", feeling: "help", requestKey: helpKey },
    });
    assert.equal(help.status, 200);
  }

  const support = await call(passportRoute, {
    method: "POST",
    query: { token: issued.token },
    body: {
      kind: "support",
      topic: "Fitting or adjustment",
      message: "The left barrel drifts during long sessions.",
      email: "alex@example.com",
      phone: "",
      requestKey: randomUUID(),
    },
  });
  assert.equal(support.status, 200);

  const badTopic = await call(passportRoute, {
    method: "POST",
    query: { token: issued.token },
    body: { kind: "support", topic: "Refund", message: "hello there", email: "alex@example.com", requestKey: randomUUID() },
  });
  assert.equal(badTopic.status, 400);

  const list = await call(adminActivity, { headers: ADMIN });
  assert.equal(list.status, 200);
  const mine = list.body.activity.filter((a) => a.passport_id === issued.id);
  assert.equal(mine.length, 3, "duplicate request key must not create a second record");
  const kinds = mine.map((a) => `${a.kind}:${a.topic}:${a.status}`).sort();
  assert.deepEqual(kinds, ["checkin:All good:resolved", "checkin:Needs a hand:open", "support:Fitting or adjustment:open"]);
  assert.equal(mine[0].passport_name, "Dr Alex Morgan");
  assert.equal(mine[0].passport_reference, "PX-0001");
});

test("colleague invitations expose only the inviter's name", async () => {
  const info = await call(inviteRoute, { query: { token: issued.referral_token } });
  assert.equal(info.status, 200);
  assert.deepEqual(info.body, { invitation: { name: "Dr Alex Morgan", example: false } });

  assert.equal((await call(inviteRoute, { query: { token: issued.token } })).status, 404);

  const missingPractice = await call(inviteRoute, {
    method: "POST",
    query: { token: issued.referral_token },
    body: { name: "Sam Patel", email: "sam@example.com", postcode: "SW1A 1AA", requestKey: randomUUID() },
  });
  assert.equal(missingPractice.status, 400);
  assert.equal(missingPractice.body.field, "practice");

  const ok = await call(inviteRoute, {
    method: "POST",
    query: { token: issued.referral_token },
    body: {
      name: "Sam Patel",
      email: "sam@example.com",
      phone: "07700 900456",
      practice: "Hillside Dental",
      postcode: "SW1A 1AA",
      profession: "Dentistry",
      message: "Keen to try 3.0x",
      requestKey: randomUUID(),
    },
  });
  assert.equal(ok.status, 200);

  const list = await call(adminActivity, { headers: ADMIN });
  const referral = list.body.activity.find((a) => a.kind === "referral");
  assert.equal(referral.name, "Sam Patel");
  assert.equal(referral.practice, "Hillside Dental");
  assert.equal(referral.passport_name, "Dr Alex Morgan");
  assert.equal(referral.status, "open");
});

test("requests can be resolved and reopened", async () => {
  const list = await call(adminActivity, { headers: ADMIN });
  const open = list.body.activity.find((a) => a.kind === "support");
  const resolved = await call(adminActivity, { method: "PATCH", headers: ADMIN, body: { id: open.id, status: "resolved" } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.activity.status, "resolved");
  assert.ok(resolved.body.activity.resolved_at);
  const reopened = await call(adminActivity, { method: "PATCH", headers: ADMIN, body: { id: open.id, status: "open" } });
  assert.equal(reopened.body.activity.resolved_at, null);
  assert.equal((await call(adminActivity, { method: "PATCH", headers: ADMIN, body: { id: "missing", status: "open" } })).status, 404);
  assert.equal((await call(adminActivity, { method: "PATCH", headers: ADMIN, body: { id: open.id, status: "lost" } })).status, 400);
});

test("closing a passport closes its links; editing keeps the reference", async () => {
  const closed = await call(adminPassports, { method: "PATCH", headers: ADMIN, body: { id: issued.id, active: 0 } });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.passport.active, 0);
  assert.equal((await call(passportRoute, { query: { token: issued.token } })).status, 404);
  assert.equal((await call(inviteRoute, { query: { token: issued.referral_token } })).status, 404);

  const reopened = await call(adminPassports, { method: "PATCH", headers: ADMIN, body: { id: issued.id, active: 1 } });
  assert.equal(reopened.body.passport.active, 1);
  assert.equal((await call(passportRoute, { query: { token: issued.token } })).status, 200);

  const edited = await call(adminPassports, {
    method: "PATCH",
    headers: ADMIN,
    body: { id: issued.id, fields: { ...validPassport, name: "Dr A. Morgan", pupillary_distance: "66" } },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.passport.name, "Dr A. Morgan");
  assert.equal(edited.body.passport.pupillary_distance, 66);
  assert.equal(edited.body.passport.reference, "PX-0001");
  assert.equal(edited.body.passport.token, issued.token, "links survive an edit");

  const list = await call(adminPassports, { headers: ADMIN });
  assert.equal(list.body.passports.length, 1);
  assert.equal(list.body.passports[0].name, "Dr A. Morgan");
});

test("abuse guards: honeypot, cross-site posts, wrong content type, rate limit", async () => {
  const honey = await call(passportRoute, {
    method: "POST",
    query: { token: issued.token },
    body: { kind: "checkin", feeling: "good", website: "http://spam.example", requestKey: randomUUID() },
  });
  assert.equal(honey.status, 400);

  const crossSite = await call(passportRoute, {
    method: "POST",
    query: { token: issued.token },
    body: { kind: "checkin", feeling: "good", requestKey: randomUUID() },
    headers: { origin: "https://evil.example" },
  });
  assert.equal(crossSite.status, 403);

  const wrongType = await call(passportRoute, {
    method: "POST",
    query: { token: issued.token },
    body: { kind: "checkin", feeling: "good", requestKey: randomUUID() },
    headers: { "content-type": "text/plain" },
  });
  assert.equal(wrongType.status, 415);

  assert.equal((await call(passportRoute, { method: "DELETE", query: { token: issued.token } })).status, 405);

  let limited = null;
  for (let i = 0; i < 25 && !limited; i++) {
    const res = await call(passportRoute, {
      method: "POST",
      query: { token: issued.token },
      body: { kind: "checkin", feeling: "good", requestKey: randomUUID() },
    });
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, "the per-passport hourly limit kicks in");
});

test("manager key failures are counted per IP", async () => {
  for (let i = 0; i < 20; i++) {
    await call(adminPassports, { headers: { "x-passport-key": "wrong", "x-forwarded-for": "203.0.113.9" } });
  }
  const blocked = await call(adminPassports, { headers: { "x-passport-key": "test-key", "x-forwarded-for": "203.0.113.9" } });
  assert.equal(blocked.status, 429);
  const other = await call(adminPassports, { headers: { "x-passport-key": "test-key", "x-forwarded-for": "203.0.113.10" } });
  assert.equal(other.status, 200);
});

test("without any storage configured the API says so clearly", async () => {
  const saved = process.env.PASSPORT_DATA_DIR;
  delete process.env.PASSPORT_DATA_DIR;
  process.env.VERCEL = "1";
  try {
    const res = await call(passportRoute, { query: { token: "0".repeat(32) } });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "storage_unconfigured");
    const admin = await call(adminPassports, { headers: ADMIN });
    assert.equal(admin.status, 503);
    assert.equal(admin.body.code, "storage_unconfigured");
    const example = await call(passportRoute, { query: { token: "example" } });
    assert.equal(example.status, 200, "the example passport works without storage");
  } finally {
    process.env.PASSPORT_DATA_DIR = saved;
    delete process.env.VERCEL;
  }
});
