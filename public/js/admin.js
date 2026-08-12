"use strict";
/* Admin screen — the practice manages its own lists, directories and logins. */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

const TABS = [
  { key: "facilities", label: "Facilities", type: "simple", noun: "facility" },
  { key: "providers", label: "Providers", type: "simple", noun: "provider" },
  { key: "exams", label: "Exams", type: "simple", noun: "exam", extra: "category" },
  { key: "statuses", label: "Statuses", type: "simple", noun: "status", extra: "kind" },
  { key: "attorneys", label: "Attorneys", type: "dir", noun: "attorney", second: "firm", secondLabel: "Firm" },
  { key: "doctors", label: "Referring Doctors", type: "dir", noun: "referring doctor", second: "practice", secondLabel: "Practice" },
  { key: "users", label: "Staff Logins", type: "users" },
  { key: "audit", label: "Audit Trail", type: "audit" },
];

const KINDS = [
  ["pending_lop", "Waiting on LOP approval"],
  ["ready", "Ready to schedule"],
  ["scheduled", "Scheduled"],
  ["inoffice", "In office / check out"],
  ["done", "Finished"],
  ["negative", "Cancelled / no show"],
];
const ROLES = [
  ["staff", "Staff — register, schedule, edit patients"],
  ["auth", "Authorisations — LOP approvals and notes only"],
  ["admin", "Administrator — full access including this screen"],
  ["viewer", "View only — cannot change anything"],
];

let current = TABS[0];
let rows = [];

function renderTabs() {
  document.getElementById("tabs").innerHTML = TABS.map(t =>
    `<span class="tab ${t.key === current.key ? "on" : ""}" data-act="tab" data-key="${t.key}">${esc(t.label)}</span>`).join("");
}

async function load() {
  try {
    rows = await api(`/api/admin/${current.key}${current.type === "audit" ? "?limit=300" : ""}`);
  } catch (e) { toast(e.message); return; }
  renderPanel();
}

function renderPanel() {
  const panel = document.getElementById("panel");
  if (current.type === "audit") return renderAudit(panel);
  if (current.type === "users") return renderUsers(panel);
  if (current.type === "dir") return renderDir(panel);
  return renderSimple(panel);
}

function addBar(text) {
  return `<div class="main-head" style="margin-bottom:14px"><div class="sub">${esc(text)}</div>
    <button class="btn" data-act="add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Add</button></div>`;
}

function renderSimple(panel) {
  const extra = current.extra;
  panel.innerHTML = addBar(`${rows.filter(r => r.active).length} active ${current.label.toLowerCase()}`) + `
    <div class="tablewrap"><table><thead><tr>
      <th>Name</th>${extra ? `<th>${extra === "kind" ? "Behaves as" : "Category"}</th>` : ""}<th>Status</th><th style="width:170px">Actions</th>
    </tr></thead><tbody>${rows.map(r => `
      <tr class="${r.active ? "" : "inactive"}">
        <td><b>${esc(r.name)}</b></td>
        ${extra ? `<td class="muted">${esc(extra === "kind" ? (KINDS.find(k => k[0] === r.kind) || [, r.kind])[1] : r.category)}</td>` : ""}
        <td>${r.active ? '<span class="status s-ready"><span class="d"></span>Active</span>' : '<span class="status s-done"><span class="d"></span>Hidden</span>'}</td>
        <td><div class="tbl-actions">
          <button class="mini ghost" data-act="edit" data-id="${r.id}">Edit</button>
          ${r.active ? `<button class="mini ghost" data-act="deact" data-id="${r.id}">Hide</button>`
                     : `<button class="mini ghost" data-act="react" data-id="${r.id}">Restore</button>`}
        </div></td>
      </tr>`).join("")}</tbody></table></div>
    <div class="muted" style="font-size:12.5px;margin-top:12px">Hiding removes an item from the dropdowns but keeps it readable on older patient records, so your history stays intact.</div>`;
}

function renderDir(panel) {
  panel.innerHTML = addBar(`${rows.filter(r => r.active).length} active ${current.label.toLowerCase()}`) + `
    <div class="tablewrap"><table><thead><tr>
      <th>Name</th><th>${esc(current.secondLabel)}</th><th>Phone</th><th>Email</th><th>City</th><th style="width:170px">Actions</th>
    </tr></thead><tbody>${rows.map(r => `
      <tr class="${r.active ? "" : "inactive"}">
        <td><b>${esc(r.name)}</b></td>
        <td class="muted">${esc(r[current.second] || "—")}</td>
        <td class="muted">${esc(r.phone || "—")}</td>
        <td class="muted">${esc(r.email || "—")}</td>
        <td class="muted">${esc(r.city || "—")}</td>
        <td><div class="tbl-actions">
          <button class="mini ghost" data-act="edit" data-id="${r.id}">Edit</button>
          ${r.active ? `<button class="mini ghost" data-act="deact" data-id="${r.id}">Hide</button>`
                     : `<button class="mini ghost" data-act="react" data-id="${r.id}">Restore</button>`}
        </div></td>
      </tr>`).join("")}</tbody></table></div>`;
}

function renderUsers(panel) {
  panel.innerHTML = addBar(`${rows.filter(r => r.active).length} active logins`) + `
    <div class="tablewrap"><table><thead><tr>
      <th>Name</th><th>Username</th><th>Role</th><th>Last signed in</th><th>Status</th><th style="width:200px">Actions</th>
    </tr></thead><tbody>${rows.map(r => `
      <tr class="${r.active ? "" : "inactive"}">
        <td><b>${esc(r.full_name)}</b></td>
        <td class="muted">${esc(r.username)}</td>
        <td><span class="rolechip ${esc(r.role)}">${esc((ROLES.find(x => x[0] === r.role) || [, r.role])[1].split(" — ")[0])}</span></td>
        <td class="muted">${esc(r.last_login_at || "never")}</td>
        <td>${r.active ? '<span class="status s-ready"><span class="d"></span>Active</span>' : '<span class="status s-no"><span class="d"></span>Revoked</span>'}</td>
        <td><div class="tbl-actions">
          <button class="mini ghost" data-act="edit" data-id="${r.id}">Edit</button>
          <button class="mini ghost" data-act="resetpw" data-id="${r.id}">Reset password</button>
        </div></td>
      </tr>`).join("")}</tbody></table></div>
    <div class="muted" style="font-size:12.5px;margin-top:12px">When someone leaves, edit their login and switch it to Revoked. Their name stays on the records they created, but they can no longer sign in.</div>`;
}

function renderAudit(panel) {
  panel.innerHTML = `
    <div class="main-head" style="margin-bottom:14px"><div class="sub">Most recent ${rows.length} actions. Every view and change is recorded.</div></div>
    <div class="tablewrap"><table><thead><tr>
      <th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th><th>IP</th>
    </tr></thead><tbody>${rows.map(r => `
      <tr style="cursor:default">
        <td class="muted">${esc(r.created_at)}</td>
        <td><b>${esc(r.user_name || "—")}</b></td>
        <td class="muted">${esc(r.action)}</td>
        <td class="muted">${esc(r.entity || "—")}${r.entity_id ? " #" + r.entity_id : ""}</td>
        <td class="muted">${esc(r.detail || "—")}</td>
        <td class="muted">${esc(r.ip || "—")}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

/* ------------------------------------------------------------------ modals */

function fld(label, id, val, type) {
  return `<div class="fld"><label>${esc(label)}</label><input id="${id}" type="${type || "text"}" value="${esc(val || "")}"></div>`;
}
function selFld(label, id, options, val) {
  return `<div class="fld"><label>${esc(label)}</label><select id="${id}">${options.map(([v, t]) =>
    `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
}
function showModal(html) {
  document.getElementById("modalHost").innerHTML = `<div class="modalbg"><div class="modal">${html}</div></div>`;
}
function closeModal() {
  document.getElementById("modalHost").innerHTML = "";
}
function foot(saveLabel) {
  return `<div class="err hide" id="mErr"></div><div class="modalfoot">
    <button class="fbtn" data-act="closemodal">Cancel</button>
    <button class="fbtn pri" data-act="submit">${esc(saveLabel || "Save")}</button></div>`;
}
function mErr(msg) {
  const e = document.getElementById("mErr");
  e.textContent = msg;
  e.classList.remove("hide");
}

let editingId = null;

function openEditor(id) {
  editingId = id;
  const r = id ? rows.find(x => x.id === Number(id)) : null;
  const t = current.type;

  if (t === "simple") {
    showModal(`<h3>${r ? "Edit" : "Add"} ${esc(current.noun)}</h3>
      ${fld("Name", "f_name", r ? r.name : "")}
      ${current.extra === "kind" ? selFld("Behaves as", "f_kind", KINDS, r ? r.kind : "done") : ""}
      ${current.extra === "category" ? fld("Category (groups it in the dropdown)", "f_category", r ? r.category : "Other") : ""}
      ${foot()}`);
    if (current.extra === "kind" && !r) {
      // Nudge: a new status usually needs to behave like something that already exists.
    }
    return;
  }

  if (t === "dir") {
    showModal(`<h3>${r ? "Edit" : "Add"} ${esc(current.noun)}</h3>
      ${fld("Name", "f_name", r ? r.name : "")}
      ${fld(current.secondLabel, "f_second", r ? r[current.second] : "")}
      ${fld("Phone", "f_phone", r ? r.phone : "")}
      ${fld("Email", "f_email", r ? r.email : "", "email")}
      ${fld("Address", "f_address", r ? r.address : "")}
      ${fld("City", "f_city", r ? r.city : "")}
      ${fld("State", "f_state", r ? r.state : "")}
      ${fld("Zip", "f_zip", r ? r.zip : "")}
      ${foot()}`);
    return;
  }

  if (t === "users") {
    showModal(`<h3>${r ? "Edit login" : "Add staff login"}</h3>
      ${fld("Full name", "f_name", r ? r.full_name : "")}
      ${r ? "" : fld("Username", "f_username", "")}
      ${selFld("Role", "f_role", ROLES, r ? r.role : "staff")}
      ${r ? selFld("Access", "f_active", [["1", "Active"], ["0", "Revoked — cannot sign in"]], String(r.active)) : ""}
      ${r ? "" : fld("Temporary password (at least 10 characters)", "f_password", "", "text")}
      ${r ? "" : `<div class="muted" style="font-size:12px;margin-top:-4px">They will be asked to choose their own password when they first sign in.</div>`}
      ${foot()}`);
  }
}

function resetPassword(id) {
  editingId = id;
  const r = rows.find(x => x.id === Number(id));
  showModal(`<h3>Reset password</h3>
    <p class="muted" style="font-size:13px;margin:-8px 0 16px">Set a temporary password for ${esc(r.full_name)}. They will be asked to choose their own when they next sign in.</p>
    ${fld("Temporary password (at least 10 characters)", "f_password", "", "text")}
    ${foot("Reset password")}`);
  current._resetting = true;
}

async function submitModal() {
  const t = current.type;
  const v = id => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };

  try {
    if (current._resetting) {
      await api(`/api/admin/users/${editingId}`, { method: "PUT", body: JSON.stringify({ password: v("f_password") }) });
      current._resetting = false;
      closeModal();
      toast("Password reset");
      return load();
    }

    let body = {};
    if (t === "simple") {
      body = { name: v("f_name") };
      if (current.extra === "kind") body.kind = v("f_kind");
      if (current.extra === "category") body.category = v("f_category");
    } else if (t === "dir") {
      body = {
        name: v("f_name"), phone: v("f_phone"), email: v("f_email"), address: v("f_address"),
        city: v("f_city"), state: v("f_state"), zip: v("f_zip"),
      };
      body[current.second] = v("f_second");
    } else if (t === "users") {
      body = { full_name: v("f_name"), role: v("f_role") };
      if (editingId) body.active = v("f_active") === "1";
      else { body.username = v("f_username"); body.password = v("f_password"); }
    }

    if (editingId) await api(`/api/admin/${current.key}/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
    else await api(`/api/admin/${current.key}`, { method: "POST", body: JSON.stringify(body) });

    closeModal();
    toast("Saved");
    load();
  } catch (e) { mErr(e.message); }
}

/* ------------------------------------------------------------- delegation */

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.getAttribute("data-act");

  if (act === "tab") {
    current = TABS.find(t => t.key === el.getAttribute("data-key"));
    renderTabs();
    load();
    return;
  }
  if (act === "add") { openEditor(null); return; }
  if (act === "edit") { openEditor(el.getAttribute("data-id")); return; }
  if (act === "resetpw") { resetPassword(el.getAttribute("data-id")); return; }
  if (act === "closemodal") { current._resetting = false; closeModal(); return; }
  if (act === "submit") { submitModal(); return; }
  if (act === "deact") {
    try {
      await api(`/api/admin/${current.key}/${el.getAttribute("data-id")}`, { method: "DELETE" });
      toast("Hidden");
      load();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === "react") {
    try {
      await api(`/api/admin/${current.key}/${el.getAttribute("data-id")}`, {
        method: "PUT", body: JSON.stringify({ active: true }),
      });
      toast("Restored");
      load();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === "logout") {
    api("/api/logout", { method: "POST" }).finally(() => { location.href = "/login"; });
  }
});

(async function start() {
  try {
    const me = await api("/api/me");
    document.getElementById("userName").innerHTML = `${esc(me.name)}<small>Administrator</small>`;
  } catch (e) { return; }
  renderTabs();
  load();
})();
