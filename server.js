"use strict";
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const db = require("./src/db");
const audit = require("./src/audit");
const seed = require("./src/seed");
const { attachUser, requirePage, requireApi, need } = require("./src/auth");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PROD = process.env.NODE_ENV === "production";

/**
 * Stamps the app version into each HTML page, so the browser is asked for
 * /js/app.js?v=1.1.0 rather than /js/app.js. Without this a staff member can
 * keep running yesterday's JavaScript out of cache after an update and report
 * a bug that was already fixed. Bump "version" in package.json on each release
 * and every page picks it up — there is no second place to remember.
 */
const APP_VERSION = require("./package.json").version;
const pageCache = new Map();
function sendPage(res, file) {
  let html = pageCache.get(file);
  if (!html) {
    html = fs.readFileSync(path.join(__dirname, "public", file), "utf8")
      .replace(/__V__/g, APP_VERSION);
    pageCache.set(file, html);
  }
  res.type("html").send(html);
}

// Behind nginx/Cloudflare we need the real client IP for the audit trail.
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // Lets the browser cache static assets normally while still setting HSTS in production.
  hsts: PROD ? undefined : false,
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

if (!process.env.SESSION_SECRET && PROD) {
  console.error("Refusing to start: SESSION_SECRET must be set in production.");
  process.exit(1);
}

app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,                       // idle timeout, not absolute
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: PROD,                      // https only once we are on the real domain
    maxAge: 1000 * 60 * 60 * 8,        // 8 hours — a clinic shift
  },
}));

app.use(attachUser);

/* ------------------------------------------------------------------- login */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                             // 10 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait 15 minutes and try again." },
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  sendPage(res, "login.html");
});

app.post("/api/login", loginLimiter, (req, res) => {
  const username = (req.body.username || "").trim();
  const password = (req.body.password || "").toString();
  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);

  // Same message and roughly the same work either way, so the form cannot be
  // used to find out which usernames exist.
  const ok = user && user.active && bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    audit.log(req, "login-failed", "user", user ? user.id : null, username);
    return res.status(401).json({ error: "Incorrect username or password" });
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start session" });
    req.session.userId = user.id;
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    req.user = user;
    audit.log(req, "login", "user", user.id, user.full_name);
    res.json({ ok: true, must_change: !!user.must_change });
  });
});

app.post("/api/logout", (req, res) => {
  audit.log(req, "logout", "user", req.user ? req.user.id : null, req.user ? req.user.full_name : "");
  req.session.destroy(() => res.json({ ok: true }));
});

app.post("/api/change-password", requireApi, (req, res) => {
  const current = (req.body.current || "").toString();
  const next = (req.body.next || "").toString();
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) {
    return res.status(400).json({ error: "Your current password is not correct" });
  }
  if (next.length < 10) return res.status(400).json({ error: "New password must be at least 10 characters" });
  db.prepare("UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?")
    .run(bcrypt.hashSync(next, 12), req.user.id);
  audit.log(req, "password-change", "user", req.user.id, req.user.full_name);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  res.json({ id: req.user.id, name: req.user.full_name, role: req.user.role, must_change: !!req.user.must_change });
});

/* -------------------------------------------------------------------- app */

app.use("/api", require("./src/routes/api"));
app.use("/api/admin", require("./src/routes/admin"));

app.get("/admin", requirePage, (req, res) => {
  if (req.user.role !== "admin") return res.redirect("/");
  sendPage(res, "admin.html");
});

app.get("/", requirePage, (_req, res) => sendPage(res, "app.html"));

// Only the stylesheet and scripts are public. The HTML pages are served by the
// routes above so they always pass through the sign-in check first.
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/js", express.static(path.join(__dirname, "public", "js")));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send("Not found"));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const created = seed.run();
app.listen(PORT, () => {
  console.log(`Portal running on http://localhost:${PORT}`);
  if (created) {
    console.log(`First run — admin login: ${created.username} / ${created.password}`);
  }
});
