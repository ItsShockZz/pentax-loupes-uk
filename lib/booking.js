/**
 * Discovery-call booking on smoothoptics.com/book.
 *
 * The times and the bookings live in the CRM. This site's own server talks to
 * it, so the page stays same-origin (the CSP's connect-src 'self' holds) and
 * the CRM's address never reaches the browser:
 *
 *   GET  /api/book-slots  -> CRM GET  /api/book/slots   the free times, plus
 *                            the consent wording and professions the CRM
 *                            records, so the page shows exactly those words
 *   POST /api/book        -> CRM POST /api/book         signed with the shared
 *                            CRM secret over `<timestamp>.<body>`, carrying the
 *                            visitor's IP so the CRM rate-limits the visitor
 *
 * Configuration is what the enquiry forms already use: CRM_WEBHOOK_URL (only
 * its origin is read) and CRM_WEBHOOK_SECRET / WEBSITE_WEBHOOK_SECRET. Set
 * CRM_BOOKING_URL to point at a different CRM, e.g. a local one.
 */
import { createHmac } from "node:crypto";
import { crmSecret } from "./passport/service.js";

const TIMEOUT_MS = 25_000;

/** The fields the CRM's booking form takes. Anything else is dropped here. */
export const BOOKING_FIELDS = [
  "slot_id",
  "first_name",
  "last_name",
  "email",
  "phone",
  "profession",
  "whatsapp_consent",
  "website",
  "fill_ms",
];

export function crmOrigin(env = process.env) {
  const raw = String(env.CRM_BOOKING_URL || env.CRM_WEBHOOK_URL || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function pickBooking(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const key of BOOKING_FIELDS) if (data[key] !== undefined) out[key] = data[key];
  return out;
}

export function signBooking(body, secret, timestamp) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

const UNCONFIGURED = {
  status: 503,
  body: {
    error: "Online booking isn't available just now. Please email hello@smoothoptics.com and we'll find a time.",
    unconfigured: true,
  },
};

async function relay(res) {
  const data = await res.json().catch(() => null);
  if (data && typeof data === "object") return { status: res.status, body: data };
  return { status: 502, body: { error: "The booking calendar didn't answer properly. Please try again." } };
}

/** The free times and the form's wording, from the CRM. */
export async function fetchSlots({ fetchImpl = fetch, env = process.env } = {}) {
  const origin = crmOrigin(env);
  if (!origin) return UNCONFIGURED;
  try {
    const res = await fetchImpl(`${origin}/api/book/slots`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    return relay(res);
  } catch (err) {
    console.error("[booking] slots failed:", err.message);
    return { status: 502, body: { error: "The booking calendar couldn't be loaded just now. Please try again in a minute." } };
  }
}

/** Forwards one booking, signed, and hands back the CRM's answer as it is. */
export async function forwardBooking(
  data,
  clientIp,
  { fetchImpl = fetch, env = process.env, now = Date.now } = {},
) {
  const origin = crmOrigin(env);
  const secret = env === process.env ? crmSecret() : env.CRM_WEBHOOK_SECRET || env.WEBSITE_WEBHOOK_SECRET || "";
  if (!origin || !secret) return UNCONFIGURED;

  // One serialisation: the exact string that is signed is the one that is sent.
  const body = JSON.stringify({ booking: pickBooking(data), client_ip: String(clientIp || "") });
  const timestamp = String(now());
  try {
    const res = await fetchImpl(`${origin}/api/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pentax-Timestamp": timestamp,
        "X-Pentax-Signature": signBooking(body, secret, timestamp),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return relay(res);
  } catch (err) {
    console.error("[booking] forwarding failed:", err.message);
    return {
      status: 502,
      body: { error: "We couldn't reach the booking calendar. Please try again, or email hello@smoothoptics.com." },
    };
  }
}
