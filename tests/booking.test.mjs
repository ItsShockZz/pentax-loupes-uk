// The discovery-call booking links. smoothoptics.com/book is the address that
// goes into WhatsApp and email welcome messages, so it must keep working: it is
// a redirect (vercel.json) to the CRM's booking page, and the site's buttons
// point at /book rather than at the CRM directly, so the page can move later
// by changing one line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("/book redirects to the CRM's booking page, temporarily", () => {
  const config = JSON.parse(read("vercel.json"));
  const rule = (config.redirects ?? []).find((r) => r.source === "/book");
  assert.ok(rule, "vercel.json has a /book redirect");
  assert.equal(rule.destination, "https://pentax-crm.vercel.app/book");
  // Temporary, so browsers do not cache it forever and the target can move.
  assert.equal(rule.permanent, false);
});

test("the dev server mirrors the /book redirect", () => {
  const server = read("scripts/dev-server.mjs");
  assert.match(server, /REDIRECTS/);
  assert.match(server, /pentax-crm\.vercel\.app\/book/);
});

test("the page offers a discovery call in the hero, the menu, the closing call to action and the demo section", () => {
  const html = read("index.html");
  const links = [...html.matchAll(/<a\b[^>]*href="\/book"[^>]*>([\s\S]*?)<\/a>/g)];
  const tracked = links.map((m) => /data-track="([^"]+)"/.exec(m[0])?.[1]);
  for (const name of ["book_call_hero", "book_call_nav", "book_call_trust", "book_call_specialist", "book_call_magnification"]) {
    assert.ok(tracked.includes(name), `a /book link tracked as ${name}`);
  }
  for (const [, label] of links) assert.doesNotMatch(label, /£|\bprice/i);
  // The demo request form stays reachable.
  assert.match(html, /href="#request-demo"/);
});

test("the privacy notice covers bookings, Zoom and the email provider", () => {
  const privacy = read("privacy.html");
  assert.match(privacy, /<h2>Booking a discovery call<\/h2>/);
  assert.match(privacy, /Zoom/);
  assert.match(privacy, /Resend/);
  assert.match(privacy, /optional and unticked/);
});
