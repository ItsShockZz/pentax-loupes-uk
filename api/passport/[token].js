/**
 * /api/passport/:token
 *   GET  → the customer's passport (never email/phone/notes)
 *   POST → { kind: "checkin", feeling, message? } or
 *          { kind: "support", topic, message, email, phone? }
 * The token "example" serves the demo passport and never stores anything.
 */
import {
  assertMethod,
  assertSameOrigin,
  clientIp,
  getQuery,
  handler,
  HttpError,
  readJsonBody,
  sendJson,
  STORAGE_MESSAGE,
} from "../../lib/passport/http.js";
import { createStore } from "../../lib/passport/store.js";
import {
  baseUrl,
  checkinEntry,
  EXAMPLE_PASSPORT,
  findByToken,
  honeypot,
  notify,
  publicPassport,
  recordActivity,
  supportEntry,
  text,
} from "../../lib/passport/service.js";

const NOT_FOUND = "This passport link isn't available. If you think it should be, contact the UK team.";

export default handler(async (req, res) => {
  assertMethod(req, "GET", "POST");
  const token = String(getQuery(req).token || "");
  const isExample = token === "example";

  if (req.method === "GET") {
    if (isExample) return sendJson(res, 200, { passport: publicPassport(EXAMPLE_PASSPORT) });
    const store = createStore();
    if (!store) throw new HttpError(503, STORAGE_MESSAGE, { code: "storage_unconfigured" });
    const passport = await findByToken(store, token);
    if (!passport) throw new HttpError(404, NOT_FOUND);
    return sendJson(res, 200, { passport: publicPassport(passport) });
  }

  assertSameOrigin(req);
  const data = await readJsonBody(req);
  honeypot(data);
  const kind = text(data, "kind", { max: 20 });
  let entry;
  if (kind === "checkin") entry = checkinEntry(data);
  else if (kind === "support") entry = supportEntry(data);
  else throw new HttpError(400, "Please try again.");

  if (isExample) return sendJson(res, 200, { ok: true, example: true });

  const store = createStore();
  if (!store) throw new HttpError(503, STORAGE_MESSAGE, { code: "storage_unconfigured" });
  const passport = await findByToken(store, token);
  if (!passport) throw new HttpError(404, NOT_FOUND);

  entry.name = passport.name;
  if (!entry.email) entry.email = passport.email;
  const result = await recordActivity(store, { passport, ip: clientIp(req), data, entry });

  if (result.activity && entry.status === "open") {
    const label = entry.kind === "support" ? "Support request" : "Check-in: needs a hand";
    await notify({
      subject: `${label} — ${passport.name} (${passport.reference})`,
      lines: [
        `${label} from ${passport.name} (${passport.reference}).`,
        `Topic: ${entry.topic}`,
        entry.message ? `Message: ${entry.message}` : "",
        `Contact: ${entry.email}${entry.phone ? ` / ${entry.phone}` : ""}`,
        "",
        `Manage: ${baseUrl(req)}/manage`,
      ].filter((line) => line !== ""),
    });
  }
  return sendJson(res, 200, { ok: true });
});
