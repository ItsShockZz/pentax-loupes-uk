/**
 * /api/admin/activity (x-passport-key header required)
 *   GET   → check-ins, support requests and colleague enquiries, newest first
 *   PATCH → { id, status: "open" | "resolved" }
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
import { createStore } from "../../lib/passport/store.js";
import { listActivity, setActivityStatus, text } from "../../lib/passport/service.js";

export default handler(async (req, res) => {
  assertMethod(req, "GET", "PATCH");
  const store = createStore();
  await requireAdmin(req, store);
  if (!store) throw new HttpError(503, STORAGE_MESSAGE, { code: "storage_unconfigured" });

  if (req.method === "GET") {
    return sendJson(res, 200, { activity: await listActivity(store) });
  }

  assertSameOrigin(req);
  const data = await readJsonBody(req);
  const id = text(data, "id", { max: 64, required: true, label: "a request id" });
  const status = text(data, "status", { max: 20, required: true, label: "a status" });
  return sendJson(res, 200, { activity: await setActivityStatus(store, id, status) });
});
