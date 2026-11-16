/**
 * /api/book-slots — the free discovery-call times for smoothoptics.com/book,
 * fetched from the CRM on each request (lib/booking.js). Never cached: a time
 * booked a moment ago must not be offered again.
 */
import { assertMethod, handler, sendJson } from "../lib/passport/http.js";
import { fetchSlots } from "../lib/booking.js";

export default handler(async (req, res) => {
  assertMethod(req, "GET");
  const answer = await fetchSlots();
  return sendJson(res, answer.status, answer.body);
});
