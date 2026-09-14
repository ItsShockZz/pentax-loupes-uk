/**
 * Outbound email for alerts ("a new lead has been submitted").
 *
 * Two transports, chosen by which environment variables are present:
 *
 *   SMTP   — SMTP_HOST, SMTP_USER, SMTP_PASSWORD (+ SMTP_PORT, default 465).
 *            Sends through an ordinary mailbox such as the OVH one the CRM
 *            reads from (ssl0.ovh.net:465). Implemented here over node:tls so
 *            the site keeps its zero-dependency deploy. Port 465 is implicit
 *            TLS; any other port must offer STARTTLS, or the send is refused
 *            rather than sending a password in the clear (SMTP_INSECURE=1
 *            overrides that for local testing only).
 *   Resend — RESEND_API_KEY, via the REST API.
 *
 * The recipient is PASSPORT_NOTIFY_TO; the sender PASSPORT_NOTIFY_FROM
 * (defaults to the SMTP user, or Resend's onboarding sender).
 */
import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

/* ---------------------------------------------------------------------- */
/* Configuration                                                           */
/* ---------------------------------------------------------------------- */

export function smtpConfig(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return null;
  const port = Number(env.SMTP_PORT || 465);
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE !== "false" : port === 465;
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the
  // spaces are decoration and must not be sent.
  const gmail = /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(env.SMTP_HOST) || /@(gmail|googlemail)\.com$/i.test(env.SMTP_USER);
  return {
    host: env.SMTP_HOST,
    port,
    secure,
    user: env.SMTP_USER,
    password: gmail ? env.SMTP_PASSWORD.replace(/\s+/g, "") : env.SMTP_PASSWORD,
    allowInsecure: env.SMTP_INSECURE === "1" || env.SMTP_INSECURE === "true",
    ehlo: env.SMTP_EHLO || "pentaxloupes.co.uk",
    timeoutMs: Number(env.SMTP_TIMEOUT_MS || 15000),
  };
}

export function defaultFrom(env = process.env) {
  if (env.PASSPORT_NOTIFY_FROM) return env.PASSPORT_NOTIFY_FROM;
  const smtp = smtpConfig(env);
  if (smtp) return `PENTAX Loupes UK <${smtp.user}>`;
  return "PENTAX Loupes UK <onboarding@resend.dev>";
}

/**
 * sendMail({ to, subject, text }) → { sent, transport, detail? }
 * Never throws for configuration reasons; transport failures do throw so the
 * caller can log them.
 */
export async function sendMail({ to, subject, text, from = defaultFrom(), replyTo }) {
  const smtp = smtpConfig();
  if (smtp) {
    const message = buildMessage({ from, to, subject, text, replyTo });
    await smtpSend(smtp, { from, to, message });
    return { sent: true, transport: "smtp" };
  }
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    return { sent: res.ok, transport: "resend", detail: `HTTP ${res.status}` };
  }
  return { sent: false, transport: "none" };
}

/* ---------------------------------------------------------------------- */
/* Message building (RFC 5322 + MIME)                                      */
/* ---------------------------------------------------------------------- */

const ASCII = /^[\x20-\x7e]*$/;

export function encodeHeaderText(value) {
  const s = String(value).replace(/[\r\n]+/g, " ");
  return ASCII.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** Bare address out of "Name <addr>" or "addr". */
export function addressOf(value) {
  const m = String(value).match(/<([^>]+)>/);
  return (m ? m[1] : String(value)).trim();
}

export function encodeAddress(value) {
  const s = String(value).trim();
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (!m) return s;
  const name = m[1].replace(/^"|"$/g, "").trim();
  if (!name) return `<${m[2]}>`;
  return ASCII.test(name) ? `"${name.replace(/"/g, "'")}" <${m[2]}>` : `${encodeHeaderText(name)} <${m[2]}>`;
}

function base64Lines(text) {
  return Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

export function buildMessage({ from, to, subject, text, replyTo }) {
  const domain = addressOf(from).split("@")[1] || "pentaxloupes.co.uk";
  const headers = [
    `From: ${encodeAddress(from)}`,
    `To: ${encodeAddress(to)}`,
    replyTo ? `Reply-To: ${encodeAddress(replyTo)}` : null,
    `Subject: ${encodeHeaderText(subject)}`,
    `Date: ${new Date().toUTCString().replace(/GMT$/, "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "X-Mailer: pentax-loupes-uk",
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${base64Lines(text)}\r\n`;
}

/** Normalises line endings and dot-stuffs, per RFC 5321 §4.5.2. */
export function dotStuff(message) {
  return message
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

/* ---------------------------------------------------------------------- */
/* Minimal SMTP client                                                     */
/* ---------------------------------------------------------------------- */

class SmtpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function openSocket(host, port, secure, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const event = secure ? "secureConnect" : "connect";
    const onError = (err) => reject(err);
    socket.setTimeout(timeoutMs, () => socket.destroy(new SmtpError("SMTP connection timed out")));
    socket.once("error", onError);
    socket.once(event, () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

class SmtpConnection {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = "";
    this.waiters = [];
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      this.drain();
    });
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new SmtpError("SMTP connection closed")));
  }

  fail(err) {
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w.reject(err);
  }

  /** Resolves one complete reply: "250-line", "250-line", "250 last". */
  drain() {
    while (this.waiters.length) {
      const end = this.buffer.search(/^\d{3} [^\r\n]*\r\n/m);
      if (end < 0) return;
      const lineEnd = this.buffer.indexOf("\r\n", end) + 2;
      const raw = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd);
      const lines = raw.split("\r\n").filter(Boolean);
      const code = Number(lines[lines.length - 1].slice(0, 3));
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve({ code, lines: lines.map((l) => l.slice(4)) });
    }
  }

  reply() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new SmtpError("SMTP server did not reply in time"));
      }, this.timeoutMs);
      this.waiters.push({ resolve, reject, timer });
      this.drain();
    });
  }

  async command(line, okCodes) {
    this.socket.write(`${line}\r\n`);
    const res = await this.reply();
    if (!okCodes.includes(res.code)) {
      const shown = /^AUTH/i.test(line) ? line.split(" ").slice(0, 2).join(" ") : line.length > 60 ? `${line.slice(0, 60)}…` : line;
      throw new SmtpError(`SMTP ${shown} → ${res.code} ${res.lines.join(" / ")}`, res.code);
    }
    return res;
  }

  upgrade(host) {
    return new Promise((resolve, reject) => {
      const plain = this.socket;
      plain.removeAllListeners("data");
      plain.removeAllListeners("error");
      plain.removeAllListeners("close");
      const secure = tls.connect({ socket: plain, servername: host });
      secure.setTimeout(this.timeoutMs, () => secure.destroy(new SmtpError("SMTP TLS upgrade timed out")));
      secure.once("error", reject);
      secure.once("secureConnect", () => {
        this.buffer = "";
        this.attach(secure);
        resolve();
      });
    });
  }

  end() {
    try {
      this.socket.end();
      this.socket.destroy();
    } catch {
      /* already closed */
    }
  }
}

function capabilities(reply) {
  const caps = new Map();
  for (const line of reply.lines.slice(1)) {
    const [name, ...rest] = line.trim().split(/\s+/);
    if (name) caps.set(name.toUpperCase(), rest.join(" "));
  }
  return caps;
}

/**
 * Sends one already-built message. `to` may be a string or an array.
 */
export async function smtpSend(config, { from, to, message }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(addressOf);
  const socket = await openSocket(config.host, config.port, config.secure, config.timeoutMs || 15000);
  const conn = new SmtpConnection(socket, config.timeoutMs || 15000);
  try {
    const greeting = await conn.reply();
    if (greeting.code !== 220) throw new SmtpError(`SMTP greeting was ${greeting.code} ${greeting.lines.join(" ")}`, greeting.code);

    let caps = capabilities(await conn.command(`EHLO ${config.ehlo || "localhost"}`, [250]));
    if (!config.secure) {
      if (caps.has("STARTTLS")) {
        await conn.command("STARTTLS", [220]);
        await conn.upgrade(config.host);
        caps = capabilities(await conn.command(`EHLO ${config.ehlo || "localhost"}`, [250]));
      } else if (!config.allowInsecure) {
        throw new SmtpError("SMTP server does not offer STARTTLS; refusing to send credentials unencrypted");
      }
    }

    if (config.user) {
      const auth = (caps.get("AUTH") || "").toUpperCase();
      if (auth.includes("LOGIN") && !auth.includes("PLAIN")) {
        await conn.command("AUTH LOGIN", [334]);
        await conn.command(Buffer.from(config.user, "utf8").toString("base64"), [334]);
        await conn.command(Buffer.from(config.password, "utf8").toString("base64"), [235]);
      } else {
        const token = Buffer.from(`\0${config.user}\0${config.password}`, "utf8").toString("base64");
        await conn.command(`AUTH PLAIN ${token}`, [235]);
      }
    }

    await conn.command(`MAIL FROM:<${addressOf(from)}>`, [250]);
    for (const recipient of recipients) await conn.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await conn.command("DATA", [354]);
    const body = dotStuff(message).replace(/\r\n$/, "");
    await conn.command(`${body}\r\n.`, [250]);
    await conn.command("QUIT", [221]).catch(() => {});
  } finally {
    conn.end();
  }
}
