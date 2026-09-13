/**
 * Passport domain logic: validation, records, activity, notifications.
 *
 * Every field that arrives from a browser is re-validated here — the
 * client-side checks are UX only (see SECURITY.md).
 */
import { randomBytes, randomUUID } from "node:crypto";
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

export async function recordActivity(store, { passport, ip, data, entry }) {
  const requestKey = requestKeyField(data);
  await rateLimit(store, `passport:${passport.id}`, 20);
  await rateLimit(store, `ip:${ip}`, 40);
  const fresh = await store.set(K.request(requestKey), "1", { nx: true, ex: 86400 });
  if (!fresh) return { ok: true, duplicate: true };

  const now = new Date().toISOString();
  const activity = {
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
    created_at: now,
    resolved_at: entry.status === "resolved" ? now : null,
  };
  await store.set(K.activity(activity.id), JSON.stringify(activity));
  await store.sadd(K.activityAll, activity.id);
  return { ok: true, activity };
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
      return {
        ...a,
        passport_name: p ? p.name : "Unknown passport",
        passport_reference: p ? p.reference : "",
        passport_token: p ? p.token : "",
        passport_active: p ? p.active : 0,
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
