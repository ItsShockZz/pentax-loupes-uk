// The browser (js/passport-common.js) and the server (lib/passport/options.js)
// each carry a copy of the option lists. This test fails the moment they drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as server from "../lib/passport/options.js";

await import("../js/passport-common.js");
const client = globalThis.PassportCommon;

test("option lists match between browser and server", () => {
  assert.deepEqual(client.OPTIONS, server.OPTIONS);
  assert.deepEqual(client.SUPPORT_TOPICS, server.SUPPORT_TOPICS);
  assert.deepEqual(client.FIELD_OF_VIEW, server.FIELD_OF_VIEW);
  assert.deepEqual(client.LIMITS, server.LIMITS);
});

test("field of view covers every magnification", () => {
  for (const magnification of server.OPTIONS.magnification) {
    assert.equal(typeof server.FIELD_OF_VIEW[magnification], "number");
  }
});

test("greeting name keeps a title with the surname", () => {
  assert.equal(client.greetingName("Dr Alex Morgan"), "Dr Morgan");
  assert.equal(client.greetingName("Alex Morgan"), "Alex");
  assert.equal(client.greetingName("Prof. Jamie Lee-Wong"), "Prof Lee-Wong");
  assert.equal(client.greetingName(""), "");
});

test("spec summary reads like the configurator", () => {
  assert.equal(
    client.specSummary({ magnification: "3.5", colour: "Black", light: "Wireless LED", lenses: "Yes" }),
    "3.5× · Black · Wireless LED · Protective lenses",
  );
  assert.equal(client.specSummary({ magnification: "2.5", colour: "Red", light: "No light", lenses: "No" }), "2.5× · Red");
});
