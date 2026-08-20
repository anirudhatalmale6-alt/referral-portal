"use strict";
/**
 * Imports the practice's attorney and referring-doctor directories from CSV.
 *
 *   node src/import-directories.js attorneys ~/Downloads/lawyers.csv
 *   node src/import-directories.js doctors   ~/Downloads/doctors.csv
 *
 * Export the sheet from Google Sheets with File → Download → Comma-separated
 * values, then point this at the downloaded file.
 *
 * Safe to run more than once. Matching is done on the name, so re-running an
 * updated export refreshes phone/fax/email/notes on the entries that already
 * exist and adds the new ones. Nothing is ever deleted, so a patient record
 * that points at an attorney can never be orphaned by an import.
 *
 * Expected columns, in any order, matched loosely on the header text:
 *   Name (or "Lawyer Name" / "Doctor Name"), Fax, Phone, Email, Address, Notes
 */
const fs = require("fs");
const db = require("./db");

/* ------------------------------------------------------------- CSV parsing */

/** Full RFC-4180 parse: handles quoted fields, embedded commas, newlines and "". */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  // A UTF-8 byte-order mark would otherwise become part of the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------- column detection */

/**
 * Header labels are matched EXACTLY, not by "contains".
 *
 * This matters more than it looks. A loose contains-match found the word "firm"
 * inside the law firm "AMARO LAW FIRM" and the word "fax" inside the note
 * "...please send to fax@amarolawfirm.com", decided that data row was the
 * header, and silently imported 800 attorneys with their notes in the fax
 * column. Exact matching cannot do that.
 */
const HEADINGS = {
  name: ["name", "lawyer", "lawyer name", "attorney", "attorney name", "doctor",
         "doctor name", "physician", "physician name", "provider", "provider name",
         "firm", "firm name", "law firm"],
  fax: ["fax", "fax number", "fax no", "fax #"],
  phone: ["phone", "phone number", "phone no", "phone #", "telephone", "tel", "mobile", "cell"],
  email: ["email", "e mail", "email address", "emails"],
  address: ["address", "addresses", "street address", "location"],
  notes: ["notes", "note", "comment", "comments", "remarks"],
};

/** Lower-cases, collapses whitespace and drops punctuation so "E-Mail:" == "email". */
function normHeader(cell) {
  return String(cell || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Finds the header row and maps our fields onto its column positions.
 *
 * Every row is checked, not just row 0 — the practice's attorney sheet is
 * sorted newest-first, which leaves the header on the very LAST line of the
 * export.
 */
function findHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(normHeader);

    const map = {};
    Object.entries(HEADINGS).forEach(([field, labels]) => {
      const idx = cells.findIndex((c, j) => c && labels.includes(c) && !Object.values(map).includes(j));
      if (idx >= 0) map[field] = idx;
    });

    // A real header names the entity and at least two of its details. One
    // stray word in a data row can never clear that bar.
    if (map.name === undefined) continue;
    if (Object.keys(map).length < 3) continue;
    return { index: i, map };
  }
  return null;
}

/* ------------------------------------------------------ address tidying */

const STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS " +
  "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "));

/**
 * Splits "1322 Yale St, Houston, TX, 77008" into its parts. Their sheets are
 * hand-typed and inconsistent, so anything that does not parse cleanly is kept
 * whole in the address field rather than being guessed at and mangled.
 */
function splitAddress(raw) {
  const s = (raw || "").trim();
  if (!s) return { address: null, city: null, state: null, zip: null };

  // The state is found by anchoring to the zip at the end rather than scanning
  // the whole string. Searching loosely would match ordinary words — "IN", "OR",
  // "ME" — inside a street name and cut the address in the wrong place.
  const tail = s.match(/[,\s]+([A-Za-z]{2})\.?[,\s]+(\d{5})(?:-\d{4})?\s*(?:,\s*(?:USA|United States)\.?)?\s*$/i);
  if (!tail || !STATES.has(tail[1].toUpperCase())) {
    return { address: s, city: null, state: null, zip: null };
  }

  const state = tail[1].toUpperCase();
  const zip = tail[2];
  const beforeState = s.slice(0, tail.index).replace(/[,\s]+$/, "");
  const parts = beforeState.split(",").map(p => p.trim()).filter(Boolean);
  // No comma before the state means the city cannot be told apart from the
  // street. Keep what is left as the address rather than repeating the state
  // and zip inside it.
  if (parts.length < 2) return { address: beforeState || s, city: null, state, zip };

  let address = parts.slice(0, -1).join(", ");
  let city = parts[parts.length - 1];

  // Their addresses are hand-typed, so a suite often sits at the front of the
  // city segment — "1234 Main St, #143 Sugar Land". Move it back onto the
  // street address rather than leaving it stuck to the city or throwing it away.
  // Covers "#143", "Ste 400", "Ste. B-500", "Ste# 300", "Suite #108".
  const suite = city.match(/^((?:#|ste|suite|apt|unit|bldg|fl|floor)\.?\s*#?\s*[\w-]+)\s+(.+)$/i);
  if (suite) {
    address = address ? `${address} ${suite[1]}` : suite[1];
    city = suite[2].trim();
  }

  return { address, city, state, zip };
}

const clean = v => {
  const s = (v || "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};

/* ---------------------------------------------------------------- import */

const TARGETS = {
  attorneys: { table: "attorneys", second: "firm", label: "attorneys" },
  doctors: { table: "referring_doctors", second: "practice", label: "referring doctors" },
};

function run(which, file) {
  const cfg = TARGETS[which];
  if (!cfg) throw new Error(`Unknown directory "${which}". Use "attorneys" or "doctors".`);
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);

  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = findHeader(rows);
  if (!header) {
    throw new Error(
      "Could not find a header row. The file needs a row with a name column and a phone or fax column."
    );
  }
  const { index, map } = header;
  const at = (row, field) => (map[field] === undefined ? "" : (row[map[field]] || ""));

  const find = db.prepare(`SELECT id, name FROM ${cfg.table} WHERE name = ? COLLATE NOCASE`);
  const insert = db.prepare(
    `INSERT INTO ${cfg.table} (name, phone, fax, email, address, city, state, zip, notes)
     VALUES (@name, @phone, @fax, @email, @address, @city, @state, @zip, @notes)`
  );
  // COALESCE keeps whatever is already on the record when the new export leaves
  // a cell blank — an import should never blank out details someone typed in.
  const update = db.prepare(
    `UPDATE ${cfg.table} SET
       phone = COALESCE(@phone, phone), fax = COALESCE(@fax, fax),
       email = COALESCE(@email, email), address = COALESCE(@address, address),
       city = COALESCE(@city, city), state = COALESCE(@state, state),
       zip = COALESCE(@zip, zip), notes = COALESCE(@notes, notes)
     WHERE id = @id`
  );

  let added = 0, updated = 0, skipped = 0;
  const seen = new Set();

  const work = db.transaction(() => {
    rows.forEach((row, i) => {
      if (i === index) return;                       // the header itself
      const name = clean(at(row, "name"));
      if (!name) { skipped++; return; }

      // Guard against a stray second header or a repeated line in the export.
      const key = name.toLowerCase();
      if (seen.has(key)) { skipped++; return; }
      if (HEADINGS.name.some(h => key === h) || key.endsWith(" name")) { skipped++; return; }
      seen.add(key);

      const rec = Object.assign(
        { name, phone: clean(at(row, "phone")), fax: clean(at(row, "fax")),
          email: clean(at(row, "email")), notes: clean(at(row, "notes")) },
        splitAddress(at(row, "address"))
      );

      const existing = find.get(name);
      if (existing) { update.run(Object.assign(rec, { id: existing.id })); updated++; }
      else { insert.run(rec); added++; }
    });
  });
  work();

  const total = db.prepare(`SELECT COUNT(*) n FROM ${cfg.table} WHERE active = 1`).get().n;
  return { added, updated, skipped, total, label: cfg.label };
}

module.exports = { run, parseCsv, findHeader, splitAddress };

if (require.main === module) {
  const [which, file] = process.argv.slice(2);
  if (!which || !file) {
    console.error("Usage: node src/import-directories.js <attorneys|doctors> <file.csv>");
    process.exit(1);
  }
  try {
    const r = run(which, file);
    console.log(`${r.added} added, ${r.updated} updated, ${r.skipped} skipped.`);
    console.log(`${r.total} ${r.label} now in the directory.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
