#!/usr/bin/env node
/**
 * Local dev server for the PENTAX Loupes UK site and the loupe passport.
 *
 *  - serves the static site with HTTP Range support (the hero video scrubs
 *    inside a ~37 MB file, so Range requests are not optional — see README)
 *  - applies the same clean-URL rewrites as vercel.json
 *    (/p/:token → passport.html, /invite/:token → invite.html, /manage)
 *  - mounts every api/**.js handler the way Vercel does (file-based routes,
 *    [param] folders become req.query values)
 *  - reads a local .env and falls back to the development admin key
 *
 * Usage: node scripts/dev-server.mjs [--port 8000] [--host 127.0.0.1]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argValue("--port", process.env.PORT || 8000));
const HOST = argValue("--host", "127.0.0.1");

loadEnv(path.join(ROOT, ".env"));
if (!process.env.PASSPORT_ADMIN_KEY) {
  process.env.PASSPORT_ADMIN_KEY = "pentax-dev";
  console.log('PASSPORT_ADMIN_KEY is not set — using the development key "pentax-dev" for /manage.');
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};
const NO_STORE = new Set([".html", ".css", ".js", ".mjs", ".json"]);
const REWRITES = [
  [/^\/p\/[^/]+\/?$/, "/passport.html"],
  [/^\/invite\/[^/]+\/?$/, "/invite.html"],
  [/^\/manage\/?$/, "/manage.html"],
];

const routes = buildRoutes(path.join(ROOT, "api"));
const handlerCache = new Map();

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on("finish", () => console.log(`${res.statusCode} ${req.method} ${req.url} (${Date.now() - started} ms)`));
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return plain(res, 400, "Bad request");
    }
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname, url);
    for (const [pattern, destination] of REWRITES) {
      if (pattern.test(pathname)) {
        pathname = destination;
        break;
      }
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) plain(res, 500, "Server error");
    else res.end();
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: node scripts/dev-server.mjs --port ${PORT + 1}`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  const redis = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  console.log(
    [
      "PENTAX Loupes UK — dev server",
      `  Site              ${base}/`,
      `  Example passport  ${base}/p/example`,
      `  Example invite    ${base}/invite/example`,
      `  Passport manager  ${base}/manage   (key: ${process.env.PASSPORT_ADMIN_KEY})`,
      `  Data store        ${redis ? "Redis (REST)" : path.join(ROOT, ".data", "passport-store.json")}`,
      "",
    ].join("\n"),
  );
});

/* ---------------------------------------------------------------------- */

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function buildRoutes(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|mjs)$/.test(entry.name) || entry.name.startsWith("_")) continue;
      const rel = path.relative(dir, full).split(path.sep).join("/").replace(/\.(js|mjs)$/, "");
      const segments = rel.split("/");
      if (segments[segments.length - 1] === "index") segments.pop();
      const params = [];
      const pattern = segments
        .map((segment) => {
          const match = segment.match(/^\[(\.\.\.)?(\w+)\]$/);
          if (match) {
            params.push(match[2]);
            return match[1] ? "(.+)" : "([^/]+)";
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");
      found.push({ file: full, regex: new RegExp(`^/api/${pattern}/?$`), params });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found.sort((a, b) => a.params.length - b.params.length);
}

async function handleApi(req, res, pathname, url) {
  for (const route of routes) {
    const match = pathname.match(route.regex);
    if (!match) continue;
    let mod = handlerCache.get(route.file);
    if (!mod) {
      mod = await import(pathToFileURL(route.file).href);
      handlerCache.set(route.file, mod);
    }
    const query = Object.fromEntries(url.searchParams);
    route.params.forEach((name, i) => {
      query[name] = match[i + 1];
    });
    req.query = query;
    if (typeof mod.default !== "function") return json(res, 500, { error: "Handler has no default export." });
    await mod.default(req, res);
    return;
  }
  json(res, 404, { error: "Not found." });
}

function serveStatic(req, res, pathname) {
  const file = path.resolve(ROOT, `.${pathname}`);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return plain(res, 403, "Forbidden");
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return plain(res, 404, "Not found");
  }
  if (stat.isDirectory()) return serveStatic(req, res, `${pathname.replace(/\/$/, "")}/index.html`);

  const ext = path.extname(file).toLowerCase();
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": NO_STORE.has(ext) ? "no-store" : "public, max-age=3600",
  };
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && (range[1] !== "" || range[2] !== "")) {
    if (range[1] === "") {
      start = Math.max(0, stat.size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== "") end = Math.min(Number(range[2]), stat.size - 1);
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}

function plain(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
