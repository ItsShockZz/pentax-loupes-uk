/**
 * /api/admin/passports (x-passport-key header required)
 *   GET   → every passport, newest first, plus storage status
 *   POST  → issue a passport
 *   PATCH → { id, active } to deactivate/reactivate, or { id, fields } to edit
 */
import {
  assertMethod,
  assertSameOrigin,
  handler,
  HttpError,
  readJsonBody,
  requireAdmin,
  sendJson,
  STORAGE_MESSAGE,
} from "../../lib/passport/http.js";
import { createStore, describeStore } from "../../lib/passport/store.js";
import { baseUrl, createPassport, listPassports, text, updatePassport } from "../../lib/passport/service.js";

export default handler(async (req, res) => {
  assertMethod(req, "GET", "POST", "PATCH");
  const store = createStore();
  await requireAdmin(req, store);
  if (!store) throw new HttpError(503, STORAGE_MESSAGE, { code: "storage_unconfigured", storage: describeStore(null) });

  if (req.method === "GET") {
    return sendJson(res, 200, {
      passports: await listPassports(store),
      storage: describeStore(store),
      baseUrl: baseUrl(req),
    });
  }

  assertSameOrigin(req);
  const data = await readJsonBody(req, 32000);
  if (req.method === "POST") {
    return sendJson(res, 201, { passport: await createPassport(store, data) });
  }
  const id = text(data, "id", { max: 64, required: true, label: "a passport id" });
  return sendJson(res, 200, { passport: await updatePassport(store, id, data) });
});
