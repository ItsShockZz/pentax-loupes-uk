// lib/passport/mail.js — the SMTP transport against a fake server, message
// building, and the notify() wiring that api/lead.js relies on.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { addressOf, buildMessage, dotStuff, encodeAddress, encodeHeaderText, smtpConfig, smtpSend } from "../lib/passport/mail.js";

/** A tiny SMTP server that records the conversation and the message body. */
function fakeSmtpServer({ authMethods = "PLAIN LOGIN", failRcpt = false } = {}) {
  const sessions = [];
  const server = net.createServer((socket) => {
    const session = { commands: [], data: "" };
    sessions.push(session);
    let buffer = "";
    let inData = false;
    socket.write("220 fake.smtp ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 queued as 42\r\n");
          } else {
            session.data += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          }
          continue;
        }
        session.commands.push(line);
        if (line.startsWith("EHLO")) socket.write(`250-fake.smtp\r\n250-AUTH ${authMethods}\r\n250 8BITMIME\r\n`);
        else if (line.startsWith("AUTH PLAIN")) socket.write("235 authenticated\r\n");
        else if (line === "AUTH LOGIN") socket.write("334 VXNlcm5hbWU6\r\n");
        else if (session.commands[session.commands.length - 2] === "AUTH LOGIN") socket.write("334 UGFzc3dvcmQ6\r\n");
        else if (session.commands[session.commands.length - 3] === "AUTH LOGIN") socket.write("235 authenticated\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write("250 sender ok\r\n");
        else if (line.startsWith("RCPT TO")) socket.write(failRcpt ? "550 no such user\r\n" : "250 recipient ok\r\n");
        else if (line === "DATA") {
          inData = true;
          session.data = "";
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("500 unknown\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, sessions }));
  });
}

const servers = [];
after(() => servers.forEach((s) => s.close()));

function decodeBody(data) {
  const [, body] = data.split("\r\n\r\n");
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
}

test("sends a message through SMTP with PLAIN auth, correct envelope and dot-stuffed body", async () => {
  const { server, port, sessions } = await fakeSmtpServer();
  servers.push(server);
  const message = buildMessage({
    from: "PENTAX Loupes UK <puyan@pentaxloupes.com>",
    to: "drpuyanheydari@example.com",
    subject: "New lead: Demonstration request — Dr Priya Shah",
    text: "A new lead has been submitted.\n.starts with a dot\nMagnification: 3.5×",
  });
  await smtpSend(
    { host: "127.0.0.1", port, secure: false, allowInsecure: true, user: "puyan@pentaxloupes.com", password: "pa ss", ehlo: "pentaxloupes.co.uk", timeoutMs: 5000 },
    { from: "PENTAX Loupes UK <puyan@pentaxloupes.com>", to: "drpuyanheydari@example.com", message },
  );
  const [session] = sessions;
  assert.equal(session.commands[0], "EHLO pentaxloupes.co.uk");
  const auth = session.commands.find((c) => c.startsWith("AUTH PLAIN "));
  assert.equal(Buffer.from(auth.slice("AUTH PLAIN ".length), "base64").toString("utf8"), "\0puyan@pentaxloupes.com\0pa ss");
  assert.ok(session.commands.includes("MAIL FROM:<puyan@pentaxloupes.com>"));
  assert.ok(session.commands.includes("RCPT TO:<drpuyanheydari@example.com>"));
  assert.ok(session.commands.includes("DATA"));
  assert.equal(session.commands[session.commands.length - 1], "QUIT");
  assert.match(session.data, /^From: "PENTAX Loupes UK" <puyan@pentaxloupes.com>\r\n/);
  assert.match(session.data, /\r\nTo: drpuyanheydari@example.com\r\n/);
  assert.match(session.data, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/, "non-ASCII subject is RFC 2047 encoded");
  assert.match(session.data, /\r\nContent-Transfer-Encoding: base64\r\n/);
  assert.equal(decodeBody(session.data), "A new lead has been submitted.\n.starts with a dot\nMagnification: 3.5×");
});

test("falls back to AUTH LOGIN when the server offers nothing else", async () => {
  const { server, port, sessions } = await fakeSmtpServer({ authMethods: "LOGIN" });
  servers.push(server);
  await smtpSend(
    { host: "127.0.0.1", port, secure: false, allowInsecure: true, user: "u@example.com", password: "secret", timeoutMs: 5000 },
    { from: "u@example.com", to: "t@example.com", message: buildMessage({ from: "u@example.com", to: "t@example.com", subject: "Hi", text: "x" }) },
  );
  const [session] = sessions;
  const i = session.commands.indexOf("AUTH LOGIN");
  assert.ok(i >= 0);
  assert.equal(Buffer.from(session.commands[i + 1], "base64").toString(), "u@example.com");
  assert.equal(Buffer.from(session.commands[i + 2], "base64").toString(), "secret");
});

test("a rejected recipient surfaces the server's reason", async () => {
  const { server, port } = await fakeSmtpServer({ failRcpt: true });
  servers.push(server);
  await assert.rejects(
    smtpSend(
      { host: "127.0.0.1", port, secure: false, allowInsecure: true, user: "u@example.com", password: "p", timeoutMs: 5000 },
      { from: "u@example.com", to: "nobody@example.com", message: buildMessage({ from: "u@example.com", to: "nobody@example.com", subject: "Hi", text: "x" }) },
    ),
    /550 no such user/,
  );
});

test("refuses to send a password over a plain connection unless explicitly allowed", async () => {
  const { server, port } = await fakeSmtpServer();
  servers.push(server);
  await assert.rejects(
    smtpSend(
      { host: "127.0.0.1", port, secure: false, allowInsecure: false, user: "u@example.com", password: "p", timeoutMs: 5000 },
      { from: "u@example.com", to: "t@example.com", message: "Subject: x\r\n\r\nx\r\n" },
    ),
    /STARTTLS/,
  );
});

test("message helpers", () => {
  assert.equal(encodeHeaderText("Plain subject"), "Plain subject");
  assert.equal(encodeHeaderText("Demo — 3.5×"), `=?UTF-8?B?${Buffer.from("Demo — 3.5×", "utf8").toString("base64")}?=`);
  assert.equal(addressOf("PENTAX Loupes UK <puyan@pentaxloupes.com>"), "puyan@pentaxloupes.com");
  assert.equal(addressOf(" a@b.co "), "a@b.co");
  assert.equal(encodeAddress("a@b.co"), "a@b.co");
  assert.equal(encodeAddress("Dr Priya Shah <p@example.com>"), '"Dr Priya Shah" <p@example.com>');
  assert.equal(dotStuff("a\n.b\r\n..c\n"), "a\r\n..b\r\n...c\r\n");
});

test("SMTP configuration comes from the environment with sensible defaults", () => {
  assert.equal(smtpConfig({}), null);
  const cfg = smtpConfig({ SMTP_HOST: "ssl0.ovh.net", SMTP_USER: "puyan@pentaxloupes.com", SMTP_PASSWORD: "x" });
  assert.equal(cfg.port, 465);
  assert.equal(cfg.secure, true);
  assert.equal(cfg.allowInsecure, false);
  const starttls = smtpConfig({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_PORT: "587" });
  assert.equal(starttls.secure, false);
  const forced = smtpConfig({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_PORT: "2525", SMTP_SECURE: "true" });
  assert.equal(forced.secure, true);
  const gmail = smtpConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "someone@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" });
  assert.equal(gmail.password, "abcdefghijklmnop", "Google app-password spacing is stripped");
  const other = smtpConfig({ SMTP_HOST: "mail.example.com", SMTP_USER: "u@example.com", SMTP_PASSWORD: "pa ss" });
  assert.equal(other.password, "pa ss", "other providers keep the password exactly");
});

test("notify() goes to the UK team's inbox by default", async () => {
  const { server, port, sessions } = await fakeSmtpServer();
  servers.push(server);
  const saved = { ...process.env };
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_SECURE: "false",
    SMTP_INSECURE: "1",
    SMTP_USER: "someone@gmail.com",
    SMTP_PASSWORD: "abcd efgh ijkl mnop",
  });
  delete process.env.PASSPORT_NOTIFY_TO;
  delete process.env.PASSPORT_NOTIFY_FROM;
  try {
    const { notify, DEFAULT_NOTIFY_TO } = await import("../lib/passport/service.js");
    assert.equal(DEFAULT_NOTIFY_TO, "drpuyanheydari@gmail.com");
    assert.equal(await notify({ subject: "New lead", lines: ["hello"] }), true);
    const session = sessions[sessions.length - 1];
    assert.ok(session.commands.includes(`RCPT TO:<${DEFAULT_NOTIFY_TO}>`));
    const auth = session.commands.find((c) => c.startsWith("AUTH PLAIN "));
    assert.equal(Buffer.from(auth.slice("AUTH PLAIN ".length), "base64").toString("utf8"), "\0someone@gmail.com\0abcdefghijklmnop");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("notify() delivers a new-lead alert through SMTP when configured", async () => {
  const { server, port, sessions } = await fakeSmtpServer();
  servers.push(server);
  const saved = { ...process.env };
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_SECURE: "false",
    SMTP_INSECURE: "1",
    SMTP_USER: "puyan@pentaxloupes.com",
    SMTP_PASSWORD: "pw",
    PASSPORT_NOTIFY_TO: "drpuyanheydari@example.com",
  });
  delete process.env.PASSPORT_NOTIFY_FROM;
  try {
    const { notify, notificationsConfigured } = await import("../lib/passport/service.js");
    assert.equal(notificationsConfigured(), true);
    const ok = await notify({ subject: "New lead: Quote request — Mr Tom Okafor", lines: ["A new quote request has been submitted.", "Name: Mr Tom Okafor"], replyTo: "tom@example.com" });
    assert.equal(ok, true);
    const [session] = sessions;
    assert.ok(session.commands.includes("RCPT TO:<drpuyanheydari@example.com>"));
    assert.match(session.data, /\r\nReply-To: tom@example.com\r\n/);
    assert.match(decodeBody(session.data), /Name: Mr Tom Okafor/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
