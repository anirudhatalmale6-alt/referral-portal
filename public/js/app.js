"use strict";
/* Referral Portal — front end.
   Everything is driven by data-act attributes and one click handler, so the page
   works under a strict Content-Security-Policy (no inline scripts). */

let BOOT = null;                 // lookups + who is signed in
let LIST = { patients: [], counts: {} };
let filter = "all";
let editing = null;              // patient currently open in the form
let view = "dash";
const dashState = { date: todayISO(), provider: null };

/* ------------------------------------------------------------------ utils */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function initials(n) {
  return (String(n || "").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("") || "?").toUpperCase();
}
function formatSched(v) {
  if (!v) return "";
  const [d, t] = v.split("T");
  if (!d) return v;
  const [y, mo, da] = d.split("-");
  let [hh, mm] = (t || "00:00").split(":");
  hh = +hh;
  const ap = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return `${mo}/${da}/${y} · ${h12}:${mm} ${ap}`;
}
function formatTime(t) {
  if (!t) return "";
  let [hh, mm] = t.split(":");
  hh = +hh;
  const ap = hh >= 12 ? "PM" : "AM";
  let h = hh % 12; if (h === 0) h = 12;
  return `${h}:${mm} ${ap}`;
}
function niceDate(d) {
  const [y, mo, da] = d.split("-");
  const mons = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  return `${mons[(+mo) - 1]} ${(+da)}, ${y}`;
}
function kindOf(statusName) {
  const s = (BOOT.statuses || []).find(x => x.name === statusName);
  return s ? s.kind : "done";
}
function statusClass(s) {
  return {
    pending_lop: "s-pending", ready: "s-ready", scheduled: "s-sched",
    inoffice: "s-office", negative: "s-no", done: "s-done",
  }[kindOf(s)] || "s-done";
}
function payerClass(p) {
  return { "LOP": "p-lop", "Insurance": "p-ins", "Self Pay": "p-self" }[p] || "p-self";
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts));
  if (res.status === 401) { location.href = "/login"; throw new Error("signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/* ------------------------------------------------------------ option lists */

function opt(arr, val) {
  return arr.map(o => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("");
}
function examOptions(val) {
  return (BOOT.examGroups || []).map(([label, items]) =>
    `<optgroup label="${esc(label)}">` +
    items.map(o => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("") +
    `</optgroup>`).join("");
}
function statusOptions(val) {
  return (BOOT.statuses || []).map(s =>
    `<option value="${esc(s.name)}" ${s.name === val ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

/* -------------------------------------------------------------- navigation */

function go(v) {
  view = v;
  document.getElementById("dashView").classList.toggle("hide", v !== "dash");
  document.getElementById("listView").classList.toggle("hide", v !== "list");
  document.getElementById("formView").classList.toggle("hide", v !== "form");
  document.getElementById("navDash").classList.toggle("active", v === "dash");
  document.getElementById("navRef").classList.toggle("active", v !== "dash");
  if (v === "dash") loadDash();
  if (v === "list") loadList();
  window.scrollTo(0, 0);
}

/* -------------------------------------------------------------- dashboard */

async function loadDash() {
  let appts = [];
  try {
    const data = await api(`/api/schedule?date=${encodeURIComponent(dashState.date)}`);
    appts = data.appointments || [];
  } catch (e) { toast(e.message); }
  renderDash(appts);
}

function renderDash(appts) {
  const provs = [...new Set(appts.map(a => a.provider || "Unassigned"))].sort();
  const shown = dashState.provider ? appts.filter(a => (a.provider || "Unassigned") === dashState.provider) : appts;

  const provItems = provs.map(pr => {
    const n = appts.filter(a => (a.provider || "Unassigned") === pr).length;
    const on = dashState.provider === pr;
    return `<div class="provItem ${on ? "on" : ""}" data-act="prov" data-name="${esc(pr)}">
      <span class="dotmark ${on ? "" : "off"}">${on ? tick() : ""}</span>
      <span style="flex:1">${esc(pr)}</span><span class="pcount">${n}</span></div>`;
  }).join("") || `<div class="muted" style="font-size:13px;padding:6px 2px">No providers scheduled this day.</div>`;

  const list = shown.length ? shown.map(a => {
    const name = `${a.first_name} ${a.last_name}`;
    const time = (a.scheduled_at || "").split("T")[1] || "";
    return `<div class="apptrow" data-act="open" data-id="${a.patient_id}">
      <div class="atime"><b>${esc(formatTime(time)) || "—"}</b></div>
      <div style="flex:1;min-width:0"><b>${esc(name)}</b>
        <div class="muted" style="font-size:12px;margin-top:2px">${esc(a.exam)}${a.facility ? " · " + esc(a.facility) : ""}</div></div>
      <div class="aprov"><span class="pi">${esc(initials(a.provider || "Unassigned"))}</span> ${esc(a.provider || "Unassigned")}</div>
      <span class="status ${statusClass(a.status)}"><span class="d"></span>${esc(a.status)}</span></div>`;
  }).join("") : `<div class="empty">No appointments scheduled for ${esc(niceDate(dashState.date))}${dashState.provider ? " for " + esc(dashState.provider) : ""}.</div>`;

  document.getElementById("dashView").innerHTML = `
    <div class="main-head">
      <div><h1>Today's Schedule</h1>
        <div class="sub">${esc(niceDate(dashState.date))}${dashState.provider ? " · " + esc(dashState.provider) : " · all providers"}</div></div>
      ${BOOT.perms.write ? `<button class="btn" data-act="new"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> New Referral</button>` : ""}
    </div>
    <div class="dashwrap">
      <aside class="cardbox dashside">
        <label style="display:block;font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:7px">Date</label>
        <input type="date" id="dashDate" value="${esc(dashState.date)}"
          style="width:100%;height:40px;border:1px solid var(--line);border-radius:9px;padding:0 12px;font-size:13.5px;background:#fbfcfe;margin-bottom:18px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);font-weight:700;margin-bottom:12px">Providers today</div>
        <div class="provItem ${!dashState.provider ? "on" : ""}" data-act="prov" data-name="">
          <span class="dotmark ${!dashState.provider ? "" : "off"}">${!dashState.provider ? tick() : ""}</span>
          <span style="flex:1">All providers</span><span class="pcount">${appts.length}</span></div>
        ${provItems}
      </aside>
      <div class="dashmain"><div class="cardbox" style="padding:0;overflow:hidden">${list}</div></div>
    </div>`;
}
function tick() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>`;
}

/* ----------------------------------------------------------- referral list */

async function loadList() {
  const q = document.getElementById("q") ? document.getElementById("q").value : "";
  try {
    LIST = await api(`/api/patients?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(q)}`);
  } catch (e) { toast(e.message); return; }
  renderChips();
  renderRows();
}

const FILTERS = [["all", "All"], ["Pending LOP", "Pending LOP"], ["Ready to Schedule", "Ready to Schedule"], ["Scheduled", "Scheduled"]];

/** Only the chips are redrawn — the search box is left alone so typing is never interrupted. */
function renderChips() {
  const c = LIST.counts || {};
  document.getElementById("chips").innerHTML =
    FILTERS.map(([k, label]) => {
      const n = k === "all" ? (c.all || 0) : (c[k] || 0);
      return `<span class="chip ${filter === k ? "active" : ""}" data-act="filter" data-k="${esc(k)}">${esc(label)} <span class="c">${n}</span></span>`;
    }).join("");
}

function renderRows() {
  const list = LIST.patients || [];
  document.getElementById("rows").innerHTML = list.map(p => {
    const name = `${p.first_name} ${p.last_name}`;
    return `<tr data-act="open" data-id="${p.id}">
      <td><div class="pname"><span class="pi">${esc(initials(name))}</span>
        <div><b>${esc(name)}</b><div class="muted" style="font-size:11.5px;margin-top:2px">${esc(p.lead_exam || "—")}${p.lead_scheduled_at ? " · " + esc(formatSched(p.lead_scheduled_at)) : ""}</div></div></div></td>
      <td class="muted">${esc(p.dob || "—")}</td>
      <td class="muted">${esc(p.order_date || "—")}</td>
      <td class="muted">${esc(p.phone || "—")}</td>
      <td><span class="payer ${payerClass(p.payer)}">${esc(p.payer || "—")}</span></td>
      <td class="muted">${esc(p.doctor_name || "—")}</td>
      <td class="muted">${esc(p.attorney_name || "—")}</td>
      <td><span class="status ${p.lop_status === "Approved" ? "s-ready" : "s-pending"}"><span class="d"></span>${esc(p.lop_status)}</span></td>
      <td><span class="status ${statusClass(p.effective_status)}"><span class="d"></span>${esc(p.effective_status)}</span></td>
    </tr>`;
  }).join("");
  document.getElementById("emptyMsg").classList.toggle("hide", list.length > 0);
  document.getElementById("listSub").textContent = `${list.length} referral${list.length === 1 ? "" : "s"} shown`;
}

/* ------------------------------------------------------------ patient form */

function blankPatient() {
  return {
    id: 0, pid: "", first_name: "", middle_name: "", last_name: "", dob: "", phone: "", alt_phone: "",
    email: "", doi: "", gender: "", address: "", city: "", state: "", zip: "", payer: "LOP",
    attorney_id: "", doctor_id: "", order_date: usToday(), lop_status: "Pending",
    procedures: [{ exam: firstExam(), scheduled_at: "", facility: "", provider: "", status: "Pending LOP" }],
    notes: [],
  };
}
function firstExam() {
  const g = BOOT.examGroups || [];
  return g.length && g[0][1].length ? g[0][1][0] : "";
}
function usToday() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function newReferral() {
  editing = blankPatient();
  renderForm();
}
async function openPatient(id) {
  try {
    editing = await api(`/api/patients/${id}`);
    if (!editing.procedures.length) {
      editing.procedures = [{ exam: firstExam(), scheduled_at: "", facility: "", provider: "", status: "Pending LOP" }];
    }
    renderForm();
  } catch (e) { toast(e.message); }
}

function field(label, key, val, req) {
  const ro = BOOT.perms.write ? "" : "disabled";
  return `<div class="fld"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ""}</label>
    <input data-k="${key}" value="${esc(val || "")}" ${ro}></div>`;
}

/* ------------------------------------------------- attorney / doctor lookup */

/**
 * The practice's directories run to 800+ lawyers and 550+ referring doctors.
 * A plain dropdown that long is unusable at a front desk, so these are
 * type-to-search boxes instead: start typing any part of the name and the
 * browser narrows the list.
 *
 * The visible box holds the NAME because that is what staff know. The hidden
 * input beside it holds the id, and that is what gets saved — so a typo can
 * never quietly attach the wrong lawyer to a patient.
 */
function lookupField(label, key, list, val, listId) {
  const ro = BOOT.perms.write ? "" : "disabled";
  const chosen = list.find(o => String(o.id) === String(val));
  return `<div class="fld lookup" data-for="${esc(key)}">
    <label>${esc(label)}</label>
    <input data-lookup="${esc(key)}" list="${esc(listId)}" autocomplete="off"
           placeholder="Type to search ${list.length} ${label.toLowerCase()}s…"
           value="${esc(chosen ? chosen.name : "")}" ${ro}>
    <input type="hidden" data-k="${esc(key)}" value="${esc(chosen ? chosen.id : "")}">
    <div class="lookup-hint">${chosen ? contactLine(chosen) : ""}</div>
  </div>`;
}

/** The one line the authorisation desk actually needs: how to reach them. */
function contactLine(o) {
  const bits = [];
  if (o.phone) bits.push(`Ph ${esc(o.phone)}`);
  if (o.fax) bits.push(`Fax ${esc(o.fax)}`);
  if (o.email) bits.push(esc(o.email));
  let html = bits.length ? `<span class="lk-contact">${bits.join(" &middot; ")}</span>` : "";
  // Their sheets carry standing instructions per firm — "if the patient went to
  // ER only 1 ESI is approved". Surfacing it here saves opening the directory.
  if (o.notes) html += `<span class="lk-note">${esc(o.notes)}</span>`;
  return html;
}

function datalists() {
  const build = (id, arr) => `<datalist id="${id}">` +
    arr.map(o => `<option value="${esc(o.name)}"></option>`).join("") + `</datalist>`;
  return build("dl_attorneys", BOOT.attorneys) + build("dl_doctors", BOOT.doctors);
}

/** Resolves what was typed back to a directory entry and stores its id. */
function resolveLookup(input) {
  const key = input.getAttribute("data-lookup");
  const list = key === "attorney_id" ? BOOT.attorneys : BOOT.doctors;
  const wrap = input.closest(".lookup");
  const hidden = wrap.querySelector("[data-k]");
  const hint = wrap.querySelector(".lookup-hint");
  const typed = input.value.trim().toLowerCase();

  const match = typed ? list.find(o => o.name.toLowerCase() === typed) : null;
  hidden.value = match ? match.id : "";
  hint.innerHTML = match ? contactLine(match) : "";

  // Text with no match is flagged rather than silently dropped, so nobody
  // saves a referral believing they picked a lawyer when they did not.
  wrap.classList.toggle("unmatched", !!typed && !match);
  if (typed && !match) hint.innerHTML = `<span class="lk-warn">Not in the directory yet — pick from the list, or add them under Admin.</span>`;
}

function renderForm() {
  const p = editing;
  const isNew = !p.id;
  const canWrite = BOOT.perms.write;
  const canLop = BOOT.perms.lop;
  const dis = canWrite ? "" : "disabled";
  const name = (p.first_name || p.last_name) ? `${p.first_name} ${p.last_name}`.trim() : "New Referral";

  const procRows = p.procedures.map((pr, i) => `
    <div class="proc-row">
      <div class="fld"><label>Exam</label><select data-p="${i}" data-pk="exam" ${dis}>${examOptions(pr.exam)}</select></div>
      <div class="fld"><label>Schedule Date</label><input type="datetime-local" data-p="${i}" data-pk="scheduled_at" value="${esc(pr.scheduled_at || "")}" ${dis}></div>
      <div class="fld"><label>Facility</label><select data-p="${i}" data-pk="facility" ${dis}><option value="">Select…</option>${opt(BOOT.facilities, pr.facility)}</select></div>
      <div class="fld"><label>Status</label><select data-p="${i}" data-pk="status" ${dis}>${statusOptions(pr.status)}</select></div>
      <div class="fld"><label>Physician</label><select data-p="${i}" data-pk="provider" ${dis}><option value="">Select…</option>${opt(BOOT.providers, pr.provider)}</select></div>
      ${canWrite && p.procedures.length > 1 ? `<button class="rm" data-act="delproc" data-i="${i}">&minus;</button>` : "<span></span>"}
    </div>`).join("");

  document.getElementById("formView").innerHTML = `
    <div class="phead">
      <div class="pav">${esc(initials(name))}</div>
      <div><h2>${esc(name)}</h2><div class="pm">
        <span>DOB ${esc(p.dob || "—")}</span><span>Patient ID: ${esc(p.pid || "assigned on save")}</span><span>Payer: ${esc(p.payer)}</span></div></div>
      <div class="hbtns">
        ${!isNew && (canWrite || canLop) ? `<button class="hbtn" data-act="sms">Send SMS</button>` : ""}
        ${canWrite || canLop ? `<button class="hbtn solid" data-act="save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg> Save</button>` : ""}
      </div>
    </div>

    <div class="cardbox">
      <div class="sec-h"><span class="i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg></span> Patient Information</div>
      <div class="grid" style="margin-bottom:16px">
        ${field("First Name", "first_name", p.first_name, true)}
        ${field("Middle Name", "middle_name", p.middle_name)}
        ${field("Last Name", "last_name", p.last_name, true)}
        ${field("Date of Birth", "dob", p.dob, true)}
        ${field("Patient Phone", "phone", p.phone)}
        ${field("Alt. Number", "alt_phone", p.alt_phone)}
      </div>
      <div class="grid">
        ${field("Patient Email", "email", p.email)}
        ${field("DOI / DOL", "doi", p.doi)}
        <div class="fld"><label>Gender</label><select data-k="gender" ${dis}><option value="">Select…</option>${opt(["Male", "Female", "Other"], p.gender)}</select></div>
        ${field("Address", "address", p.address)}
        ${field("City", "city", p.city)}
        ${field("Zip", "zip", p.zip)}
      </div>
    </div>

    <div class="cardbox">
      <div class="sec-h"><span class="i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v6H4zM4 14h16v6H4z"/></svg></span> Referral &amp; Payer</div>
      <div class="grid g4">
        <div class="fld"><label>Payer</label><select data-k="payer" ${dis}>${opt(BOOT.payers, p.payer)}</select></div>
        ${lookupField("Lawyer", "attorney_id", BOOT.attorneys, p.attorney_id, "dl_attorneys")}
        ${field("Patient ID", "pid", p.pid)}
        ${field("Order Enter Date", "order_date", p.order_date)}
      </div>
      <div class="grid g4" style="margin-top:16px">
        ${lookupField("Referring Doctor", "doctor_id", BOOT.doctors, p.doctor_id, "dl_doctors")}
        <div class="fld"><label>LOP Status</label><select data-k="lop_status" ${canLop ? "" : "disabled"}>
          <option ${p.lop_status === "Pending" ? "selected" : ""}>Pending</option>
          <option ${p.lop_status === "Approved" ? "selected" : ""}>Approved</option></select></div>
      </div>
    </div>

    <div class="cardbox">
      <div class="proc-h">
        <h3>Procedures</h3>
        ${canWrite ? `<button class="mini blue" data-act="addproc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Add Procedure</button>` : ""}
      </div>
      ${procRows}
      <div class="muted" style="font-size:12px;margin-top:4px">When registering, leave Schedule Date, Facility and Physician blank and set Status to "Pending LOP". Once the LOP above is marked Approved, this patient moves to "Ready to Schedule".</div>
    </div>

    <div class="cardbox">
      <div class="sec-h"><span class="i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H8l-4 4z"/></svg></span> Notes &amp; Communication Log</div>
      ${isNew ? `
      ${canWrite || canLop ? `<div class="noteAdd">
        <textarea id="noteInput" placeholder="Add a note about this patient — e.g. Attorney approved two injections…"></textarea>
      </div>
      <div class="muted" style="font-size:13px;padding:0 2px 4px">This note is saved along with the referral when you press Save Referral.</div>` : ""}` : `
      ${canWrite || canLop ? `<div class="noteAdd">
        <textarea id="noteInput" placeholder="Add a note about this patient — e.g. Attorney approved two injections…"></textarea>
        <button class="mini blue" style="height:44px" data-act="addnote"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Add Note</button>
      </div>` : ""}
      <div class="noteList">${noteListHtml(p.notes)}</div>`}
    </div>

    <div class="footbar">
      <button class="fbtn" data-act="go" data-view="list">Cancel</button>
      ${canWrite || canLop ? `<button class="fbtn pri" data-act="save">${isNew ? "Save Referral" : "Save Changes"}</button>` : ""}
    </div>
    ${datalists()}`;

  view = "form";
  document.getElementById("dashView").classList.add("hide");
  document.getElementById("listView").classList.add("hide");
  document.getElementById("formView").classList.remove("hide");
  window.scrollTo(0, 0);
}

function noteListHtml(notes) {
  if (!notes || !notes.length) {
    return `<div class="muted" style="font-size:13px;padding:8px 2px">No notes yet.</div>`;
  }
  return notes.map(n => `<div class="note ${n.kind === "sms" ? "sms" : ""}">
    <div class="na">${n.kind === "sms"
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6 8.5-6"/></svg>`
      : esc(initials(n.author_name))}</div>
    <div style="flex:1;min-width:0"><div class="nt">${esc(n.body)}</div>
      <div class="nm">${esc(n.author_name)} · ${esc(n.created_at)}${n.kind === "sms" ? ' · <span class="smsTag">SMS</span>' : ""}</div></div>
  </div>`).join("");
}

/** Reads the form back into `editing` so nothing is lost when the form re-renders. */
function collect() {
  document.querySelectorAll("#formView [data-k]").forEach(el => {
    editing[el.getAttribute("data-k")] = el.value;
  });
  document.querySelectorAll("#formView [data-p]").forEach(el => {
    const i = +el.getAttribute("data-p");
    const key = el.getAttribute("data-pk");
    if (editing.procedures[i]) editing.procedures[i][key] = el.value;
  });
}

async function saveForm() {
  collect();
  if (!String(editing.first_name || "").trim() || !String(editing.last_name || "").trim()) {
    toast("Please enter first and last name");
    return;
  }
  try {
    if (!editing.id) {
      // A note typed while registering has nowhere to attach until the patient row
      // exists, so it is held here and written immediately after the referral is
      // created. Front desk can type the note and the referral in one go.
      const pendingNote = String((document.getElementById("noteInput") || {}).value || "").trim();
      const r = await api("/api/patients", { method: "POST", body: JSON.stringify(editing) });
      editing.id = r.id;
      if (pendingNote) {
        try {
          await api(`/api/patients/${r.id}/notes`, {
            method: "POST", body: JSON.stringify({ body: pendingNote, kind: "note" }),
          });
          toast("Referral and note saved");
        } catch (e) {
          // The referral itself is safely saved; only the note failed. Say so
          // plainly rather than letting it disappear silently.
          toast("Referral saved, but the note did not — please re-add it");
        }
      } else {
        toast("Referral saved to the queue");
      }
    } else {
      await api(`/api/patients/${editing.id}`, { method: "PUT", body: JSON.stringify(editing) });
      toast("Changes saved");
    }
    go("list");
  } catch (e) { toast(e.message); }
}

async function addNote() {
  const el = document.getElementById("noteInput");
  const body = (el.value || "").trim();
  if (!body) { toast("Type a note first"); return; }
  try {
    collect();
    const r = await api(`/api/patients/${editing.id}/notes`, {
      method: "POST", body: JSON.stringify({ body, kind: "note" }),
    });
    editing.notes = r.notes;
    renderForm();
    toast("Note added");
  } catch (e) { toast(e.message); }
}

/**
 * Composes the reminder and logs it against the patient. The message deliberately
 * carries no diagnosis or procedure name — only a time and place — so that a text
 * landing on the wrong handset cannot disclose anything clinical.
 */
async function sendSms() {
  collect();
  const appt = (editing.procedures || []).find(pr => pr.scheduled_at);
  const when = appt
    ? `your appointment on ${formatSched(appt.scheduled_at)}${appt.facility ? " at our " + appt.facility + " location" : ""}`
    : "your upcoming appointment";
  const body = `Hi ${editing.first_name || "there"}, this is a reminder of ${when}. Reply C to confirm.`;
  try {
    const r = await api(`/api/patients/${editing.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: `Text to ${editing.phone || "patient"}: "${body}"`, kind: "sms" }),
    });
    editing.notes = r.notes;
    renderForm();
    toast("SMS logged (text delivery goes live in Phase 3)");
  } catch (e) { toast(e.message); }
}

/* --------------------------------------------------------- change password */

function passwordModal(forced) {
  document.getElementById("modalHost").innerHTML = `
    <div class="modalbg">
      <div class="modal">
        <h3>${forced ? "Choose your own password" : "Change password"}</h3>
        ${forced ? `<p class="muted" style="font-size:13px;margin:-8px 0 16px">You are signed in with a password someone else set. Please pick your own before carrying on.</p>` : ""}
        <div class="err hide" id="pwErr"></div>
        <div class="fld"><label>Current password</label><input type="password" id="pwCurrent" autocomplete="current-password"></div>
        <div class="fld"><label>New password (at least 10 characters)</label><input type="password" id="pwNext" autocomplete="new-password"></div>
        <div class="fld"><label>Repeat new password</label><input type="password" id="pwNext2" autocomplete="new-password"></div>
        <div class="modalfoot">
          ${forced ? "" : `<button class="fbtn" data-act="closemodal">Cancel</button>`}
          <button class="fbtn pri" data-act="savepw">Save password</button>
        </div>
      </div>
    </div>`;
}

async function savePassword() {
  const err = document.getElementById("pwErr");
  const next = document.getElementById("pwNext").value;
  if (next !== document.getElementById("pwNext2").value) {
    err.textContent = "The two new passwords do not match";
    err.classList.remove("hide");
    return;
  }
  try {
    await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ current: document.getElementById("pwCurrent").value, next }),
    });
    document.getElementById("modalHost").innerHTML = "";
    toast("Password changed");
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove("hide");
  }
}

/* ------------------------------------------------------------- delegation */

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.getAttribute("data-act");

  if (act === "go") { go(el.getAttribute("data-view")); return; }
  if (act === "new") { newReferral(); return; }
  if (act === "open") { openPatient(el.getAttribute("data-id")); return; }
  if (act === "filter") { filter = el.getAttribute("data-k"); loadList(); return; }
  if (act === "prov") {
    const n = el.getAttribute("data-name");
    dashState.provider = (!n || dashState.provider === n) ? null : n;
    loadDash();
    return;
  }
  if (act === "save") { saveForm(); return; }
  if (act === "addproc") {
    collect();
    editing.procedures.push({ exam: firstExam(), scheduled_at: "", facility: "", provider: "", status: "Pending LOP" });
    renderForm();
    return;
  }
  if (act === "delproc") {
    collect();
    editing.procedures.splice(+el.getAttribute("data-i"), 1);
    renderForm();
    return;
  }
  if (act === "addnote") { addNote(); return; }
  if (act === "sms") { sendSms(); return; }
  if (act === "savepw") { savePassword(); return; }
  if (act === "closemodal") { document.getElementById("modalHost").innerHTML = ""; return; }
  if (act === "changepw") { passwordModal(false); return; }
  if (act === "logout") {
    api("/api/logout", { method: "POST" }).finally(() => { location.href = "/login"; });
    return;
  }
});

document.addEventListener("change", e => {
  if (e.target.id === "dashDate") {
    dashState.date = e.target.value;
    dashState.provider = null;
    loadDash();
  }
});

let searchTimer;
document.addEventListener("input", e => {
  if (e.target.id === "q") {
    // Searching looks across the whole log. Without this, typing a name while a
    // chip is active returns nothing and it looks like the patient is not there.
    if (e.target.value.trim()) filter = "all";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadList, 250);
    return;
  }
  // Picking from the datalist fires "input", not "change", so resolve here.
  if (e.target.hasAttribute && e.target.hasAttribute("data-lookup")) resolveLookup(e.target);
});

// A datalist pick in some browsers only settles on blur; re-resolve then too.
document.addEventListener("change", e => {
  if (e.target.hasAttribute && e.target.hasAttribute("data-lookup")) resolveLookup(e.target);
});

/* ------------------------------------------------------------------ start */

(async function start() {
  try {
    BOOT = await api("/api/bootstrap");
  } catch (e) { return; }

  document.getElementById("userName").innerHTML =
    `${esc(BOOT.user.name)}<small>${esc({ admin: "Administrator", staff: "Staff", auth: "Authorisations", viewer: "View only" }[BOOT.user.role] || BOOT.user.role)}</small>`;
  document.getElementById("userAvatar").textContent = initials(BOOT.user.name);
  if (BOOT.perms.admin) document.getElementById("navAdmin").classList.remove("hide");
  if (BOOT.perms.write) document.getElementById("newBtn2").classList.remove("hide");

  const me = await api("/api/me").catch(() => null);
  if (me && me.must_change) passwordModal(true);

  go("dash");
})();
