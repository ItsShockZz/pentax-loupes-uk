/**
 * Key-value storage for passports.
 *
 *  - Production: Redis over REST (Vercel's Upstash integration injects
 *    KV_REST_API_URL / KV_REST_API_TOKEN; plain Upstash uses
 *    UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). No npm dependency —
 *    the REST protocol is a JSON array of command arguments.
 *  - Local development / tests: a JSON file in .data/ (git-ignored) that
 *    implements the same handful of commands.
 *
 * Both expose: get, set (nx/ex), del, incr, expire, sadd, srem, smembers, mget.
 * Values are always strings; callers JSON-encode records themselves.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (process.env.PASSPORT_DATA_DIR || !process.env.VERCEL) {
    return fileStore(process.env.PASSPORT_DATA_DIR || defaultDataDir());
  }
  return null;
}

export function describeStore(store) {
  return store ? { kind: store.kind, configured: true } : { kind: "none", configured: false };
}

function defaultDataDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".data");
}

/* ---------------------------------------------------------------------- */
/* Redis over REST                                                         */
/* ---------------------------------------------------------------------- */

function redisStore(url, token) {
  async function command(...args) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      throw new Error(`Storage error: ${(data && data.error) || res.status}`);
    }
    return data.result;
  }

  return {
    kind: "redis",
    get: (key) => command("GET", key),
    async set(key, value, opts = {}) {
      const args = ["SET", key, value];
      if (opts.nx) args.push("NX");
      if (opts.ex) args.push("EX", String(opts.ex));
      const result = await command(...args);
      return result === "OK";
    },
    del: (key) => command("DEL", key),
    incr: (key) => command("INCR", key),
    expire: (key, seconds) => command("EXPIRE", key, String(seconds)),
    sadd: (key, ...members) => command("SADD", key, ...members),
    srem: (key, ...members) => command("SREM", key, ...members),
    smembers: (key) => command("SMEMBERS", key),
    mget: (keys) => (keys.length ? command("MGET", ...keys) : Promise.resolve([])),
  };
}

/* ---------------------------------------------------------------------- */
/* JSON file (development)                                                 */
/* ---------------------------------------------------------------------- */

function fileStore(dir) {
  const file = path.join(dir, "passport-store.json");

  function load() {
    try {
      const db = JSON.parse(fs.readFileSync(file, "utf8"));
      return { strings: db.strings || {}, sets: db.sets || {} };
    } catch {
      return { strings: {}, sets: {} };
    }
  }
  function save(db) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
  }
  function alive(entry) {
    return Boolean(entry) && (entry.exp == null || entry.exp > Date.now());
  }
  function read(db, key) {
    const entry = db.strings[key];
    return alive(entry) ? entry.value : null;
  }
  async function mutate(fn) {
    const db = load();
    const result = fn(db);
    save(db);
    return result;
  }

  return {
    kind: "file",
    dir,
    async get(key) {
      return read(load(), key);
    },
    set(key, value, opts = {}) {
      return mutate((db) => {
        if (opts.nx && read(db, key) !== null) return false;
        db.strings[key] = { value: String(value), exp: opts.ex ? Date.now() + opts.ex * 1000 : null };
        return true;
      });
    },
    del(key) {
      return mutate((db) => {
        const had = key in db.strings || key in db.sets;
        delete db.strings[key];
        delete db.sets[key];
        return had ? 1 : 0;
      });
    },
    incr(key) {
      return mutate((db) => {
        const current = Number(read(db, key)) || 0;
        const next = current + 1;
        const exp = alive(db.strings[key]) ? db.strings[key].exp : null;
        db.strings[key] = { value: String(next), exp };
        return next;
      });
    },
    expire(key, seconds) {
      return mutate((db) => {
        if (!alive(db.strings[key])) return 0;
        db.strings[key].exp = Date.now() + seconds * 1000;
        return 1;
      });
    },
    sadd(key, ...members) {
      return mutate((db) => {
        const set = new Set(db.sets[key] || []);
        let added = 0;
        for (const m of members) {
          if (!set.has(m)) {
            set.add(m);
            added++;
          }
        }
        db.sets[key] = [...set];
        return added;
      });
    },
    srem(key, ...members) {
      return mutate((db) => {
        const set = new Set(db.sets[key] || []);
        let removed = 0;
        for (const m of members) if (set.delete(m)) removed++;
        db.sets[key] = [...set];
        return removed;
      });
    },
    async smembers(key) {
      return [...(load().sets[key] || [])];
    },
    async mget(keys) {
      const db = load();
      return keys.map((key) => read(db, key));
    },
  };
}
