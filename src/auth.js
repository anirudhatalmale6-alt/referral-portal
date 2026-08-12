"use strict";
const db = require("./db");

/**
 * Roles
 *   admin  — everything, including the Admin screen (lists, users)
 *   staff  — front desk: register patients, schedule, notes, reports
 *   auth   — authorisation dept: sees everything, may change LOP + add notes,
 *            but cannot delete patients or touch the Admin screen
 *   viewer — read only
 */
const CAN = {
  admin:  { read: true, write: true, lop: true, delete: true, admin: true },
  staff:  { read: true, write: true, lop: true, delete: false, admin: false },
  auth:   { read: true, write: false, lop: true, delete: false, admin: false },
  viewer: { read: true, write: false, lop: false, delete: false, admin: false },
};

function permsFor(role) {
  return CAN[role] || CAN.viewer;
}

function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  const u = db.prepare(
    "SELECT id, username, full_name, role, active, must_change FROM users WHERE id = ?"
  ).get(req.session.userId);
  if (!u || !u.active) return null;
  return u;
}

/** Attaches req.user + req.perms when signed in. Never rejects. */
function attachUser(req, _res, next) {
  const u = currentUser(req);
  req.user = u;
  req.perms = u ? permsFor(u.role) : permsFor("none");
  next();
}

/** Gate for page routes — bounces to the login screen. */
function requirePage(req, res, next) {
  if (!req.user) return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  next();
}

/** Gate for API routes — returns JSON so the front end can react. */
function requireApi(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  next();
}

/** Gate on a specific permission, e.g. need("write") or need("admin"). */
function need(perm) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Not signed in" });
    if (!req.perms[perm]) {
      return res.status(403).json({ error: "Your account does not have permission to do that" });
    }
    next();
  };
}

module.exports = { permsFor, currentUser, attachUser, requirePage, requireApi, need };
