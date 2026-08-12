"use strict";
const db = require("./db");

const stmt = db.prepare(
  `INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, detail, ip)
   VALUES (?,?,?,?,?,?,?)`
);

/**
 * Records who did what, to which record, from where. Called on every write.
 * Deliberately stores a short human-readable detail line rather than the full
 * record, so the audit trail itself does not become a second copy of the PHI.
 */
function log(req, action, entity, entityId, detail) {
  try {
    const u = req && req.user;
    stmt.run(
      u ? u.id : null,
      u ? u.full_name : "system",
      action,
      entity || null,
      entityId || null,
      detail || null,
      req ? (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim() : null
    );
  } catch (e) {
    // Auditing must never take the application down.
    console.error("audit failed:", e.message);
  }
}

module.exports = { log };
