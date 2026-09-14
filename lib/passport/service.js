/**
 * Passport domain logic: validation, records, activity, notifications.
 *
 * Every field that arrives from a browser is re-validated here — the
 * client-side checks are UX only (see SECURITY.md).
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { CHECKIN_FEELINGS, LIMITS, OPTIONS, SUPPORT_TOPICS } from "./options.js";
import { HttpError } from "./http.js";

export const TOKEN_RE = /^[a-f0-9]{32}$/;
const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const K = {
  passport: (id) => `passport:${id}`,
  token: (t) => `token:${t}`,
  referral: (t) => `referral:${t}`,
  all: "passports:all",
  seq: "passports:seq",
  activity: (id) => `activity:${id}`,
  activityAll: "activity:all",
  request: (key) => `request:${key}`,
  rate: (scope, bucket) => `rate:${scope}:${bucket}`,
};

export function newToken() {
  return randomBytes(16).toString("hex");
}

/* ---------------------------------------------------------------------- */
/* Field validators                                                        */
/* ---------------------------------------------------------------------- */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function text(data, key, { max = 160, required = false, label = key.replace(/_/g, " ") } = {}) {
  const raw = data[key];
  const value = raw == null ? "" : String(raw).trim();
  if (required && !value) throw new HttpError(400, `Please enter ${label}.`, { field: key });
  if (value.length > max) throw new HttpError(400, `${cap(label)} is too long (up to ${max} characters).`, { field: key });
  return value;
}

export function choice(data, key, list = OPTIONS[key], { required = true, label = key.replace(/_/g, " ") } = {}) {
  const value = text(data, key, { max: 80, required, label });
  if (!value) return "";
  if (!list.includes(value)) throw new HttpError(400, `Please choose a valid ${label}.`, { field: key });
  return value;
}

export function emailField(data, key = "email", { required = true } = {}) {
  const value = text(data, key, { max: 254, required, label: "an email address" });
  if (value && !EMAIL_RE.test(value)) throw new HttpError(400, "Please enter a valid email address.", { field: key });
  return value.toLowerCase();
}

export function intField(data, key, [min, max], { label = key.replace(/_/g, " ") } = {}) {
  const raw = data[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${cap(label)} should be a whole number between ${min} and ${max}.`, { field: key });
  }
  return n;
}

export function dateField(data, key, { label = "date" } = {}) {
  const value = text(data, key, { max: 10 });
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value)) || year < 2000 || year > 2100) {
    throw new HttpError(400, `Please enter a valid ${label}.`, { field: key });
  }
  return value;
}

export function requestKeyField(data) {
  const value = text(data, "requestKey", { max: 64 });
  if (!REQUEST_KEY_RE.test(value)) throw new HttpError(400, "Please refresh the page and try again.");
  return value;
}

/** Hidden "website" field: real people leave it empty. */
export function honeypot(data) {
  if (data.website) throw new HttpError(400, "Please try again.");
}

/* ---------------------------------------------------------------------- */
/* Passports                                                               */
/* ---------------------------------------------------------------------- */

export function passportInput(data) {
  return {
    name: text(data, "name", { max: 100, required: true, label: "the customer's name" }),
    email: emailField(data),
    phone: text(data, "phone", { max: 40 }),
    practice: text(data, "practice", { max: 160 }),
    discipline: choice(data, "discipline"),
    magnification: choice(data, "magnification"),
    colour: choice(data, "colour"),
    light: choice(data, "light", OPTIONS.light, { label: "light option" }),
    lenses: choice(data, "lenses", OPTIONS.lenses, { label: "protective lenses option" }),
    prescription: choice(data, "prescription"),
    working_distance: intField(data, "working_distance", LIMITS.workingDistance),
    pupillary_distance: intField(data, "pupillary_distance", LIMITS.pupillaryDistance),
    fitted_at: dateField(data, "fitted_at", { label: "fitting date" }),
    fitted_by: text(data, "fitted_by", { max: 80 }),
    reference: text(data, "reference", { max: 40 }),
    notes: text(data, "notes", { max: 2000 }),
  };
}

export async function createPassport(store, data) {
  const input = passportInput(data);
  if (!input.reference) {
    const n = await store.incr(K.seq);
    input.reference = `PX-${String(n).padStart(4, "0")}`;
  }
  const now = new Date().toISOString();
  const passport = {
    id: randomUUID(),
    token: newToken(),
    referral_token: newToken(),
    ...input,
    active: 1,
    created_at: now,
    updated_at: now,
  };
  await store.set(K.passport(passport.id), JSON.stringify(passport));
  await store.set(K.token(passport.token), passport.id);
  await store.set(K.referral(passport.referral_token), passport.id);
  await store.sadd(K.all, passport.id);
  return passport;
}

export async function getPassport(store, id) {
  const raw = await store.get(K.passport(id));
  return raw ? JSON.parse(raw) : null;
}

export async function listPassports(store) {
  const ids = await store.smembers(K.all);
  if (!ids.length) return [];
  const raws = await store.mget(ids.map(K.passport));
  return raws
    .filter(Boolean)
    .map((raw) => JSON.parse(raw))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Active passport for an access token ("token") or a referral token. */
export async function findByToken(store, token, kind = "token") {
  if (!TOKEN_RE.test(token || "")) return null;
  const id = await store.get(kind === "referral" ? K.referral(token) : K.token(token));
  if (!id) return null;
  const passport = await getPassport(store, id);
  return passport && passport.active ? passport : null;
}

export async function updatePassport(store, id, data) {
  const existing = await getPassport(store, id);
  if (!existing) throw new HttpError(404, "Passport not found.");
  const next = { ...existing };
  if (data.active !== undefined) {
    const active = Number(data.active);
    if (![0, 1].includes(active)) throw new HttpError(400, "Choose a valid passport status.");
    next.active = active;
  }
  if (data.fields && typeof data.fields === "object" && !Array.isArray(data.fields)) {
    Object.assign(next, passportInput({ ...existing, ...data.fields }));
    if (!next.reference) next.reference = existing.reference;
  }
  next.updated_at = new Date().toISOString();
  await store.set(K.passport(id), JSON.stringify(next));
  return next;
}

/** What the customer's own page is allowed to see. */
export function publicPassport(p) {
  // eslint-disable-next-line no-unused-vars
  const { email, phone, notes, token, ...visible } = p;
  return visible;
}

export const EXAMPLE_PASSPORT = Object.freeze({
  id: "example",
  token: "example",
  referral_token: "example",
  name: "Dr Alex Morgan",
  email: "",
  phone: "",
  practice: "Riverside Dental Practice",
  discipline: "Dentistry",
  magnification: "3.5",
  colour: "Black",
  light: "Wireless LED",
  lenses: "Yes",
  prescription: "Prescription insert",
  working_distance: 45,
  pupillary_distance: 64,
  fitted_at: "2026-09-04",
  fitted_by: "PENTAX Loupes UK",
  reference: "PX-0000",
  notes: "",
  active: 1,
  created_at: "2026-09-04T09:00:00.000Z",
  updated_at: "2026-09-04T09:00:00.000Z",
  example: true,
});

/* ---------------------------------------------------------------------- */
/* Activity: check-ins, support requests, colleague enquiries              */
/* ---------------------------------------------------------------------- */

async function rateLimit(store, scope, limit) {
  const bucket = Math.floor(Date.now() / 3600000);
  const key = K.rate(scope, bucket);
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, 3700);
  if (count > limit) {
    throw new HttpError(429, "Quite a few updates have come through in the last hour. Please try again later, or email the UK team.");
  }
}

/** Shapes a validated entry into the record the manager lists. */
export function buildActivity(passport, entry) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    passport_id: passport.id,
    kind: entry.kind,
    status: entry.status,
    topic: entry.topic,
    message: entry.message || "",
    name: entry.name || "",
    email: entry.email || "",
    phone: entry.phone || "",
    practice: entry.practice || "",
    postcode: entry.postcode || "",
    profession: entry.profession || "",
    details: entry.details && typeof entry.details === "object" ? entry.details : null,
    crm_status: "unconfigured",
    created_at: now,
    resolved_at: entry.status === "resolved" ? now : null,
  };
}

/**
 * Stores a check-in, support request, colleague enquiry or website enquiry,
 * then hands it to the CRM. `limits` are hourly caps; 0 disables one.
 */
export async function recordActivity(store, { passport, ip, data, entry, limits = { passport: 20, ip: 40 } }) {
  const requestKey = requestKeyField(data);
  if (limits.passport) await rateLimit(store, `passport:${passport.id}`, limits.passport);
  if (limits.ip) await rateLimit(store, `ip:${ip}`, limits.ip);
  const fresh = await store.set(K.request(requestKey), "1", { nx: true, ex: 86400 });
  if (!fresh) return { ok: true, duplicate: true };

  const activity = buildActivity(passport, entry);
  await store.set(K.activity(activity.id), JSON.stringify(activity));
  await store.sadd(K.activityAll, activity.id);

  const crm = await forwardToCrm(activity, passport);
  activity.crm_status = crm.status;
  activity.crm_outcome = crm.outcome || null;
  activity.crm_reference = crm.reference || null;
  activity.crm_error = crm.reason || null;
  await store.set(K.activity(activity.id), JSON.stringify(activity));
  return { ok: true, activity, crm };
}

/* ---------------------------------------------------------------------- */
/* CRM hand-off.                                                            */
/*                                                                          */
/* The CRM (github.com/ItsShockZz/pentax-crm) takes leads at                */
/* POST /api/ingest/webhook as a "structured" payload signed with           */
/* HMAC-SHA256 over the exact request body (X-Pentax-Signature, hex). The   */
/* signature key is the CRM's INGEST_WEBHOOK_SECRET, so CRM_WEBHOOK_SECRET  */
/* here must hold the same value. The CRM deduplicates by email and phone,  */
/* routes on postcode, and answers created / merged / skipped. See its      */
/* docs/zapier-setup.md for the field list. Failures are recorded on the    */
/* activity (crm_status) and never fail the customer's request.             */
/* ---------------------------------------------------------------------- */

// lead_sources.key in the CRM. Website forms are company-generated; a
// colleague introduced through a passport is word of mouth; a passport
// holder writing in is an existing customer (the CRM merges by email).
const CRM_SOURCE_KEYS = {
  enquiry: "website",
  referral: "word_of_mouth",
  support: "existing_customer",
  checkin: "existing_customer",
};

/** "All good" check-ins are not enquiries; everything else is worth a lead or a note. */
export function shouldForwardToCrm(activity) {
  return !(activity.kind === "checkin" && activity.status === "resolved");
}

/** The CRM's structured lead, built from one activity record. */
export function crmLeadPayload(activity, passport) {
  const viaPassport = passport && passport.id && passport.id !== "website";
  const holder = viaPassport ? `${passport.name} (${passport.reference})` : "";
  const lines = [];
  if (activity.kind === "enquiry") {
    lines.push(`${activity.topic} via the website${activity.topic === "Quote request" ? " configurator" : " form"}.`);
  } else if (activity.kind === "support") {
    lines.push(`Loupe passport support request from ${holder}: ${activity.topic}.`);
  } else if (activity.kind === "checkin") {
    lines.push(`Loupe passport check-in from ${holder}: ${activity.topic}.`);
  } else if (activity.kind === "referral") {
    lines.push(`Colleague demonstration enquiry, introduced by ${holder} through their loupe passport.`);
  } else {
    lines.push(`${activity.topic} via pentaxloupes.co.uk.`);
  }
  const details = Object.entries(activity.details || {})
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${cap(key.replace(/_/g, " "))}: ${value}`)
    .join("\n");
  if (details) lines.push(details);
  if (activity.message) lines.push(`Message: ${activity.message}`);
  lines.push(`Received ${activity.created_at} · website record ${activity.id}`);

  return {
    message_id: `website:${activity.id}`,
    received_at: activity.created_at,
    lead: {
      full_name: activity.name || undefined,
      email: activity.email || undefined,
      phone: activity.phone || undefined,
      country: "GB",
      postcode: activity.postcode || undefined,
      profession: activity.profession || (activity.details && activity.details.use) || undefined,
      practice_name: activity.practice || undefined,
      enquiry_details: lines.join("\n\n"),
      source_key: CRM_SOURCE_KEYS[activity.kind] || "website",
      source_hint: "pentaxloupes.co.uk",
    },
  };
}

export function signCrmBody(body, secret) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export async function forwardToCrm(activity, passport) {
  const url = process.env.CRM_WEBHOOK_URL;
  const secret = process.env.CRM_WEBHOOK_SECRET;
  if (!url || !secret) return { status: "unconfigured" };
  if (!shouldForwardToCrm(activity)) return { status: "skipped" };

  // One serialisation: the exact string that is signed is the one that is sent.
  const body = JSON.stringify(crmLeadPayload(activity, passport));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pentax-Signature": signCrmBody(body, secret) },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = (data && (data.error || data.reason)) || `HTTP ${res.status}`;
      console.error("[passport] CRM rejected the lead:", res.status, reason);
      return { status: "failed", httpStatus: res.status, reason };
    }
    return {
      status: "sent",
      httpStatus: res.status,
      outcome: (data && data.status) || "accepted",
      reference: (data && data.reference) || null,
    };
  } catch (err) {
    console.error("[passport] CRM webhook failed:", err.message);
    return { status: "failed", reason: err.message };
  }
}

export function checkinEntry(data) {
  const feeling = choice(data, "feeling", CHECKIN_FEELINGS, { label: "answer" });
  return {
    kind: "checkin",
    status: feeling === "good" ? "resolved" : "open",
    topic: feeling === "good" ? "All good" : "Needs a hand",
    message: text(data, "message", { max: 500 }),
  };
}

export function supportEntry(data) {
  return {
    kind: "support",
    status: "open",
    topic: choice(data, "topic", SUPPORT_TOPICS, { label: "topic" }),
    message: text(data, "message", { max: 2000, required: true, label: "a message" }),
    email: emailField(data),
    phone: text(data, "phone", { max: 40 }),
  };
}

export function referralEntry(data) {
  return {
    kind: "referral",
    status: "open",
    topic: "Colleague demonstration enquiry",
    name: text(data, "name", { max: 100, required: true, label: "your name" }),
    email: emailField(data),
    phone: text(data, "phone", { max: 40 }),
    practice: text(data, "practice", { max: 160, required: true, label: "your practice or company" }),
    postcode: text(data, "postcode", { max: 12, required: true, label: "your postcode" }),
    profession: choice(data, "profession", OPTIONS.discipline, { required: false, label: "profession" }),
    message: text(data, "message", { max: 2000 }),
  };
}

export async function listActivity(store) {
  const ids = await store.smembers(K.activityAll);
  if (!ids.length) return [];
  const items = (await store.mget(ids.map(K.activity))).filter(Boolean).map((raw) => JSON.parse(raw));
  const passportIds = [...new Set(items.map((a) => a.passport_id))];
  const passports = {};
  for (const raw of await store.mget(passportIds.map(K.passport))) {
    if (raw) {
      const p = JSON.parse(raw);
      passports[p.id] = p;
    }
  }
  return items
    .map((a) => {
      const p = passports[a.passport_id];
      const website = a.passport_id === "website";
      return {
        ...a,
        passport_name: website ? "Website" : p ? p.name : "Unknown passport",
        passport_reference: p ? p.reference : "",
        passport_token: p ? p.token : "",
        passport_active: website ? 1 : p ? p.active : 0,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function setActivityStatus(store, id, status) {
  if (!["open", "resolved"].includes(status)) throw new HttpError(400, "Choose a valid status.");
  const raw = await store.get(K.activity(id));
  if (!raw) throw new HttpError(404, "Request not found.");
  const activity = JSON.parse(raw);
  activity.status = status;
  activity.resolved_at = status === "resolved" ? new Date().toISOString() : null;
  await store.set(K.activity(id), JSON.stringify(activity));
  return activity;
}

/* ---------------------------------------------------------------------- */
/* Optional email notification (Resend). Never fails the request.          */
/* ---------------------------------------------------------------------- */

export async function notify({ subject, lines }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.PASSPORT_NOTIFY_TO;
  if (!apiKey || !to) return false;
  const from = process.env.PASSPORT_NOTIFY_FROM || "PENTAX Loupes UK <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: lines.join("\n") }),
    });
    if (!res.ok) console.error("[passport] notification failed:", res.status);
    return res.ok;
  } catch (err) {
    console.error("[passport] notification failed:", err.message);
    return false;
  }
}

export function baseUrl(req) {
  if (process.env.PASSPORT_BASE_URL) return process.env.PASSPORT_BASE_URL.replace(/\/$/, "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  const local = host.startsWith("localhost") || host.startsWith("127.");
  const proto = String(req.headers["x-forwarded-proto"] || (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
