/**
 * /api/invite/:referralToken
 *   GET  → { invitation: { name } } — who is inviting the colleague
 *   POST → colleague demonstration enquiry (name, email, practice, postcode …)
 * Nothing about the inviting customer's setup is exposed here.
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
import { baseUrl, EXAMPLE_PASSPORT, findByToken, honeypot, notify, recordActivity, referralEntry } from "../../lib/passport/service.js";

const NOT_FOUND = "This invitation link isn't active any more. You can still request a demonstration on our website.";

export default handler(async (req, res) => {
  assertMethod(req, "GET", "POST");
  const token = String(getQuery(req).token || "");
  const isExample = token === "example";

  const store = isExample ? null : createStore();
  if (!isExample && !store) throw new HttpError(503, STORAGE_MESSAGE, { code: "storage_unconfigured" });
  const passport = isExample ? EXAMPLE_PASSPORT : await findByToken(store, token, "referral");
  if (!passport) throw new HttpError(404, NOT_FOUND);

  if (req.method === "GET") {
    return sendJson(res, 200, { invitation: { name: passport.name, example: Boolean(passport.example) } });
  }

  assertSameOrigin(req);
  const data = await readJsonBody(req);
  honeypot(data);
  const entry = referralEntry(data);
  if (isExample) return sendJson(res, 200, { ok: true, example: true });

  const result = await recordActivity(store, { passport, ip: clientIp(req), data, entry });
  if (result.activity) {
    await notify({
      subject: `Colleague enquiry via ${passport.name} — ${entry.name}`,
      lines: [
        `${entry.name} would like a demonstration, introduced by ${passport.name} (${passport.reference}).`,
        `Practice: ${entry.practice}`,
        `Postcode: ${entry.postcode}`,
        entry.profession ? `Profession: ${entry.profession}` : "",
        `Contact: ${entry.email}${entry.phone ? ` / ${entry.phone}` : ""}`,
        entry.message ? `Message: ${entry.message}` : "",
        "",
        `Manage: ${baseUrl(req)}/manage`,
      ].filter((line) => line !== ""),
    });
  }
  return sendJson(res, 200, { ok: true });
});
