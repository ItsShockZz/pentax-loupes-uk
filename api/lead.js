/**
 * /api/lead — website enquiries.
 *   POST { kind: "demo", requestKey, fullName, email, phone, practice,
 *          profession, postcode, magnificationInterest?, preferredContact?, message? }
 *   POST { kind: "quote", requestKey, name, email, phone, practice?,
 *          configuration: { colour, magnification, lenses, light, use } }
 *
 * Every field is re-validated here (lib/passport/leads.js). The enquiry is
 * stored with the passport activity (visible at /manage), forwarded to the
 * CRM when CRM_WEBHOOK_URL is set, and emailed when Resend is configured.
 * Without storage the enquiry is still forwarded and emailed; if neither is
 * possible the browser gets a 503 and offers an email link instead.
 */
import {
  assertMethod,
  assertSameOrigin,
  clientIp,
  handler,
  HttpError,
  readJsonBody,
  sendJson,
} from "../lib/passport/http.js";
import { createStore } from "../lib/passport/store.js";
import { baseUrl, buildActivity, forwardToCrm, honeypot, notify, recordActivity } from "../lib/passport/service.js";
import { describeDetails, leadEntry, WEBSITE_PASSPORT } from "../lib/passport/leads.js";

export default handler(async (req, res) => {
  assertMethod(req, "POST");
  assertSameOrigin(req);
  const data = await readJsonBody(req);
  honeypot(data);
  const entry = leadEntry(data);

  const store = createStore();
  let activity;
  let crm;
  if (store) {
    const result = await recordActivity(store, {
      passport: WEBSITE_PASSPORT,
      ip: clientIp(req),
      data,
      entry,
      limits: { passport: 0, ip: 10 },
    });
    if (result.duplicate) return sendJson(res, 200, { ok: true, duplicate: true });
    activity = result.activity;
    crm = result.crm;
  } else {
    activity = buildActivity(WEBSITE_PASSPORT, entry);
    crm = await forwardToCrm(activity, WEBSITE_PASSPORT);
    const canEmail = Boolean(process.env.RESEND_API_KEY && process.env.PASSPORT_NOTIFY_TO);
    if (crm.status !== "sent" && !canEmail) {
      throw new HttpError(503, "We couldn't send your enquiry just now. Please email the UK team instead.", { code: "unconfigured" });
    }
  }

  await notify({
    subject: `${entry.topic} — ${entry.name}`,
    lines: [
      `${entry.topic} from the website.`,
      `Name: ${entry.name}`,
      `Contact: ${entry.email}${entry.phone ? ` / ${entry.phone}` : ""}`,
      entry.practice ? `Practice: ${entry.practice}` : "",
      entry.postcode ? `Postcode: ${entry.postcode}` : "",
      entry.profession ? `Profession: ${entry.profession}` : "",
      describeDetails(entry.details) ? `Details: ${describeDetails(entry.details)}` : "",
      entry.message ? `Message: ${entry.message}` : "",
      `CRM: ${crm.status}`,
      "",
      `Manage: ${baseUrl(req)}/manage`,
    ].filter((line) => line !== ""),
  });

  return sendJson(res, 200, { ok: true, stored: Boolean(store), crm: crm.status });
});
