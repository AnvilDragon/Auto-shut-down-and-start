"use strict";
// Sylvia's HRT Log server. Zero dependencies: node:http + node:sqlite + node:crypto + node:zlib.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SECURE_COOKIE = process.env.COOKIE_SECURE === "1"; // also auto-on behind X-Forwarded-Proto: https
const SESSION_DAYS = 30;
const MAX_BODY = 5 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "hrt.db"));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS user(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, pw TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session(h TEXT PRIMARY KEY, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries(date TEXT PRIMARY KEY, time TEXT, note TEXT,
  len REAL, flac REAL, half REAL, erect REAL, tL REAL, tR REAL, bust REAL, under REAL, weight REAL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS shots(id INTEGER PRIMARY KEY, date TEXT NOT NULL, ml REAL NOT NULL, site TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS labs(id INTEGER PRIMARY KEY, date TEXT NOT NULL, e2 REAL, t REAL, done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS shots_date ON shots(date);
CREATE INDEX IF NOT EXISTS labs_date ON labs(date);
`);

// ---------- validation (mirrors the client) ----------
const FIELDS = ["len", "flac", "half", "erect", "tL", "tR", "bust", "under", "weight"];
const SITES = ["Thigh L", "Thigh R", "Thigh", "Belly", "Glute", "Arm"];
const DRE = /^\d{4}-\d{2}-\d{2}$/, TRE = /^\d{2}:\d{2}$/;
const okDate = s => typeof s === "string" && DRE.test(s) && isFinite(Date.parse(s + "T00:00:00Z"));
const pos = v => { const n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) && n >= 0 && n < 100000 ? n : null; };
function clean(s) {
  s = s && typeof s === "object" ? s : {};
  const tp = Array.isArray(s.targetPeak) && pos(s.targetPeak[0]) != null && pos(s.targetPeak[1]) != null ? [pos(s.targetPeak[0]), pos(s.targetPeak[1])] : [380, 440];
  const o = { start: okDate(s.start) ? s.start : "", conc: pos(s.conc) || 40, shotEvery: pos(s.shotEvery) || 7, targetPeak: tp, entries: [], shots: [], labs: [] };
  const seen = new Set();
  for (const e of Array.isArray(s.entries) ? s.entries : []) {
    if (!e || !okDate(e.date) || seen.has(e.date)) continue;
    seen.add(e.date);
    const x = { date: e.date };
    for (const f of FIELDS) { const n = pos(e[f]); if (n != null) x[f] = n; }
    if (typeof e.time === "string" && TRE.test(e.time)) x.time = e.time;
    if (typeof e.note === "string" && e.note) x.note = e.note.slice(0, 2000);
    o.entries.push(x);
  }
  for (const e of Array.isArray(s.shots) ? s.shots : []) if (e && okDate(e.date) && pos(e.ml) != null) o.shots.push({ date: e.date, ml: pos(e.ml), site: SITES.includes(e.site) ? e.site : "Thigh" });
  for (const e of Array.isArray(s.labs) ? s.labs : []) {
    if (!e || !okDate(e.date)) continue;
    const x = { date: e.date };
    if (pos(e.e2) != null) x.e2 = pos(e.e2);
    if (pos(e.t) != null) x.t = pos(e.t);
    x.done = x.e2 != null || x.t != null;
    o.labs.push(x);
  }
  for (const k of ["entries", "shots", "labs"]) o[k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return o;
}

// ---------- data access ----------
const getSetting = k => { const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k); return r ? JSON.parse(r.v) : null; };
const setSetting = (k, v) => db.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, JSON.stringify(v));
const getRev = () => getSetting("rev") || 0;

function readState() {
  const entries = db.prepare("SELECT * FROM entries ORDER BY date").all().map(r => {
    const x = {}; for (const k in r) if (r[k] != null) x[k] = r[k]; return x;
  });
  const shots = db.prepare("SELECT date,ml,site FROM shots ORDER BY date,id").all();
  const labs = db.prepare("SELECT date,e2,t,done FROM labs ORDER BY date,id").all().map(r => {
    const x = { date: r.date }; if (r.e2 != null) x.e2 = r.e2; if (r.t != null) x.t = r.t; x.done = !!r.done; return x;
  });
  const m = getSetting("meta") || {};
  return clean({ start: m.start, conc: m.conc, shotEvery: m.shotEvery, targetPeak: m.targetPeak, entries, shots, labs });
}
function writeState(raw) {
  const s = clean(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM entries; DELETE FROM shots; DELETE FROM labs");
    const ie = db.prepare(`INSERT INTO entries(date,time,note,${FIELDS.join(",")}) VALUES(?,?,?,${FIELDS.map(() => "?").join(",")})`);
    for (const e of s.entries) ie.run(e.date, e.time ?? null, e.note ?? null, ...FIELDS.map(f => e[f] ?? null));
    const is = db.prepare("INSERT INTO shots(date,ml,site) VALUES(?,?,?)");
    for (const x of s.shots) is.run(x.date, x.ml, x.site);
    const il = db.prepare("INSERT INTO labs(date,e2,t,done) VALUES(?,?,?,?)");
    for (const x of s.labs) il.run(x.date, x.e2 ?? null, x.t ?? null, x.done ? 1 : 0);
    setSetting("meta", { start: s.start, conc: s.conc, shotEvery: s.shotEvery, targetPeak: s.targetPeak });
    const rev = getRev() + 1; setSetting("rev", rev);
    db.exec("COMMIT");
    return rev;
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ---------- auth ----------
const hasUser = () => !!db.prepare("SELECT 1 FROM user WHERE id=1").get();
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
function checkPw(pw, stored) {
  const [, s, h] = stored.split("$");
  const want = Buffer.from(h, "base64");
  const got = crypto.scryptSync(pw, Buffer.from(s, "base64"), want.length, SCRYPT);
  return crypto.timingSafeEqual(got, want);
}
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
function newSession() {
  const t = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO session(h,exp) VALUES(?,?)").run(sha(t), Date.now() + SESSION_DAYS * 864e5);
  return t;
}
function parseCookies(req) {
  const o = {}; for (const p of (req.headers.cookie || "").split(";")) { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } return o;
}
function sessionHash(req) {
  const t = parseCookies(req).hrt; if (!t) return null;
  const h = sha(t), r = db.prepare("SELECT exp FROM session WHERE h=?").get(h);
  return r && r.exp > Date.now() ? h : null;
}
const isHttps = req => SECURE_COOKIE || req.headers["x-forwarded-proto"] === "https";
const cookie = (req, v, maxAge) => `hrt=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;

// brute-force protection: 5 failures => 15 min lock, per client IP and globally (single user)
const fails = new Map();
const ipOf = req => req.socket.remoteAddress || "?";
function locked(keys) { const now = Date.now(); return keys.some(k => { const f = fails.get(k); return f && f.until > now; }); }
function failed(keys) { for (const k of keys) { const f = fails.get(k) || { n: 0, until: 0 }; if (++f.n >= (k === "*" ? 20 : 5)) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(k, f); } }
const cleared = keys => keys.forEach(k => fails.delete(k));

// ---------- http helpers ----------
const SEC = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Cross-Origin-Opener-Policy": "same-origin",
};
function send(res, code, body, headers = {}) {
  res.writeHead(code, { ...SEC, "Cache-Control": "no-store", ...headers });
  res.end(body);
}
const json = (res, code, obj, h) => send(res, code, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", ...h });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("bad json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

// ---------- static files (loaded once, pre-gzipped, ETag revalidation) ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const statics = new Map();
(function loadStatics(dir, base = "") {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name), url = base + "/" + f.name;
    if (f.isDirectory()) { loadStatics(p, url); continue; }
    const buf = fs.readFileSync(p), type = TYPES[path.extname(f.name)];
    if (!type) continue;
    const text = /^(text|image\/svg|application\/manifest)|javascript/.test(type);
    statics.set(url, { type, buf, gz: text ? zlib.gzipSync(buf, { level: 9 }) : null, etag: '"' + sha(buf.toString("base64")).slice(0, 20) + '"' });
  }
})(path.join(__dirname, "public"));
function serveStatic(req, res, url) {
  const f = statics.get(url === "/" ? "/index.html" : url);
  if (!f) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
  const h = { "Content-Type": f.type, ETag: f.etag, "Cache-Control": "no-cache", Vary: "Accept-Encoding" };
  if (req.headers["if-none-match"] === f.etag) return send(res, 304, "", h);
  if (f.gz && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) return send(res, 200, f.gz, { ...h, "Content-Encoding": "gzip", "Content-Length": f.gz.length });
  send(res, 200, f.buf, { ...h, "Content-Length": f.buf.length });
}

// ---------- export ----------
const CSV_COLS = ["type", "date", "time", ...FIELDS, "note", "ml", "site", "e2", "t"];
const csvCell = v => { if (v == null) return ""; const s = String(v).replace(/^([=+\-@\t\r])/, "'$1"); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function toCsv(s) {
  const rows = [CSV_COLS.join(",")];
  for (const [type, list] of [["entry", s.entries], ["shot", s.shots], ["lab", s.labs]]) for (const x of list) rows.push(CSV_COLS.map(c => (c === "type" ? type : csvCell(x[c]))).join(","));
  return "﻿" + rows.join("\r\n") + "\r\n";
}
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------- routes ----------
async function api(req, res, url) {
  const m = req.method;
  if (url === "/api/status" && m === "GET") return json(res, 200, { setup: hasUser(), authed: !!(hasUser() && sessionHash(req)) });

  if (m !== "GET") {
    // CSRF: same-origin only (plus SameSite=Strict cookie)
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) return json(res, 403, { error: "bad origin" });
    if (!(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { error: "json only" });
  }

  if (url === "/api/setup" && m === "POST") {
    if (hasUser()) return json(res, 409, { error: "already set up" });
    const b = await readBody(req), u = String(b.username || "").trim(), p = String(b.password || "");
    if (u.length < 1 || u.length > 64) return json(res, 400, { error: "Enter a username." });
    if (p.length < 10 || p.length > 256) return json(res, 400, { error: "Password must be at least 10 characters." });
    db.prepare("INSERT INTO user(id,username,pw) VALUES(1,?,?)").run(u, hashPw(p));
    if (!db.prepare("SELECT 1 FROM entries LIMIT 1").get() && !db.prepare("SELECT 1 FROM shots LIMIT 1").get()) {
      try { writeState(JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"))); } catch {}
    }
    return json(res, 200, { ok: true }, { "Set-Cookie": cookie(req, newSession(), SESSION_DAYS * 86400) });
  }

  if (url === "/api/login" && m === "POST") {
    const keys = [ipOf(req), "*"];
    if (locked(keys)) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const b = await readBody(req), u = db.prepare("SELECT username,pw FROM user WHERE id=1").get();
    const ok = u && String(b.username || "").trim().toLowerCase() === u.username.toLowerCase() && checkPw(String(b.password || ""), u.pw);
    if (!ok) { failed(keys); return json(res, 401, { error: "Wrong username or password." }); }
    cleared(keys);
    db.prepare("DELETE FROM session WHERE exp<?").run(Date.now());
    return json(res, 200, { ok: true }, { "Set-Cookie": cookie(req, newSession(), SESSION_DAYS * 86400) });
  }

  const sh = hasUser() ? sessionHash(req) : null;
  if (!sh) return json(res, 401, { error: "auth" });

  if (url === "/api/logout" && m === "POST") {
    db.prepare("DELETE FROM session WHERE h=?").run(sh);
    return json(res, 200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) });
  }
  if (url === "/api/state" && m === "GET") return json(res, 200, { rev: getRev(), state: readState() });
  if (url === "/api/state" && m === "PUT") {
    const b = await readBody(req);
    if (b.rev !== getRev()) return json(res, 409, { error: "stale", rev: getRev() });
    return json(res, 200, { rev: writeState(b.state) });
  }
  if (url === "/api/import" && m === "POST") {
    const b = await readBody(req), s = b.state || b;
    if (!s || !Array.isArray(s.entries) || !Array.isArray(s.shots) || !Array.isArray(s.labs)) return json(res, 400, { error: "That file isn't an HRT Log export." });
    return json(res, 200, { rev: writeState(s) });
  }
  if (url === "/api/password" && m === "POST") {
    const b = await readBody(req), u = db.prepare("SELECT pw FROM user WHERE id=1").get(), p = String(b.next || "");
    const keys = [ipOf(req), "*"];
    if (locked(keys)) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    if (!checkPw(String(b.current || ""), u.pw)) { failed(keys); return json(res, 401, { error: "Current password is wrong." }); }
    if (p.length < 10 || p.length > 256) return json(res, 400, { error: "New password must be at least 10 characters." });
    db.prepare("UPDATE user SET pw=? WHERE id=1").run(hashPw(p));
    db.prepare("DELETE FROM session WHERE h<>?").run(sh); // sign out other devices
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "not found" });
}
async function apiGet(req, res, url, q) {
  if (!(hasUser() && sessionHash(req))) return json(res, 401, { error: "auth" });
  if (url === "/api/export") {
    const f = q.get("format") || "json";
    if (f === "csv") return send(res, 200, toCsv(readState()), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="hrt-log-${stamp()}.csv"` });
    if (f === "sqlite") {
      const tmp = path.join(DATA_DIR, `backup-${process.pid}.tmp`);
      try { fs.rmSync(tmp, { force: true }); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); const buf = fs.readFileSync(tmp);
        return send(res, 200, buf, { "Content-Type": "application/vnd.sqlite3", "Content-Disposition": `attachment; filename="hrt-log-${stamp()}.db"` }); }
      finally { fs.rmSync(tmp, { force: true }); }
    }
    return send(res, 200, JSON.stringify({ app: "hrt-log", version: 1, exported: new Date().toISOString(), state: readState() }, null, 2), { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="hrt-log-${stamp()}.json"` });
  }
  return json(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (p === "/healthz") return send(res, 200, "ok", { "Content-Type": "text/plain" });
    if (p === "/api/export" && req.method === "GET") return await apiGet(req, res, p, u.searchParams);
    if (p.startsWith("/api/")) return await api(req, res, p);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    serveStatic(req, res, p);
  } catch (e) {
    if (e.code === 413 || e.code === 400) return json(res, e.code, { error: e.message });
    console.error(e); if (!res.headersSent) json(res, 500, { error: "server error" });
  }
});
server.keepAliveTimeout = 65e3; server.headersTimeout = 20e3; server.requestTimeout = 30e3;
server.listen(PORT, "0.0.0.0", () => console.log(`HRT Log listening on :${PORT}, data in ${DATA_DIR}`));
const stop = () => { server.close(() => { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
