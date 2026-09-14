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
import {
  baseUrl,
  buildActivity,
  forwardToCrm,
  honeypot,
  notificationsConfigured,
  notify,
  recordActivity,
} from "../lib/passport/service.js";
import { describeDetails, leadEntry, WEBSITE_PASSPORT } from "../lib/passport/leads.js";

/** What this deployment can do with an enquiry — no values, just yes/no. */
function configurationStatus() {
  const crmConfigured = Boolean(process.env.CRM_WEBHOOK_URL && process.env.CRM_WEBHOOK_SECRET);
  return {
    storage: Boolean(createStore()),
    crm: crmConfigured ? "configured" : "unconfigured",
    email: notificationsConfigured(),
  };
}

export default handler(async (req, res) => {
  if (req.method === "GET") {
    const status = configurationStatus();
    return sendJson(res, 200, {
      ok: status.storage || status.crm === "configured" || status.email,
      ...status,
      hint:
        status.storage || status.crm === "configured" || status.email
          ? undefined
          : "Set CRM_WEBHOOK_URL + CRM_WEBHOOK_SECRET, or the SMTP_* variables, or connect Upstash Redis, then redeploy.",
    });
  }
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
    if (crm.status !== "sent" && !notificationsConfigured()) {
      throw new HttpError(503, "We couldn't send your enquiry just now. Please email the UK team instead.", {
        code: "unconfigured",
        detail: { ...configurationStatus(), crm_result: crm.status, crm_reason: crm.reason || null },
      });
    }
  }

  const crmLine =
    crm.status === "sent"
      ? `CRM: ${crm.outcome === "merged" ? "merged into an existing lead" : "new lead created"}${crm.reference ? ` (${crm.reference})` : ""}`
      : crm.status === "failed"
        ? `CRM: NOT delivered (${crm.reason || "error"}) — the enquiry is kept in the passport manager`
        : "CRM: not connected — the enquiry is kept in the passport manager";
  await notify({
    subject: `New lead: ${entry.topic} — ${entry.name}`,
    replyTo: entry.email,
    lines: [
      `A new ${entry.topic.toLowerCase()} has been submitted on pentaxloupes.co.uk.`,
      "",
      `Name: ${entry.name}`,
      `Email: ${entry.email}`,
      entry.phone ? `Phone: ${entry.phone}` : "",
      entry.practice ? `Practice: ${entry.practice}` : "",
      entry.postcode ? `Postcode: ${entry.postcode}` : "",
      entry.profession ? `Profession: ${entry.profession}` : "",
      describeDetails(entry.details) ? `Details: ${describeDetails(entry.details)}` : "",
      entry.message ? `Message: ${entry.message}` : "",
      "",
      crmLine,
      `Passport manager: ${baseUrl(req)}/manage`,
      `CRM: https://pentax-crm.vercel.app/`,
    ].filter((line) => line !== ""),
  });

  return sendJson(res, 200, { ok: true, stored: Boolean(store), crm: crm.status });
});
