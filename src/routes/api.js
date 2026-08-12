"use strict";
const express = require("express");
const db = require("../db");
const audit = require("../audit");
const { requireApi, need, permsFor } = require("../auth");

const router = express.Router();
router.use(requireApi);

/* ------------------------------------------------------------------ helpers */

function statusKinds() {
  const map = {};
  db.prepare("SELECT name, kind FROM statuses").all().forEach(s => (map[s.name] = s.kind));
  return map;
}

/**
 * The rule the practice actually works to: while a referral is sitting in any
 * "Pending LOP" status, the moment the LOP is marked Approved it becomes
 * "Ready to Schedule" for the front desk. Everything else shows as-is.
 */
function effectiveStatus(patientLop, procStatus, kinds) {
  const kind = kinds[procStatus];
  if (kind === "pending_lop") return patientLop === "Approved" ? "Ready to Schedule" : procStatus;
  return procStatus;
}

function proceduresFor(patientId) {
  return db.prepare(
    "SELECT id, exam, scheduled_at, facility, provider, status FROM procedures WHERE patient_id = ? ORDER BY sort, id"
  ).all(patientId);
}

function notesFor(patientId) {
  return db.prepare(
    "SELECT id, body, kind, author_name, created_at FROM notes WHERE patient_id = ? ORDER BY id DESC"
  ).all(patientId);
}

function patientRow(p, kinds) {
  const procs = proceduresFor(p.id);
  const lead = procs[0] || {};
  return {
    ...p,
    procedures: procs,
    lead_exam: lead.exam || "",
    lead_scheduled_at: lead.scheduled_at || "",
    effective_status: effectiveStatus(p.lop_status, lead.status || "Pending LOP", kinds),
  };
}

const PATIENT_FIELDS = ["pid", "first_name", "middle_name", "last_name", "dob", "phone", "alt_phone",
  "email", "doi", "gender", "address", "city", "state", "zip", "payer", "attorney_id", "doctor_id",
  "order_date", "lop_status"];

function cleanPatient(body) {
  const out = {};
  PATIENT_FIELDS.forEach(f => {
    let v = body[f];
    if (v === undefined) v = null;
    if (typeof v === "string") v = v.trim();
    if (v === "") v = null;
    out[f] = v;
  });
  if (!out.payer) out.payer = "LOP";
  if (out.lop_status !== "Approved") out.lop_status = "Pending";
  out.attorney_id = out.attorney_id ? Number(out.attorney_id) : null;
  out.doctor_id = out.doctor_id ? Number(out.doctor_id) : null;
  return out;
}

function nextPid() {
  const row = db.prepare("SELECT pid FROM patients WHERE pid LIKE 'ID%' ORDER BY id DESC LIMIT 1").get();
  const n = row && /^ID(\d+)$/.test(row.pid) ? Number(RegExp.$1) + 1 : 10001;
  return "ID" + n;
}

/* ---------------------------------------------------------------- bootstrap */

router.get("/bootstrap", (req, res) => {
  const exams = db.prepare("SELECT name, category FROM exams WHERE active = 1 ORDER BY sort, id").all();
  const grouped = [];
  exams.forEach(e => {
    let g = grouped.find(x => x[0] === e.category);
    if (!g) { g = [e.category, []]; grouped.push(g); }
    g[1].push(e.name);
  });
  res.json({
    user: { id: req.user.id, name: req.user.full_name, username: req.user.username, role: req.user.role },
    perms: permsFor(req.user.role),
    facilities: db.prepare("SELECT name FROM facilities WHERE active = 1 ORDER BY sort, id").all().map(r => r.name),
    providers: db.prepare("SELECT name FROM providers WHERE active = 1 ORDER BY sort, id").all().map(r => r.name),
    statuses: db.prepare("SELECT name, kind FROM statuses WHERE active = 1 ORDER BY sort, id").all(),
    examGroups: grouped,
    attorneys: db.prepare("SELECT id, name, firm FROM attorneys WHERE active = 1 ORDER BY name").all(),
    doctors: db.prepare("SELECT id, name, practice FROM referring_doctors WHERE active = 1 ORDER BY name").all(),
    payers: ["LOP", "Insurance", "Self Pay"],
  });
});

/* ----------------------------------------------------------------- patients */

router.get("/patients", (req, res) => {
  const kinds = statusKinds();
  const q = (req.query.q || "").toString().trim().toLowerCase();
  const filter = (req.query.filter || "all").toString();

  const rows = db.prepare(`
    SELECT p.*, a.name AS attorney_name, d.name AS doctor_name
    FROM patients p
    LEFT JOIN attorneys a ON a.id = p.attorney_id
    LEFT JOIN referring_doctors d ON d.id = p.doctor_id
    ORDER BY p.id DESC
  `).all();

  let list = rows.map(p => patientRow(p, kinds));

  if (filter === "Pending LOP") {
    list = list.filter(p => kinds[p.effective_status] === "pending_lop");
  } else if (filter !== "all") {
    list = list.filter(p => p.effective_status === filter);
  }
  if (q) {
    list = list.filter(p =>
      `${p.first_name} ${p.last_name} ${p.phone || ""} ${p.pid || ""}`.toLowerCase().includes(q));
  }

  // Counts are always over the full set, so the chips do not change as you filter.
  const all = rows.map(p => patientRow(p, kinds));
  const counts = { all: all.length, "Pending LOP": 0 };
  all.forEach(p => {
    if (kinds[p.effective_status] === "pending_lop") counts["Pending LOP"]++;
    else counts[p.effective_status] = (counts[p.effective_status] || 0) + 1;
  });

  res.json({ patients: list, counts });
});

router.get("/patients/:id", (req, res) => {
  const kinds = statusKinds();
  const p = db.prepare(`
    SELECT p.*, a.name AS attorney_name, d.name AS doctor_name
    FROM patients p
    LEFT JOIN attorneys a ON a.id = p.attorney_id
    LEFT JOIN referring_doctors d ON d.id = p.doctor_id
    WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: "Patient not found" });
  audit.log(req, "view", "patient", p.id, `${p.first_name} ${p.last_name}`);
  res.json({ ...patientRow(p, kinds), notes: notesFor(p.id) });
});

function saveProcedures(patientId, procs) {
  const existing = db.prepare("SELECT id FROM procedures WHERE patient_id = ?").all(patientId).map(r => r.id);
  const keep = [];
  (procs || []).forEach((pr, i) => {
    const row = {
      exam: (pr.exam || "").trim(),
      scheduled_at: (pr.scheduled_at || "").trim() || null,
      facility: (pr.facility || "").trim() || null,
      provider: (pr.provider || "").trim() || null,
      status: (pr.status || "Pending LOP").trim(),
      sort: i,
    };
    if (!row.exam) return;
    if (pr.id && existing.includes(Number(pr.id))) {
      db.prepare(`UPDATE procedures SET exam=?, scheduled_at=?, facility=?, provider=?, status=?, sort=?,
                  updated_at=datetime('now') WHERE id=? AND patient_id=?`)
        .run(row.exam, row.scheduled_at, row.facility, row.provider, row.status, row.sort, pr.id, patientId);
      keep.push(Number(pr.id));
    } else {
      const info = db.prepare(`INSERT INTO procedures (patient_id, exam, scheduled_at, facility, provider, status, sort)
                               VALUES (?,?,?,?,?,?,?)`)
        .run(patientId, row.exam, row.scheduled_at, row.facility, row.provider, row.status, row.sort);
      keep.push(info.lastInsertRowid);
    }
  });
  existing.filter(id => !keep.includes(id))
    .forEach(id => db.prepare("DELETE FROM procedures WHERE id = ?").run(id));
}

router.post("/patients", need("write"), (req, res) => {
  const p = cleanPatient(req.body);
  if (!p.first_name || !p.last_name) return res.status(400).json({ error: "First and last name are required" });
  if (!p.pid) p.pid = nextPid();

  const cols = PATIENT_FIELDS.join(", ");
  const marks = PATIENT_FIELDS.map(() => "?").join(", ");
  const info = db.prepare(`INSERT INTO patients (${cols}, created_by) VALUES (${marks}, ?)`)
    .run(...PATIENT_FIELDS.map(f => p[f]), req.user.id);

  saveProcedures(info.lastInsertRowid, req.body.procedures);
  audit.log(req, "create", "patient", info.lastInsertRowid, `${p.first_name} ${p.last_name}`);
  res.json({ id: info.lastInsertRowid });
});

router.put("/patients/:id", (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare("SELECT * FROM patients WHERE id = ?").get(id);
  if (!before) return res.status(404).json({ error: "Patient not found" });

  const p = cleanPatient(req.body);
  if (!p.first_name || !p.last_name) return res.status(400).json({ error: "First and last name are required" });

  // The authorisation department may not edit demographics, but changing the LOP
  // is their whole job — so allow that one field through for them.
  if (!req.perms.write) {
    if (!req.perms.lop) return res.status(403).json({ error: "Your account does not have permission to do that" });
    if (p.lop_status !== before.lop_status) {
      db.prepare("UPDATE patients SET lop_status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(p.lop_status, id);
      audit.log(req, "update", "patient", id, `LOP ${before.lop_status} → ${p.lop_status}`);
    }
    return res.json({ id, limited: true });
  }

  const sets = PATIENT_FIELDS.map(f => `${f} = ?`).join(", ");
  db.prepare(`UPDATE patients SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...PATIENT_FIELDS.map(f => p[f]), id);
  saveProcedures(id, req.body.procedures);

  const changes = [];
  if (before.lop_status !== p.lop_status) changes.push(`LOP ${before.lop_status} → ${p.lop_status}`);
  audit.log(req, "update", "patient", id,
    `${p.first_name} ${p.last_name}${changes.length ? " · " + changes.join(", ") : ""}`);
  res.json({ id });
});

router.delete("/patients/:id", need("delete"), (req, res) => {
  const p = db.prepare("SELECT first_name, last_name FROM patients WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Patient not found" });
  db.prepare("DELETE FROM patients WHERE id = ?").run(req.params.id);
  audit.log(req, "delete", "patient", Number(req.params.id), `${p.first_name} ${p.last_name}`);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- notes */

router.post("/patients/:id/notes", (req, res) => {
  if (!req.perms.write && !req.perms.lop) {
    return res.status(403).json({ error: "Your account does not have permission to do that" });
  }
  const body = (req.body.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note is empty" });
  const kind = req.body.kind === "sms" ? "sms" : "note";
  const info = db.prepare(
    "INSERT INTO notes (patient_id, body, kind, author_id, author_name) VALUES (?,?,?,?,?)"
  ).run(req.params.id, body, kind, req.user.id, kind === "sms" ? "System" : req.user.full_name);
  audit.log(req, "note", "patient", Number(req.params.id), kind === "sms" ? "SMS logged" : "Note added");
  res.json({ id: info.lastInsertRowid, notes: notesFor(req.params.id) });
});

/* ----------------------------------------------------------------- schedule */

router.get("/schedule", (req, res) => {
  const date = (req.query.date || "").toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Bad date" });
  const rows = db.prepare(`
    SELECT pr.id, pr.exam, pr.scheduled_at, pr.facility, pr.provider, pr.status,
           p.id AS patient_id, p.first_name, p.last_name, p.dob, p.phone
    FROM procedures pr
    JOIN patients p ON p.id = pr.patient_id
    WHERE substr(pr.scheduled_at, 1, 10) = ?
    ORDER BY substr(pr.scheduled_at, 12, 5)
  `).all(date);
  res.json({ date, appointments: rows });
});

module.exports = router;
