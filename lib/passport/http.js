/**
 * Small HTTP helpers shared by the passport API functions. Written against the
 * plain Node (req, res) signature so the same handlers run on Vercel Functions
 * and in scripts/dev-server.mjs without any framework.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const STORAGE_MESSAGE =
  "Passport storage isn't connected yet. Add a Redis (Upstash) database to the Vercel project — see README.md.";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

export function sendJson(res, status, body) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(BASE_HEADERS)) res.setHeader(key, value);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function getQuery(req) {
  if (req.query && typeof req.query === "object") return req.query;
  const url = new URL(req.url || "/", "http://localhost");
  return Object.fromEntries(url.searchParams);
}

function parseJson(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "Please check the form and try again.");
  }
}

export async function readJsonBody(req, maxBytes = 16000) {
  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new HttpError(415, "Please submit the form from the page.");

  // Vercel parses JSON bodies ahead of the handler; the dev server does not.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      if (req.body.length > maxBytes) throw new HttpError(413, "Your message is too long.");
      return parseJson(req.body);
    }
    if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString("utf8"));
    if (typeof req.body === "object") return req.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "Your message is too long.");
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString("utf8"));
}

/** Browser POSTs must come from this site (blocks cross-site form posts). */
export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === "null") return;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "This request could not be verified.");
  }
  if (!host || originHost !== host) throw new HttpError(403, "This request could not be verified.");
}

export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

export function assertMethod(req, ...allowed) {
  if (!allowed.includes(req.method)) throw new HttpError(405, "Method not allowed.");
}

function safeEqual(a, b) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * The manager is protected by one shared key (PASSPORT_ADMIN_KEY) sent as the
 * x-passport-key header. Failed attempts are counted per IP for an hour.
 */
export async function requireAdmin(req, store) {
  const expected = process.env.PASSPORT_ADMIN_KEY;
  if (!expected) {
    throw new HttpError(503, "The passport manager isn't set up yet: add a PASSPORT_ADMIN_KEY environment variable.", {
      code: "admin_unconfigured",
    });
  }
  const provided = String(req.headers["x-passport-key"] || "");
  const failKey = `authfail:${clientIp(req)}`;
  if (store) {
    const fails = Number(await store.get(failKey)) || 0;
    if (fails >= 20) throw new HttpError(429, "Too many sign-in attempts. Please try again in an hour.");
  }
  if (!provided || !safeEqual(provided, expected)) {
    if (store) {
      const count = await store.incr(failKey);
      if (count === 1) await store.expire(failKey, 3600);
    }
    throw new HttpError(401, "That key isn't right.", { code: "unauthorized" });
  }
}

/** Wraps a handler so every failure becomes a tidy JSON response. */
export function handler(fn) {
  return async function passportHandler(req, res) {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, ...(err.extra || {}) });
        return;
      }
      console.error("[passport] request failed:", (err && err.stack) || err);
      sendJson(res, 503, {
        error: "We couldn't save or load this right now. Please try again in a moment.",
        code: "storage_error",
      });
    }
  };
}
