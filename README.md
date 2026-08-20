# Referral Portal

Referral tracking, scheduling and patient registration for a pain-management
practice working personal-injury / LOP cases.

Built to replace the existing in-house portal with the same day-to-day workflow,
a faster interface, proper staff logins and a full audit trail.

---

## What it does

**Dashboard** — opens on the schedule for the day. Pick a date, see every
appointment with time, patient, procedure, facility and provider. Click a
provider on the left to show only their list. Click any appointment to open
that patient.

**Referrals** — every referral in one queue, with counters for All, Pending LOP,
Ready to Schedule and Scheduled. Search by name, phone or patient ID.

**Patient form** — demographics, payer and attorney, referring doctor, and one or
more procedures. Scheduling happens here, on the patient's own form, exactly as
the practice works today.

**The LOP flow** — this is the engine of the whole system:

1. Front desk registers the patient and adds the procedure, leaving Schedule
   Date, Facility and Physician blank, with status `Pending LOP`.
2. The referral drops into the queue under **Pending LOP**.
3. The authorisation department works that list and calls attorneys.
4. When the LOP is switched to **Approved**, the referral automatically shows as
   **Ready to Schedule** — no one has to remember to change the status.
5. Staff open the patient, fill in Schedule Date, Facility and Physician, set the
   status to Scheduled, and it appears on the Dashboard for that day.

**Notes & Communication Log** — free-text notes against the patient ("Attorney
approved two injections"), plus every text message sent to the patient logged
automatically, so the whole history of contact sits in one place.

**Directories** — the practice's attorney and referring-doctor lists, searchable
by name, phone, fax, email or address. On the patient form these are
type-to-search boxes rather than dropdowns, because the real lists run to
hundreds of entries. Picking one shows its phone, fax and email, plus any
standing instruction recorded against it — "if the patient went to ER only 1 ESI
is approved" — right where the authorisation desk needs it.

**Admin** — the practice manages its own facilities, providers, exams, statuses,
attorney and referring-doctor directories, and staff logins. Nothing on that
screen needs a developer.

**Audit trail** — every sign-in, view and change is recorded with who, what, when
and from which IP address.

---

## Roles

| Role | Can do |
|---|---|
| **Administrator** | Everything, including the Admin screen and staff logins |
| **Staff** | Register patients, schedule, edit, add notes |
| **Authorisations** | View patients, change the LOP status, add notes — cannot edit demographics or delete |
| **View only** | Read the queue and patient records, change nothing |

Permissions are enforced on the server, not just hidden in the browser.

---

## Running it locally

```bash
npm install
node server.js
```

Open http://localhost:3000. On the very first run it creates the lookup lists and
one administrator login, and prints the password to the console. You are asked to
choose your own password the first time you sign in.

To point it at a different database folder or port, copy `.env.example` to `.env`
and edit it.

---

## Importing the attorney and referring-doctor directories

The practice keeps these lists in a spreadsheet. To load or refresh them:

1. In Google Sheets, **File → Download → Comma-separated values (.csv)**.
2. Run:

```bash
node src/import-directories.js attorneys /path/to/lawyers.csv
node src/import-directories.js doctors   /path/to/doctors.csv
```

Columns are matched by their heading — Name (or "Lawyer Name" / "Doctor Name"),
Fax, Phone, Email, Address, Notes — in any order, and the header does not have to
be the first row.

Safe to run as often as you like. Entries are matched on the name, so re-running
an updated export refreshes the details on the ones already there and adds the
new ones. **Nothing is ever deleted**, so a patient record that points at an
attorney can never be orphaned by an import, and a blank cell in the spreadsheet
never wipes a detail somebody typed into the portal.

Addresses are split into street/city/state/zip where they can be read
confidently; anything ambiguous is kept whole in the address field rather than
guessed at. Any entry can be corrected by hand under **Admin → Attorneys /
Referring Doctors**.

---

## Deploying to a real server

See **[DEPLOYMENT.md](DEPLOYMENT.md)** — Ubuntu setup, HTTPS, automatic restart,
daily backups, and the HIPAA points that matter (encrypted disk, BAA with the
hosting company, audit log retention).

---

## How it is built

Node.js and Express on the server, SQLite for storage, plain HTML/CSS/JavaScript
in the browser — no build step, no framework to upgrade every year. Anyone who
knows JavaScript can pick this up and change it.

```
server.js              app setup, sign-in, sessions, security headers
src/db.js              database schema
src/seed.js            first-run lists (facilities, providers, exams, statuses)
src/auth.js            roles and permissions
src/audit.js           audit logging
src/routes/api.js      patients, procedures, notes, schedule
src/routes/admin.js    admin screen: lists, directories, staff logins
public/                the three screens: login, portal, admin
```

Passwords are hashed with bcrypt. Sign-in is rate limited. The pages run under a
strict Content-Security-Policy. Session cookies are http-only and, in production,
https-only.

---

## Licence and ownership

This code belongs to the practice. No part of it is licensed back to the
developer, and there is nothing in it that ties it to any one person or company.
