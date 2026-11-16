/**
 * /api/book — a discovery-call booking from smoothoptics.com/book.
 *   POST { slot_id, first_name, last_name, email, phone, profession,
 *          whatsapp_consent, website, fill_ms }
 *
 * Checked to come from this site, then forwarded, signed, to the CRM, which
 * validates every field, applies the spam checks and the rate limit, holds
 * the time and books the Zoom call (lib/booking.js). Its answer is passed back
 * as it is, so the page shows the CRM's own messages.
 */
import { assertMethod, assertSameOrigin, clientIp, handler, readJsonBody, sendJson } from "../lib/passport/http.js";
import { forwardBooking } from "../lib/booking.js";

export default handler(async (req, res) => {
  assertMethod(req, "POST");
  assertSameOrigin(req);
  const data = await readJsonBody(req);
  const answer = await forwardBooking(data, clientIp(req));
  return sendJson(res, answer.status, answer.body);
});
