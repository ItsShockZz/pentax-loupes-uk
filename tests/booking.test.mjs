// Booking a discovery call on smoothoptics.com/book.
//
// The page is this site's own (book.html + js/book.js). The times and the
// bookings live in the CRM, which this site's server reaches through
// /api/book-slots and /api/book (lib/booking.js), signing each booking with
// the shared CRM secret. Nothing here reaches a real CRM: fetch is a stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { crmOrigin, fetchSlots, forwardBooking, pickBooking, signBooking } from "../lib/booking.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const ENV = { CRM_WEBHOOK_URL: "https://crm.example/api/ingest/webhook", CRM_WEBHOOK_SECRET: "shared-secret" };

function fakeCrm(reply = { status: 200, body: { ok: true } }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("/book is this site's own page, not a redirect to the CRM", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.equal((config.redirects ?? []).some((r) => r.source === "/book"), false);
  assert.ok(config.rewrites.some((r) => r.source === "/book" && r.destination === "/book.html"));
  assert.match(read("scripts/dev-server.mjs"), /\/book\.html/);
  const page = read("book.html");
  assert.match(page, /<script src="\/js\/book\.js[^"]*" defer><\/script>/);
  assert.match(page, /id="booking"/);
  // Nothing is fetched from another site: the CSP's connect-src 'self' holds.
  assert.doesNotMatch(read("js/book.js"), /https?:\/\//);
  assert.doesNotMatch(read("js/book.js"), /innerHTML/);
});

test("the page offers a discovery call in the hero, the menu, the closing call to action and the demo section", () => {
  const html = read("index.html");
  const links = [...html.matchAll(/<a\b[^>]*href="\/book"[^>]*>([\s\S]*?)<\/a>/g)];
  const tracked = links.map((m) => /data-track="([^"]+)"/.exec(m[0])?.[1]);
  for (const name of ["book_call_hero", "book_call_nav", "book_call_trust", "book_call_specialist", "book_call_magnification"]) {
    assert.ok(tracked.includes(name), `a /book link tracked as ${name}`);
  }
  for (const [, label] of links) assert.doesNotMatch(label, /£|\bprice/i);
  assert.match(html, /href="#request-demo"/);
});

test("no price appears on the booking page", () => {
  assert.doesNotMatch(read("book.html") + read("js/book.js"), /£|\bprice\b/i);
});

test("the CRM's address comes from the enquiry forms' setting, and can be pointed elsewhere", () => {
  assert.equal(crmOrigin(ENV), "https://crm.example");
  assert.equal(crmOrigin({ ...ENV, CRM_BOOKING_URL: "http://localhost:3100" }), "http://localhost:3100");
  assert.equal(crmOrigin({}), null);
});

test("only the booking form's own fields are forwarded", () => {
  assert.deepEqual(
    pickBooking({ slot_id: "s", first_name: "A", email: "a@example.com", admin: true, __proto__x: 1 }),
    { slot_id: "s", first_name: "A", email: "a@example.com" },
  );
});

test("a booking is forwarded signed over timestamp and body, with the visitor's address", async () => {
  const crm = fakeCrm({ status: 200, body: { ok: true, booking: { starts_at: "2026-11-18T12:45:00.000Z" } } });
  const answer = await forwardBooking(
    { slot_id: "slot-1", first_name: "Ada", sneaky: "x" },
    "203.0.113.7",
    { fetchImpl: crm.fetchImpl, env: ENV, now: () => 1_800_000_000_000 },
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.body.ok, true);

  const [call] = crm.calls;
  assert.equal(call.url, "https://crm.example/api/book");
  const body = String(call.init.body);
  assert.deepEqual(JSON.parse(body), { booking: { slot_id: "slot-1", first_name: "Ada" }, client_ip: "203.0.113.7" });
  const ts = call.init.headers["X-Pentax-Timestamp"];
  assert.equal(ts, "1800000000000");
  const expected = createHmac("sha256", "shared-secret").update(`${ts}.${body}`).digest("hex");
  assert.equal(call.init.headers["X-Pentax-Signature"], expected);
  assert.equal(signBooking(body, "shared-secret", ts), expected);
});

test("the CRM's own answer is passed back, refusals included", async () => {
  const crm = fakeCrm({ status: 409, body: { error: "Sorry, somebody has just booked that time.", code: "slot_taken", days: [] } });
  const answer = await forwardBooking({ slot_id: "s" }, "1.2.3.4", { fetchImpl: crm.fetchImpl, env: ENV });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.code, "slot_taken");
});

test("without the CRM settings, booking says so and offers the email address", async () => {
  const answer = await forwardBooking({}, "1.2.3.4", { fetchImpl: fakeCrm().fetchImpl, env: {} });
  assert.equal(answer.status, 503);
  assert.match(answer.body.error, /hello@smoothoptics\.com/);
});

test("a CRM that cannot be reached is a clear error, not a crash", async () => {
  const failing = async () => { throw new Error("connect ECONNREFUSED"); };
  const answer = await forwardBooking({}, "1.2.3.4", { fetchImpl: failing, env: ENV });
  assert.equal(answer.status, 502);
  const slots = await fetchSlots({ fetchImpl: failing, env: ENV });
  assert.equal(slots.status, 502);
});

test("the free times are fetched from the CRM's slots endpoint", async () => {
  const crm = fakeCrm({ status: 200, body: { days: [{ key: "2026-11-18", label: "Wed 18 Nov", slots: [] }] } });
  const answer = await fetchSlots({ fetchImpl: crm.fetchImpl, env: ENV });
  assert.equal(crm.calls[0].url, "https://crm.example/api/book/slots");
  assert.equal(answer.body.days[0].label, "Wed 18 Nov");
});

test("/api/book refuses a post from another site before forwarding anything", async () => {
  const route = (await import("../api/book.js")).default;
  const raw = JSON.stringify({ slot_id: "s" });
  const req = Readable.from([Buffer.from(raw)]);
  Object.assign(req, {
    method: "POST", url: "/api/book", query: {}, socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "smoothoptics.com", origin: "https://evil.example", "content-type": "application/json" },
  });
  const status = await new Promise((resolve, reject) => {
    const res = { statusCode: 200, setHeader() {}, end() { resolve(this.statusCode); } };
    route(req, res).catch(reject);
  });
  assert.equal(status, 403);
});

test("the privacy notice covers bookings, Zoom and the email provider", () => {
  const privacy = read("privacy.html");
  assert.match(privacy, /<h2>Booking a discovery call<\/h2>/);
  assert.match(privacy, /Zoom/);
  assert.match(privacy, /Resend/);
  assert.match(privacy, /optional and unticked/);
});
