// How website records become CRM leads (lib/passport/service.js → the CRM's
// structured webhook). Pure functions, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { crmLeadPayload, shouldForwardToCrm, signCrmBody } from "../lib/passport/service.js";

const passport = { id: "p1", reference: "PX-0004", name: "Dr Sam Patel", token: "t" };
const base = { id: "11111111-2222-4333-8444-555555555555", created_at: "2026-09-14T12:00:00.000Z", status: "open" };

test("a support request from a passport holder becomes an existing-customer lead with the reference in the text", () => {
  const payload = crmLeadPayload(
    { ...base, kind: "support", topic: "Fitting or adjustment", message: "Left barrel drifts.", name: "Dr Sam Patel", email: "sam@example.com", phone: "07700 900111" },
    passport,
  );
  assert.equal(payload.message_id, `website:${base.id}`);
  assert.equal(payload.received_at, base.created_at);
  assert.equal(payload.lead.source_key, "existing_customer");
  assert.equal(payload.lead.full_name, "Dr Sam Patel");
  assert.match(payload.lead.enquiry_details, /support request from Dr Sam Patel \(PX-0004\): Fitting or adjustment/);
  assert.match(payload.lead.enquiry_details, /Message: Left barrel drifts\./);
  assert.equal(JSON.stringify(payload).includes('"postcode"'), false, "absent fields are left out of the message, not sent as empty strings");
});

test("a colleague invitation is word of mouth and names who introduced them", () => {
  const payload = crmLeadPayload(
    { ...base, kind: "referral", topic: "Colleague demonstration enquiry", name: "Dr Hannah Reid", email: "hannah@example.com", practice: "St Bede's", postcode: "NE1 4LP", profession: "Surgery", message: "" },
    passport,
  );
  assert.equal(payload.lead.source_key, "word_of_mouth");
  assert.equal(payload.lead.postcode, "NE1 4LP");
  assert.equal(payload.lead.profession, "Surgery");
  assert.equal(payload.lead.practice_name, "St Bede's");
  assert.match(payload.lead.enquiry_details, /introduced by Dr Sam Patel \(PX-0004\)/);
});

test("a quote request uses the intended use as the profession and lists the configuration", () => {
  const payload = crmLeadPayload(
    {
      ...base,
      kind: "enquiry",
      topic: "Quote request",
      name: "Mr Tom Okafor",
      email: "tom@example.com",
      details: { colour: "Black", magnification: "3.5×", lenses: "Yes", light: "Wireless LED", use: "Dental practice" },
    },
    { id: "website", name: "Website", reference: "" },
  );
  assert.equal(payload.lead.source_key, "website");
  assert.equal(payload.lead.profession, "Dental practice");
  assert.match(payload.lead.enquiry_details, /Quote request via the website configurator/);
  assert.match(payload.lead.enquiry_details, /Colour: Black\nMagnification: 3\.5×\nLenses: Yes\nLight: Wireless LED\nUse: Dental practice/);
});

test("happy check-ins stay out of the CRM; everything else goes", () => {
  assert.equal(shouldForwardToCrm({ kind: "checkin", status: "resolved", topic: "All good" }), false);
  assert.equal(shouldForwardToCrm({ kind: "checkin", status: "open", topic: "Needs a hand" }), true);
  assert.equal(shouldForwardToCrm({ kind: "support", status: "open" }), true);
  assert.equal(shouldForwardToCrm({ kind: "enquiry", status: "open" }), true);
  assert.equal(shouldForwardToCrm({ kind: "referral", status: "open" }), true);
});

test("the signature matches the CRM's verification (hex HMAC-SHA256 over the raw body)", () => {
  const body = JSON.stringify({ message_id: "website:1", lead: { email: "a@b.co" } });
  assert.equal(signCrmBody(body, "shared-secret"), createHmac("sha256", "shared-secret").update(body, "utf8").digest("hex"));
});
