"use strict";
/**
 * First-run setup: creates the lookup lists the practice gave us and one admin
 * login. Safe to run more than once — it only ever fills in what is missing, it
 * never overwrites or deletes anything the practice has changed since.
 */
const bcrypt = require("bcryptjs");
const db = require("./db");

const FACILITIES = ["Telemedicine", "Humble", "Jersey Village", "Pasadena", "Southwest",
  "North 45", "Heights", "Sugarland", "Missouri City", "Viking SC", "Altus Westchase-SC", "MLS Mo City"];

const PROVIDERS = ["Dr. Sachin Shah, MD", "Dr. Rizwan Khan, DO", "Dr. Raju Mantena, DO",
  "Princess Ezenwa, FNP", "Maria Mapa Martin, APRN", "Viking Physician", "Ancy Varghese, FNP"];

const STATUSES = [
  ["Pending LOP", "pending_lop"], ["Pending LOP Injection", "pending_lop"], ["Pending LOP MLS", "pending_lop"],
  ["Ready to Schedule", "ready"], ["Scheduled", "scheduled"], ["Check Out", "inoffice"],
  ["Completed", "done"], ["No Show", "negative"], ["Canceled", "negative"], ["Dropped", "negative"],
  ["Follow up MRI", "pending_lop"], ["Reduction Received", "done"], ["Settled", "done"],
];

const EXAMS = [
  ["Consultations & Visits", ["Initial Consultation", "Pain Management Consultation",
    "Pain Management Consultation Established Patient", "Pain Management Consultation Telemedicine",
    "Follow up visit", "Follow up visit Telemedicine", "Follow up after Injection",
    "Follow up after Injection Telemedicine", "Follow up after Laser Therapy",
    "Follow up after Laser Therapy Telemedicine"]],
  ["Injections – Spine", ["Injection",
    "Cervical Interlaminar Epidural Steroid Injection", "Cervical Transforaminal Epidural Injection",
    "Cervical Medial Branch Block", "Thoracic Interlaminar Epidural Steroid Injection",
    "Thoracic Transforaminal Epidural Injection", "Thoracic Medial Branch Block",
    "Lumbar Interlaminar Epidural Steroid Injection", "Lumbar Transforaminal Epidural Injection",
    "Lumbar Medial Branch Block"]],
  ["Injections – Major Joints", ["Right Shoulder Injection", "Left Shoulder Injection",
    "Right Knee Injection", "Left Knee Injection", "Right Hip Injection", "Left Hip Injection",
    "Right Elbow Injection", "Left Elbow Injection", "Right Ankle Injection", "Left Ankle Injection",
    "Right Wrist Injection", "Left Wrist Injection", "Right Hand Injection", "Left Hand Injection",
    "Right Foot Injection", "Left Foot Injection", "SI Joint Injection"]],
  ["RFA", ["Cervical RFA", "Lumbar RFA"]],
  ["MLS Laser", ["MLS Laser", "MLS Laser Cervical Spine", "MLS Laser Thoracic Spine", "MLS Laser Lumbar Spine",
    "MLS Laser Right Shoulder", "MLS Laser Left Shoulder", "MLS Laser Right Knee", "MLS Laser Left Knee",
    "MLS Laser Right Hip", "MLS Laser Left Hip", "MLS Laser Right Ankle", "MLS Laser Left Ankle",
    "MLS Laser Right Elbow", "MLS Laser Left Elbow", "MLS Laser Right Wrist", "MLS Laser Left Wrist",
    "MLS Laser Right Hand", "MLS Laser Left Hand", "MLS Laser Right Foot", "MLS Laser Left Foot"]],
];

function seedLookups() {
  const fac = db.prepare("INSERT OR IGNORE INTO facilities (name, sort) VALUES (?, ?)");
  FACILITIES.forEach((n, i) => fac.run(n, i));

  const prov = db.prepare("INSERT OR IGNORE INTO providers (name, sort) VALUES (?, ?)");
  PROVIDERS.forEach((n, i) => prov.run(n, i));

  const st = db.prepare("INSERT OR IGNORE INTO statuses (name, kind, sort) VALUES (?, ?, ?)");
  STATUSES.forEach(([n, k], i) => st.run(n, k, i));

  const ex = db.prepare("INSERT OR IGNORE INTO exams (name, category, sort) VALUES (?, ?, ?)");
  let i = 0;
  EXAMS.forEach(([cat, items]) => items.forEach(n => ex.run(n, cat, i++)));
}

function seedAdmin() {
  const existing = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  if (existing > 0) return null;
  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASS || "ChangeMe123!";
  db.prepare(
    "INSERT INTO users (username, full_name, role, password_hash, must_change) VALUES (?,?,?,?,1)"
  ).run(username, "System Administrator", "admin", bcrypt.hashSync(password, 12));
  return { username, password };
}

function run() {
  seedLookups();
  const admin = seedAdmin();
  return admin;
}

if (require.main === module) {
  const admin = run();
  console.log("Lookups ready.");
  if (admin) console.log(`Admin login created — username: ${admin.username}  password: ${admin.password}`);
  else console.log("Users already exist; admin not recreated.");
}

module.exports = { run };
