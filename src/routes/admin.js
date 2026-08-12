"use strict";
/**
 * Everything the practice manages for itself: facilities, providers, exams,
 * statuses, the attorney and referring-doctor directories, and staff logins.
 * No developer required for any of it.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const audit = require("../audit");
const { requireApi, need } = require("../auth");

const router = express.Router();
router.use(requireApi, need("admin"));

/* Simple name/active/sort lists ------------------------------------------- */

const SIMPLE = {
  facilities: { table: "facilities", label: "Facility" },
  providers: { table: "providers", label: "Provider" },
  exams: { table: "exams", label: "Exam", extra: ["category"] },
  statuses: { table: "statuses", label: "Status", extra: ["kind"] },
};

Object.entries(SIMPLE).forEach(([key, cfg]) => {
  const extra = cfg.extra || [];

  router.get(`/${key}`, (_req, res) => {
    res.json(db.prepare(`SELECT * FROM ${cfg.table} ORDER BY sort, id`).all());
  });

  router.post(`/${key}`, (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: `${cfg.label} name is required` });
    const dup = db.prepare(`SELECT id FROM ${cfg.table} WHERE name = ? COLLATE NOCASE`).get(name);
    if (dup) return res.status(400).json({ error: `That ${cfg.label.toLowerCase()} already exists` });

    const maxSort = db.prepare(`SELECT COALESCE(MAX(sort), 0) m FROM ${cfg.table}`).get().m;
    const cols = ["name", "sort", ...extra];
    const vals = [name, maxSort + 1, ...extra.map(e => (req.body[e] || "").trim() || defaultFor(key, e))];
    const info = db.prepare(
      `INSERT INTO ${cfg.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
    ).run(...vals);
    audit.log(req, "create", key, info.lastInsertRowid, name);
    res.json({ id: info.lastInsertRowid });
  });

  router.put(`/${key}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const name = (req.body.name || row.name).trim();
    const active = req.body.active === undefined ? row.active : (req.body.active ? 1 : 0);
    const sets = ["name = ?", "active = ?", ...extra.map(e => `${e} = ?`)];
    const vals = [name, active, ...extra.map(e => (req.body[e] || row[e]))];
    db.prepare(`UPDATE ${cfg.table} SET ${sets.join(", ")} WHERE id = ?`).run(...vals, req.params.id);
    audit.log(req, "update", key, Number(req.params.id), `${row.name} → ${name}${active ? "" : " (deactivated)"}`);
    res.json({ ok: true });
  });

  /**
   * Deactivate rather than delete. A facility or status that is still attached to
   * old patient records must not vanish from history — deactivating hides it from
   * the dropdowns while leaving past records readable.
   */
  router.delete(`/${key}/:id`, (req, res) => {
    const row = db.prepare(`SELECT name FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    db.prepare(`UPDATE ${cfg.table} SET active = 0 WHERE id = ?`).run(req.params.id);
    audit.log(req, "deactivate", key, Number(req.params.id), row.name);
    res.json({ ok: true });
  });
});

function defaultFor(key, field) {
  if (key === "exams" && field === "category") return "Other";
  if (key === "statuses" && field === "kind") return "done";
  return "";
}

/* Directories: attorneys + referring doctors ------------------------------ */

const DIR = {
  attorneys: { table: "attorneys", fields: ["name", "firm", "phone", "email", "address", "city", "state", "zip"] },
  doctors: { table: "referring_doctors", fields: ["name", "practice", "phone", "email", "address", "city", "state", "zip"] },
};

Object.entries(DIR).forEach(([key, cfg]) => {
  router.get(`/${key}`, (_req, res) => {
    res.json(db.prepare(`SELECT * FROM ${cfg.table} ORDER BY name`).all());
  });

  router.post(`/${key}`, (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    const vals = cfg.fields.map(f => (req.body[f] || "").trim() || null);
    const info = db.prepare(
      `INSERT INTO ${cfg.table} (${cfg.fields.join(",")}) VALUES (${cfg.fields.map(() => "?").join(",")})`
    ).run(...vals);
    audit.log(req, "create", key, info.lastInsertRowid, name);
    res.json({ id: info.lastInsertRowid });
  });

  router.put(`/${key}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const vals = cfg.fields.map(f => (req.body[f] !== undefined ? ((req.body[f] || "").trim() || null) : row[f]));
    const active = req.body.active === undefined ? row.active : (req.body.active ? 1 : 0);
    db.prepare(`UPDATE ${cfg.table} SET ${cfg.fields.map(f => `${f} = ?`).join(", ")}, active = ? WHERE id = ?`)
      .run(...vals, active, req.params.id);
    audit.log(req, "update", key, Number(req.params.id), row.name);
    res.json({ ok: true });
  });

  router.delete(`/${key}/:id`, (req, res) => {
    const row = db.prepare(`SELECT name FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    db.prepare(`UPDATE ${cfg.table} SET active = 0 WHERE id = ?`).run(req.params.id);
    audit.log(req, "deactivate", key, Number(req.params.id), row.name);
    res.json({ ok: true });
  });
});

/* Staff logins ------------------------------------------------------------ */

const ROLES = ["admin", "staff", "auth", "viewer"];

router.get("/users", (_req, res) => {
  res.json(db.prepare(
    "SELECT id, username, full_name, role, active, created_at, last_login_at FROM users ORDER BY full_name"
  ).all());
});

router.post("/users", (req, res) => {
  const username = (req.body.username || "").trim();
  const fullName = (req.body.full_name || "").trim();
  const role = ROLES.includes(req.body.role) ? req.body.role : "staff";
  const password = (req.body.password || "").trim();
  if (!username || !fullName) return res.status(400).json({ error: "Username and full name are required" });
  if (password.length < 10) return res.status(400).json({ error: "Password must be at least 10 characters" });
  if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
    return res.status(400).json({ error: "That username is already taken" });
  }
  const info = db.prepare(
    "INSERT INTO users (username, full_name, role, password_hash, must_change) VALUES (?,?,?,?,1)"
  ).run(username, fullName, role, bcrypt.hashSync(password, 12));
  audit.log(req, "create", "user", info.lastInsertRowid, `${fullName} (${role})`);
  res.json({ id: info.lastInsertRowid });
});

router.put("/users/:id", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "Not found" });

  const fullName = (req.body.full_name || u.full_name).trim();
  const role = ROLES.includes(req.body.role) ? req.body.role : u.role;
  let active = req.body.active === undefined ? u.active : (req.body.active ? 1 : 0);

  // Never let the last working admin be locked out of the system.
  if (u.role === "admin" && (role !== "admin" || !active)) {
    const others = db.prepare(
      "SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1 AND id != ?"
    ).get(u.id).n;
    if (others === 0) {
      return res.status(400).json({ error: "This is the only active administrator — promote someone else first" });
    }
  }

  db.prepare("UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?")
    .run(fullName, role, active, u.id);

  if (req.body.password) {
    const pw = String(req.body.password).trim();
    if (pw.length < 10) return res.status(400).json({ error: "Password must be at least 10 characters" });
    db.prepare("UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?")
      .run(bcrypt.hashSync(pw, 12), u.id);
    audit.log(req, "password-reset", "user", u.id, fullName);
  }

  audit.log(req, "update", "user", u.id, `${fullName} (${role})${active ? "" : " — access revoked"}`);
  res.json({ ok: true });
});

/* Audit trail ------------------------------------------------------------- */

router.get("/audit", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(db.prepare(
    "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?"
  ).all(limit));
});

module.exports = router;
