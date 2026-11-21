/* NPRS web app — implements the Figma UI/UX design (SDS §8) against the
   REST API. Role-shaped navigation (UI-02), status always icon + word
   (UI-03), dates as "20 November 2026, 10:42:07" (UI-08). */
"use strict";

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const state = {
  access: sessionStorage.getItem("nprs_access") || "",
  refresh: sessionStorage.getItem("nprs_refresh") || "",
  user: null,
  challenge: "",
  cameras: [],
  purposes: [],
  ws: null,
};

function saveTokens() {
  sessionStorage.setItem("nprs_access", state.access);
  sessionStorage.setItem("nprs_refresh", state.refresh);
}
function clearTokens() {
  state.access = ""; state.refresh = ""; state.user = null;
  sessionStorage.removeItem("nprs_access");
  sessionStorage.removeItem("nprs_refresh");
}

/* ---------------- API ---------------- */
async function api(path, opts = {}, retry = true) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json",
               ...(state.access ? { Authorization: "Bearer " + state.access } : {}),
               ...(opts.headers || {}) },
  });
  if (res.status === 401 && retry && state.refresh && !path.startsWith("/auth/")) {
    const ok = await refreshTokens();
    if (ok) return api(path, opts, false);
    showLogin();
    throw new Error("Your session has ended. Sign in again.");
  }
  return res;
}
async function apiJson(path, opts) {
  const res = await api(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Something went wrong. Try again.");
  return data;
}
async function refreshTokens() {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    state.access = data.access_token; state.refresh = data.refresh_token;
    saveTokens();
    return true;
  } catch { return false; }
}

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function parseTs(ts) {
  if (!ts) return null;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(ts);
  return new Date(hasTz ? ts : ts + "Z");
}
function fmtDateTime(ts) {
  const d = parseTs(ts);
  if (!d || isNaN(d)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
}
function fmtTime(ts) {
  const d = parseTs(ts);
  if (!d || isNaN(d)) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}
function statusChip(ev) {
  if (ev.status === "Known") return `<span class="chip known">✓ Known</span>`;
  return `<span class="chip unknown">? UNKNOWN</span>`;
}
function plateChip(ev) {
  if (ev.plate_status === "UNREADABLE") return `<span class="chip crit">✕ UNREADABLE</span>`;
  if (ev.plate_status === "No Plate Detected") return `<span class="chip warn">⚠ No plate detected</span>`;
  if (ev.plate_status === "Needs Review") return `<span class="chip warn">◐ Needs review</span>`;
  return "";
}
function flagChips(ev) {
  return (ev.flags || []).map(f => `<span class="chip warn">⚠ ${esc(f)}</span>`).join(" ");
}
function toast(msg, isError) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  $("#toast-region").appendChild(el);
  setTimeout(() => el.remove(), 5200);
}
function announce(msg) { $("#sr-announcer").textContent = msg; }
function has(perm) { return state.user && state.user.permissions.includes(perm); }

async function loadImg(imgEl, url) {
  try {
    const res = await api(url);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    imgEl.src = URL.createObjectURL(blob);
  } catch { imgEl.alt = "Image not available"; }
}

/* ---------------- auth screens ---------------- */
function showLogin() {
  clearTokens();
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#login-form").hidden = false;
  $("#mfa-form").hidden = true;
  $("#force-password-form").hidden = true;
}
function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  $("#side-user-name").textContent = state.user.full_name;
  $("#side-user-role").textContent = roleName(state.user.role);
  buildNav();
  route();
  startClock();
  connectLive();
}
function roleName(code) {
  return { SA: "System Administrator", SS: "Security Supervisor", GO: "Gate Operator",
           RM: "Registry Manager", AU: "Auditor", RV: "Report Viewer" }[code] || code;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error"); err.hidden = true;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("#login-username").value.trim(),
                             password: $("#login-password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Sign-in failed.");
    $("#fp-current").value = $("#login-password").value;
    if (data.mfa_required) {
      state.challenge = data.challenge;
      $("#login-form").hidden = true;
      $("#mfa-form").hidden = false;
      otpBoxes.forEach((b) => { b.value = ""; }); syncOtp();
      otpBoxes[0].focus();
      return;
    }
    finishLogin(data);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$("#mfa-back").addEventListener("click", () => {
  $("#mfa-form").hidden = true; $("#login-form").hidden = false;
});
/* OTP digit boxes (design: six separate boxes) */
const otpBoxes = [...document.querySelectorAll(".otp-box")];
function syncOtp() { $("#mfa-code").value = otpBoxes.map((b) => b.value).join(""); }
otpBoxes.forEach((box, i) => {
  box.addEventListener("input", () => {
    box.value = box.value.replace(/\D/g, "").slice(-1);
    syncOtp();
    if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !box.value && i > 0) otpBoxes[i - 1].focus();
  });
  box.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    text.split("").forEach((ch, j) => { if (otpBoxes[j]) otpBoxes[j].value = ch; });
    syncOtp();
    otpBoxes[Math.min(text.length, 5)].focus();
  });
});
$("#mfa-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#mfa-error"); err.hidden = true;
  try {
    const res = await fetch("/api/auth/mfa", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: state.challenge, code: $("#mfa-code").value.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Verification failed.");
    finishLogin(data);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
function finishLogin(data) {
  state.access = data.access_token; state.refresh = data.refresh_token;
  state.user = data.user; saveTokens();
  if (data.must_change_password) {
    $("#login-form").hidden = true; $("#mfa-form").hidden = true;
    $("#force-password-form").hidden = false;
    return;
  }
  afterLogin();
}
$("#force-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#fp-error"); err.hidden = true;
  try {
    if ($("#fp-new").value !== $("#fp-confirm").value)
      throw new Error("The two passwords do not match — type the new password again.");
    await apiJson("/auth/password", { method: "POST", body: JSON.stringify({
      current_password: $("#fp-current").value, new_password: $("#fp-new").value }) });
    toast("Password changed.");
    afterLogin();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
async function afterLogin() {
  if (!state.user) state.user = await apiJson("/auth/me");
  state.cameras = (await apiJson("/cameras").catch(() => ({ cameras: [] }))).cameras;
  state.purposes = (await apiJson("/purposes").catch(() => ({ purposes: [] }))).purposes;
  showApp();
}
$("#sign-out").addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  if (state.ws) state.ws.close();
  showLogin();
});

/* ---------------- navigation & routing ---------------- */
const NAV = [
  ["dashboard", "Dashboard", "dashboard.view"],
  ["live", "Live Monitor", "live.view"],
  ["events", "Event Log", "event.read"],
  ["review", "Review Queue", "review.resolve"],
  ["manual", "Manual Event", "event.create_manual"],
  ["inside", "Vehicles Inside", "event.read"],
  ["registry", "Registry", "registry.read"],
  ["cameras", "Cameras", "dashboard.view"],
  ["alerts", "Alerts", "dashboard.view"],
  ["reports", "Reports", "report.generate"],
  ["users", "Users & Roles", "user.manage"],
  ["audit", "Audit Log", "audit.view"],
  ["settings", "Settings", "config.manage"],
  ["data", "Data Protection", null], // shown if legal.hold or privacy.manage
];
function buildNav() {
  const nav = $("#main-nav");
  nav.innerHTML = "";
  for (const [key, label, perm] of NAV) {
    const visible = key === "data"
      ? (has("legal.hold") || has("privacy.manage"))
      : has(perm);
    if (!visible) continue;
    const a = document.createElement("a");
    a.href = "#/" + key;
    a.textContent = label;
    a.dataset.route = key;
    nav.appendChild(a);
  }
}
const TITLES = { dashboard: "Dashboard", live: "Live Monitor", events: "Event Log",
  review: "Review Queue", manual: "Manual Event", inside: "Vehicles Inside",
  registry: "Vehicle Registry", cameras: "Cameras", alerts: "Alerts",
  reports: "Reports", users: "Users & Roles", audit: "Audit Log",
  settings: "Settings", data: "Data Protection" };

function route() {
  const key = (location.hash.replace("#/", "") || "dashboard").split("?")[0];
  const view = VIEWS[key] || VIEWS.dashboard;
  $$("#main-nav a").forEach(a => {
    if (a.dataset.route === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#page-title").textContent = TITLES[key] || "Dashboard";
  view($("#main"));
  $("#page-title").focus({ preventScroll: true });
}
window.addEventListener("hashchange", () => route());

function startClock() {
  const tick = () => { $("#clock").textContent = fmtDateTime(new Date().toISOString()); };
  tick(); setInterval(tick, 1000);
}

/* ---------------- live push ---------------- */
function connectLive() {
  if (!has("live.view")) return;
  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    state.ws = new WebSocket(`${proto}://${location.host}/api/live/ws`);
    state.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "event") {
          announce(`New ${data.event.event_type.toLowerCase()} event. Plate ${data.event.plate_display || "unknown"}. Status ${data.event.status}.`);
          if (currentView === "live" || currentView === "dashboard") route();
          refreshAlertBadge();
        }
      } catch {}
    };
    state.ws.onclose = () => setTimeout(connectLive, 5000);
  } catch {}
}
async function refreshAlertBadge() {
  if (!has("dashboard.view")) return;
  const s = await apiJson("/dashboard/summary").catch(() => null);
  const badge = $("#alert-badge");
  if (s && s.active_alerts > 0) {
    badge.hidden = false;
    badge.textContent = `${s.active_alerts} active alert${s.active_alerts === 1 ? "" : "s"}`;
  } else badge.hidden = true;
}
let currentView = "dashboard";
const _route = route;
route = function () { currentView = (location.hash.replace("#/", "") || "dashboard").split("?")[0]; _route(); };

/* ================= VIEWS ================= */
const VIEWS = {};

/* ---------------- Dashboard ---------------- */
VIEWS.dashboard = async (main) => {
  main.innerHTML = `<p class="muted">Loading…</p>`;
  const s = await apiJson("/dashboard/summary").catch(e => ({ error: e.message }));
  if (s.error) { main.innerHTML = `<p class="error">${esc(s.error)}</p>`; return; }
  refreshAlertBadge();
  const catRows = Object.entries(s.inside_by_category)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("");
  const camRows = s.cameras.map(c => `<tr>
      <td>${esc(c.name)}</td><td>${esc(c.gate)} · ${esc(c.lane)}</td><td>${esc(c.role)}</td>
      <td>${c.status === "online" ? '<span class="chip known">● Online</span>'
          : c.status === "disabled" ? '<span class="chip info">Disabled</span>'
          : '<span class="chip crit">● Offline</span>'}</td></tr>`).join("");
  main.innerHTML = `
    <div class="cards">
      <div class="card"><div class="num">${s.inside_now}</div><div class="lbl">Vehicles inside now</div></div>
      <div class="card"><div class="num">${s.entries_today}</div><div class="lbl">Entries today</div></div>
      <div class="card"><div class="num">${s.exits_today}</div><div class="lbl">Exits today</div></div>
      <div class="card"><div class="num">${s.unknown_today}</div><div class="lbl">Unknown today</div></div>
      <div class="card"><div class="num">${s.reviews_waiting}</div><div class="lbl">Reviews waiting</div></div>
      <div class="card"><div class="num">${s.active_alerts}</div><div class="lbl">Active alerts</div></div>
    </div>
    <div class="grid2">
      <section class="panel"><h3>Vehicles inside by category</h3>
        <table><thead><tr><th>Category</th><th>Inside</th></tr></thead>
        <tbody>${catRows || '<tr><td colspan="2" class="muted">No vehicles inside.</td></tr>'}</tbody></table></section>
      <section class="panel"><h3>Camera &amp; edge status</h3>
        <table><thead><tr><th>Camera</th><th>Location</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>${camRows}</tbody></table></section>
    </div>
    <section class="panel"><h3>Latest events</h3><div id="dash-events"></div></section>`;
  const data = await apiJson("/live/events").catch(() => ({ events: [] }));
  $("#dash-events").innerHTML = eventTable(data.events.slice(0, 10));
  wireEventRows(main);
};

function eventTable(events) {
  if (!events.length) return `<p class="muted">No events yet. When a vehicle passes a camera, it appears here.</p>`;
  const rows = events.map(ev => `<tr class="clickable" data-event="${ev.id}" tabindex="0">
    <td>${ev.images && ev.images[0] ? `<img class="thumb" data-img="${ev.id}/${ev.images[0].id}" alt="Vehicle at ${esc(ev.camera_name)}">` : ""}</td>
    <td class="plate">${esc(ev.plate_status === "UNREADABLE" ? "UNREADABLE" : (ev.plate_display || ev.plate_normalised || "—"))}</td>
    <td>${statusChip(ev)} ${plateChip(ev)}</td>
    <td>${esc(ev.event_type)}</td>
    <td>${esc(ev.vehicle_class)}</td>
    <td>${esc(ev.camera_name)}</td>
    <td>${fmtTime(ev.ts)}</td>
    <td>${esc(ev.purpose || "—")}</td>
    <td>${flagChips(ev)}</td></tr>`).join("");
  return `<table><thead><tr><th></th><th>Plate</th><th>Status</th><th>Type</th><th>Class</th>
    <th>Camera</th><th>Time</th><th>Purpose of Visit <span class="muted">(Optional)</span></th><th>Flags</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
function wireEventRows(root) {
  $$("img[data-img]", root).forEach(img => {
    const [eid, iid] = img.dataset.img.split("/");
    loadImg(img, `/events/${eid}/images/${iid}`);
  });
  $$("tr[data-event]", root).forEach(tr => {
    const open = () => openEventDetail(tr.dataset.event);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
  });
}

/* ---------------- Live Monitor ---------------- */
VIEWS.live = async (main) => {
  main.innerHTML = `
    <p><span class="live-dot" aria-hidden="true"></span><strong>Live</strong>
    <span class="muted">— newest events appear automatically. If the connection drops, this list refreshes every 5 seconds.</span></p>
    <div id="live-list"><p class="muted">Loading…</p></div>`;
  const render = async () => {
    const data = await apiJson("/live/events").catch(() => ({ events: [] }));
    const el = $("#live-list");
    if (el) { el.innerHTML = eventTable(data.events); wireEventRows(main); }
  };
  await render();
  const timer = setInterval(() => { if (currentView !== "live") clearInterval(timer); else render(); }, 5000);
};

/* ---------------- Event Log ---------------- */
VIEWS.events = async (main) => {
  const camOpts = state.cameras.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  main.innerHTML = `
    <form id="event-filters" class="filters">
      <div class="field"><label for="f-q">Plate contains</label><input id="f-q" class="mono"></div>
      <div class="field"><label for="f-from">From</label><input id="f-from" type="datetime-local"></div>
      <div class="field"><label for="f-to">To</label><input id="f-to" type="datetime-local"></div>
      <div class="field"><label for="f-type">Type</label><select id="f-type">
        <option value="">All</option><option>Entry</option><option>Exit</option></select></div>
      <div class="field"><label for="f-status">Status</label><select id="f-status">
        <option value="">All</option><option>Known</option><option>UNKNOWN</option></select></div>
      <div class="field"><label for="f-camera">Camera</label><select id="f-camera">
        <option value="">All</option>${camOpts}</select></div>
      <div class="field"><label for="f-flag">Flag</label><input id="f-flag" placeholder="e.g. Type Mismatch"></div>
      <button class="btn primary" type="submit">Search</button>
    </form>
    <div id="event-results"><p class="muted">Loading…</p></div>
    <div class="kbd-row"><button class="btn" id="ev-prev" type="button">Previous page</button>
    <span id="ev-page" class="muted" aria-live="polite"></span>
    <button class="btn" id="ev-next" type="button">Next page</button></div>`;
  let page = 1;
  const load = async () => {
    const params = new URLSearchParams({ page });
    const set = (id, key) => { const v = $(id).value.trim(); if (v) params.set(key, v); };
    set("#f-q", "q"); set("#f-type", "type"); set("#f-status", "status");
    set("#f-camera", "camera_id"); set("#f-flag", "flag");
    const from = $("#f-from").value, to = $("#f-to").value;
    if (from) params.set("date_from", new Date(from).toISOString());
    if (to) params.set("date_to", new Date(to).toISOString());
    const data = await apiJson("/events?" + params.toString()).catch(e => ({ error: e.message }));
    const el = $("#event-results");
    if (data.error) { el.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    el.innerHTML = eventTable(data.events);
    wireEventRows(main);
    $("#ev-page").textContent = `Page ${data.page} · ${data.total} event${data.total === 1 ? "" : "s"}`;
    $("#ev-prev").disabled = page <= 1;
    $("#ev-next").disabled = data.events.length < 50;
  };
  $("#event-filters").addEventListener("submit", e => { e.preventDefault(); page = 1; load(); });
  $("#ev-prev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
  $("#ev-next").addEventListener("click", () => { page++; load(); });
  await load();
};

/* ---------------- Event detail (modal) ---------------- */
async function openEventDetail(eventId) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="ev-title">
    <p class="muted">Loading…</p></div></div>`;
  const ev = await apiJson(`/events/${eventId}`).catch(e => ({ error: e.message }));
  const modal = $(".modal", root);
  if (ev.error) { modal.innerHTML = `<p class="error">${esc(ev.error)}</p><button class="btn" onclick="document.getElementById('modal-root').innerHTML=''">Close</button>`; return; }
  const images = (ev.images || []).map(img => `
    <figure><img data-detail-img="${ev.id}/${img.id}" alt="${img.kind === 'plate' ? 'Plate crop' : 'Full vehicle'} image">
    <figcaption>${img.kind === "plate" ? "Plate crop" : "Full vehicle"} · integrity hash ${esc(img.sha256.slice(0, 12))}…</figcaption></figure>`).join("");
  const hist = (ev.history || []).map(h => `<tr><td>v${h.version}</td><td class="plate">${esc(h.plate_raw || h.plate_normalised)}</td>
    <td>${statusChip(h)}</td><td>${fmtDateTime(h.ts)}</td></tr>`).join("");
  const canPurpose = has("purpose.edit");
  const purposeOpts = state.purposes.filter(p => p.active)
    .map(p => `<option ${p.label === ev.purpose ? "selected" : ""}>${esc(p.label)}</option>`).join("");
  modal.innerHTML = `
    <h3 id="ev-title">Event — <span class="plate">${esc(ev.plate_status === "UNREADABLE" ? "UNREADABLE" : (ev.plate_display || ev.plate_normalised))}</span></h3>
    <p>${statusChip(ev)} ${plateChip(ev)} ${flagChips(ev)} ${ev.manual ? '<span class="chip info">Manual entry</span>' : ""}</p>
    <table>
      <tr><th>Type</th><td>${esc(ev.event_type)}</td><th>Time</th><td>${fmtDateTime(ev.ts)}</td></tr>
      <tr><th>Camera</th><td>${esc(ev.camera_name)} (${esc(ev.gate)} · ${esc(ev.lane)})</td>
          <th>Class</th><td>${esc(ev.vehicle_class)} (${Math.round((ev.class_confidence || 1) * 100)}%)</td></tr>
      <tr><th>Plate as read</th><td class="plate">${esc(ev.plate_raw || "—")}</td>
          <th>Confidence</th><td>${Math.round((ev.confidence || 0) * 100)}%</td></tr>
      ${ev.vehicle ? `<tr><th>Owner</th><td>${esc(ev.vehicle.owner_name)}</td>
          <th>Category</th><td>${esc(ev.vehicle.category)} · ${esc(ev.vehicle.status)}</td></tr>` : ""}
      ${ev.session ? `<tr><th>Visit</th><td colspan="3">${esc(ev.session.state)}${ev.session.dwell_seconds != null ? ` · dwell ${Math.round(ev.session.dwell_seconds / 60)} min` : ""}</td></tr>` : ""}
    </table>
    ${has("event.image") ? `<h4>Evidence</h4><div class="evidence">${images || '<p class="muted">No images stored for this event.</p>'}</div>`
                          : `<p class="muted">Your role cannot view evidence images.</p>`}
    <h4>Purpose of Visit <span class="muted">(Optional)</span></h4>
    ${canPurpose ? `
    <form id="purpose-form">
      <div class="field"><label for="p-purpose">Purpose</label>
        <input id="p-purpose" list="purpose-list" maxlength="250" value="${esc(ev.purpose || "")}">
        <datalist id="purpose-list">${purposeOpts}</datalist>
        <span class="hint">Choose from the list or type up to 250 characters. Leave empty if not needed.</span></div>
      <div class="grid2">
        <div class="field"><label for="p-visitor">Visitor name</label><input id="p-visitor" value="${esc(ev.visitor_name || "")}"></div>
        <div class="field"><label for="p-contact">Visitor contact</label><input id="p-contact" value="${esc(ev.visitor_contact || "")}"></div>
      </div>
      <div class="field"><label for="p-person">Person visited</label><input id="p-person" value="${esc(ev.person_visited || "")}"></div>
      <button class="btn primary" type="submit">Save Purpose</button>
    </form>` : `<p>${esc(ev.purpose || "Not recorded.")}</p>`}
    ${hist ? `<h4>Correction history</h4><table><thead><tr><th>Version</th><th>Plate</th><th>Status</th><th>Time</th></tr></thead><tbody>${hist}</tbody></table>` : ""}
    <div class="kbd-row">
      ${has("legal.hold") ? `<button class="btn" id="ev-hold" type="button">Place Legal Hold</button>` : ""}
      <button class="btn" id="ev-close" type="button">Close</button>
    </div>`;
  $$("img[data-detail-img]", modal).forEach(img => {
    const [eid, iid] = img.dataset.detailImg.split("/");
    loadImg(img, `/events/${eid}/images/${iid}`);
  });
  $("#ev-close").addEventListener("click", () => { root.innerHTML = ""; });
  const holdBtn = $("#ev-hold");
  if (holdBtn) holdBtn.addEventListener("click", async () => {
    const reason = prompt("Reason for the legal hold (recorded in the audit log):") || "";
    await apiJson("/legal-holds", { method: "POST", body: JSON.stringify({ event_id: ev.id, reason }) })
      .then(() => toast("Legal hold placed. This event is excluded from retention purges."))
      .catch(e => toast(e.message, true));
  });
  const pf = $("#purpose-form");
  if (pf) pf.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiJson(`/events/${ev.id}/purpose`, { method: "PUT", body: JSON.stringify({
        purpose: $("#p-purpose").value, visitor_name: $("#p-visitor").value,
        visitor_contact: $("#p-contact").value, person_visited: $("#p-person").value }) });
      toast("Purpose saved.");
      root.innerHTML = ""; route();
    } catch (ex) { toast(ex.message, true); }
  });
}

/* ---------------- Review Queue ---------------- */
VIEWS.review = async (main) => {
  main.innerHTML = `<p class="muted">Loading the queue…</p>`;
  const data = await apiJson("/review").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  if (!data.tasks.length) {
    main.innerHTML = `<div class="panel"><h3>Queue is clear</h3>
      <p class="muted">No events are waiting for review. New uncertain readings appear here, oldest first.</p></div>`;
    return;
  }
  main.innerHTML = `<p aria-live="polite"><strong>${data.waiting}</strong> task${data.waiting === 1 ? "" : "s"} waiting · oldest first</p>
    <div id="review-list"></div>`;
  const list = $("#review-list");
  for (const task of data.tasks) {
    const ev = task.event;
    const card = document.createElement("section");
    card.className = "panel";
    const candBtns = (ev.candidates || []).map(c =>
      `<button class="btn small" data-act="select_candidate" data-plate="${esc(c.plate)}" type="button">Use ${esc(c.plate)}</button>`).join(" ");
    card.innerHTML = `
      <h3><span class="plate">${esc(ev.plate_raw || "—")}</span>
        ${statusChip(ev)} ${plateChip(ev)}
        <span class="chip ${task.state === "escalated" ? "crit" : "info"}">${esc(task.reason)}</span></h3>
      <p class="muted">Waiting since ${fmtDateTime(task.created_at)} · ${esc(ev.event_type)} · ${esc(ev.camera_name)} ·
      read confidence ${Math.round((ev.confidence || 0) * 100)}%</p>
      <div class="evidence">${(ev.images || []).map(img => `
        <figure><img data-review-img="${ev.id}/${img.id}" alt="${img.kind} image"><figcaption>${img.kind}</figcaption></figure>`).join("")}</div>
      <form class="review-form">
        <div class="field"><label for="rp-${task.id}">Plate text (edit if the reading is wrong)</label>
          <input id="rp-${task.id}" class="mono" value="${esc(ev.plate_raw || "")}"></div>
        <div class="field"><label for="rr-${task.id}">Reason (required only for Discard)</label>
          <input id="rr-${task.id}"></div>
        <div class="kbd-row">
          <button class="btn primary" data-act="confirm" type="button">Confirm Reading</button>
          <button class="btn" data-act="correct" type="button">Correct &amp; Save</button>
          ${candBtns}
          <button class="btn" data-act="mark_unknown" type="button">Mark Unknown</button>
          <button class="btn danger" data-act="discard" type="button">Discard Event</button>
        </div>
      </form>`;
    $$("img[data-review-img]", card).forEach(img => {
      const [eid, iid] = img.dataset.reviewImg.split("/");
      loadImg(img, `/events/${eid}/images/${iid}`);
    });
    $$("button[data-act]", card).forEach(btn => btn.addEventListener("click", async () => {
      const action = btn.dataset.act;
      try {
        await apiJson(`/review/${task.id}/resolve`, { method: "POST", body: JSON.stringify({
          action,
          plate_text: action === "select_candidate" ? btn.dataset.plate : $(`#rp-${task.id}`).value,
          reason: $(`#rr-${task.id}`).value }) });
        toast(action === "discard" ? "Event discarded." : "Review saved.");
        route();
      } catch (ex) { toast(ex.message, true); }
    }));
    list.appendChild(card);
  }
};

/* ---------------- Manual Event ---------------- */
VIEWS.manual = async (main) => {
  const camOpts = state.cameras.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  main.innerHTML = `
    <div class="panel"><h3>Create a manual event</h3>
    <p class="muted">Use this when a camera missed a vehicle, for example during an outage. Manual events are flagged and audited. A time in the past needs a reason.</p>
    <form id="manual-form">
      <div class="grid2">
        <div class="field"><label for="m-plate">Plate number</label><input id="m-plate" class="mono" required></div>
        <div class="field"><label for="m-class">Vehicle class</label><select id="m-class">
          ${["car","motorcycle","scooter","auto-rickshaw","van","bus","truck","bicycle","other"].map(t => `<option>${t}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="m-type">Event type</label><select id="m-type"><option>Entry</option><option>Exit</option></select></div>
        <div class="field"><label for="m-camera">Camera</label><select id="m-camera">${camOpts}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="m-ts">Date and time</label><input id="m-ts" type="datetime-local" value="${nowLocal}" required></div>
        <div class="field"><label for="m-reason">Reason for a past time</label><input id="m-reason" placeholder="e.g. Camera outage 10:00–10:40"></div>
      </div>
      <div class="field"><label for="m-purpose">Purpose of Visit <span class="hint">(Optional)</span></label>
        <input id="m-purpose" maxlength="250"></div>
      <p id="m-error" class="error" role="alert" hidden></p>
      <button class="btn primary" type="submit">Create Event</button>
    </form></div>`;
  $("#manual-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#m-error"); err.hidden = true;
    try {
      const ev = await apiJson("/events/manual", { method: "POST", body: JSON.stringify({
        plate_text: $("#m-plate").value, vehicle_class: $("#m-class").value,
        event_type: $("#m-type").value, camera_id: $("#m-camera").value,
        ts: new Date($("#m-ts").value).toISOString(),
        purpose: $("#m-purpose").value, past_reason: $("#m-reason").value }) });
      toast(`Manual ${ev.event_type.toLowerCase()} created for ${ev.plate_display || ev.plate_normalised}.`);
      location.hash = "#/events";
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
};

/* ---------------- Vehicles Inside ---------------- */
VIEWS.inside = async (main) => {
  const data = await apiJson("/sessions/inside").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  const rows = data.inside.map(s => {
    const entered = parseTs(s.entry_ts);
    const mins = entered ? Math.max(0, Math.round((Date.now() - entered.getTime()) / 60000)) : 0;
    return `<tr><td class="plate">${esc(s.plate)}</td><td>${esc(s.category)}</td>
      <td>${fmtDateTime(s.entry_ts)}</td><td>${mins} min</td><td>${esc(s.purpose || "—")}</td>
      ${has("session.close_manual") ? `<td><button class="btn small" data-close="${s.id}" type="button">Close manually</button></td>` : ""}</tr>`;
  }).join("");
  main.innerHTML = `<div class="panel"><h3>${data.inside.length} vehicle${data.inside.length === 1 ? "" : "s"} inside</h3>
    <table><thead><tr><th>Plate</th><th>Category</th><th>Entered</th><th>Time inside</th><th>Purpose of Visit <span class="muted">(Optional)</span></th>${has("session.close_manual") ? "<th></th>" : ""}</tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No vehicles are inside.</td></tr>'}</tbody></table></div>`;
  $$("button[data-close]", main).forEach(btn => btn.addEventListener("click", async () => {
    const reason = prompt("Reason for closing this visit manually (audited):") || "";
    try {
      await apiJson(`/sessions/${btn.dataset.close}/close`, { method: "POST", body: JSON.stringify({ reason }) });
      toast("Visit closed."); route();
    } catch (ex) { toast(ex.message, true); }
  }));
};

/* ---------------- Registry ---------------- */
const CATEGORIES = ["Staff", "Resident", "Student", "Contractor", "Fleet", "Pre-registered Visitor", "VIP"];
const VTYPES = ["car", "motorcycle", "scooter", "auto-rickshaw", "van", "bus", "truck", "bicycle", "other"];

VIEWS.registry = async (main) => {
  const canWrite = has("registry.write"), canImport = has("registry.import"), canStatus = has("registry.status");
  main.innerHTML = `
    <form id="reg-filters" class="filters">
      <div class="field"><label for="r-q">Search plate or owner</label><input id="r-q"></div>
      <div class="field"><label for="r-cat">Category</label><select id="r-cat"><option value="">All</option>
        ${CATEGORIES.map(c => `<option>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="r-status">Status</label><select id="r-status"><option value="">All</option>
        <option>Active</option><option>Suspended</option><option>Blacklisted</option></select></div>
      <button class="btn primary" type="submit">Search</button>
      ${canWrite ? `<button class="btn" id="r-add" type="button">Add Vehicle</button>` : ""}
      ${canImport ? `<button class="btn" id="r-export" type="button">Export CSV</button>` : ""}
    </form>
    <div id="reg-results"><p class="muted">Loading…</p></div>
    ${canImport ? `<section class="panel"><h3>Import registry (CSV or XLSX, up to 10,000 rows)</h3>
      <div class="field"><label for="r-file">File</label><input id="r-file" type="file" accept=".csv,.xlsx"></div>
      <div class="kbd-row"><button class="btn" id="r-preview" type="button">Preview Import</button>
      <button class="btn primary" id="r-commit" type="button" disabled>Import Valid Rows</button></div>
      <div id="import-result" aria-live="polite"></div></section>` : ""}
    <div id="reg-form-slot"></div>`;
  let lastImportFile = null;
  const load = async () => {
    const params = new URLSearchParams();
    const q = $("#r-q").value.trim(); if (q) params.set("q", q);
    if ($("#r-cat").value) params.set("category", $("#r-cat").value);
    if ($("#r-status").value) params.set("status", $("#r-status").value);
    const data = await apiJson("/registry?" + params.toString()).catch(e => ({ error: e.message }));
    const el = $("#reg-results");
    if (data.error) { el.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    const rows = data.vehicles.map(v => `<tr>
      <td class="plate">${esc(v.plate_display)}</td><td>${esc(v.type)}</td>
      <td>${esc(v.owner_name || "—")}</td><td>${esc(v.category)}</td>
      <td>${v.valid_to ? fmtDateTime(v.valid_to).split(",")[0] : "—"}</td>
      <td>${v.status === "Active" ? '<span class="chip known">Active</span>' : v.status === "Suspended" ? '<span class="chip warn">Suspended</span>' : '<span class="chip crit">Blacklisted</span>'}</td>
      <td>${canWrite ? `<button class="btn small" data-edit="${v.id}" type="button">Edit</button>` : ""}
          ${canStatus ? `<button class="btn small" data-status="${v.id}" type="button">Status</button>` : ""}
          ${canWrite ? `<button class="btn small" data-del="${v.id}" type="button">Deactivate</button>` : ""}</td></tr>`).join("");
    el.innerHTML = `<p class="muted">${data.total} record${data.total === 1 ? "" : "s"}</p>
      <table><thead><tr><th>Plate</th><th>Type</th><th>Owner</th><th>Category</th><th>Valid to</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No records match.</td></tr>'}</tbody></table>`;
    $$("button[data-edit]", el).forEach(b => b.addEventListener("click", () =>
      vehicleForm(data.vehicles.find(v => v.id === b.dataset.edit))));
    $$("button[data-del]", el).forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Deactivate this record? Its history stays; the plate stops matching.")) return;
      await apiJson(`/registry/${b.dataset.del}`, { method: "DELETE" }).catch(e => toast(e.message, true));
      toast("Record deactivated."); load();
    }));
    $$("button[data-status]", el).forEach(b => b.addEventListener("click", async () => {
      const v = data.vehicles.find(x => x.id === b.dataset.status);
      const next = prompt(`Set status for ${v.plate_display} (Active, Suspended, Blacklisted):`, v.status);
      if (!next) return;
      try {
        await apiJson(`/registry/${v.id}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
        toast("Status updated."); load();
      } catch (e) { toast(e.message, true); }
    }));
  };
  const vehicleForm = (v) => {
    const slot = $("#reg-form-slot");
    const val = (k, d = "") => esc(v ? (v[k] ?? d) : d);
    slot.innerHTML = `<section class="panel"><h3>${v ? "Edit vehicle" : "Add vehicle"}</h3>
      <form id="vehicle-form">
        <div class="grid2">
          <div class="field"><label for="v-plate">Plate number</label><input id="v-plate" class="mono" required value="${val("plate_display")}"></div>
          <div class="field"><label for="v-type">Type</label><select id="v-type">${VTYPES.map(t => `<option ${v && v.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-make">Make</label><input id="v-make" value="${val("make")}"></div>
          <div class="field"><label for="v-model">Model</label><input id="v-model" value="${val("model")}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-colour">Colour</label><input id="v-colour" value="${val("colour")}"></div>
          <div class="field"><label for="v-owner">Owner name</label><input id="v-owner" value="${val("owner_name")}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-org">Organisation</label><input id="v-org" value="${val("organisation")}"></div>
          <div class="field"><label for="v-contact">Contact</label><input id="v-contact" value="${val("contact")}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-cat">Category</label><select id="v-cat">${CATEGORIES.map(c => `<option ${v && v.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          <div class="field"><label for="v-status">Status</label><select id="v-status">${["Active", "Suspended", "Blacklisted"].map(s => `<option ${v && v.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-from">Valid from</label><input id="v-from" type="date" value="${v && v.valid_from ? v.valid_from.slice(0, 10) : ""}"></div>
          <div class="field"><label for="v-to">Valid to</label><input id="v-to" type="date" value="${v && v.valid_to ? v.valid_to.slice(0, 10) : ""}"></div>
        </div>
        <div class="field"><label for="v-remarks">Remarks</label><input id="v-remarks" value="${val("remarks")}"></div>
        <p id="v-error" class="error" role="alert" hidden></p>
        <div class="kbd-row"><button class="btn primary" type="submit">${v ? "Save Changes" : "Add Vehicle"}</button>
        <button class="btn" type="button" id="v-cancel">Cancel</button></div>
      </form></section>`;
    slot.scrollIntoView({ behavior: "smooth" });
    $("#v-cancel").addEventListener("click", () => { slot.innerHTML = ""; });
    $("#vehicle-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#v-error"); err.hidden = true;
      const body = { plate_display: $("#v-plate").value, type: $("#v-type").value,
        make: $("#v-make").value, model: $("#v-model").value, colour: $("#v-colour").value,
        owner_name: $("#v-owner").value, organisation: $("#v-org").value, contact: $("#v-contact").value,
        category: $("#v-cat").value, status: $("#v-status").value, remarks: $("#v-remarks").value,
        valid_from: $("#v-from").value || null, valid_to: $("#v-to").value || null };
      try {
        await apiJson(v ? `/registry/${v.id}` : "/registry",
          { method: v ? "PUT" : "POST", body: JSON.stringify(body) });
        toast(v ? "Vehicle updated." : "Vehicle added.");
        slot.innerHTML = ""; load();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  };
  $("#reg-filters").addEventListener("submit", e => { e.preventDefault(); load(); });
  const addBtn = $("#r-add");
  if (addBtn) addBtn.addEventListener("click", () => vehicleForm(null));
  const expBtn = $("#r-export");
  if (expBtn) expBtn.addEventListener("click", async () => {
    const res = await api("/registry/export?format=csv");
    const blob = await res.blob();
    downloadBlob(blob, "registry.csv");
  });
  const doImport = async (commit) => {
    const file = $("#r-file").files[0];
    if (!file) { toast("Choose a CSV or XLSX file first.", true); return; }
    lastImportFile = file;
    const fd = new FormData();
    fd.append("file", file); fd.append("commit", commit ? "true" : "false");
    const res = await fetch("/api/registry/import", { method: "POST",
      headers: { Authorization: "Bearer " + state.access }, body: fd });
    const data = await res.json().catch(() => ({}));
    const slot = $("#import-result");
    if (!res.ok) { slot.innerHTML = `<p class="error">${esc(data.detail || "Import failed.")}</p>`; return; }
    const errRows = (data.errors || []).map(e => `<tr><td>${e.row}</td><td class="plate">${esc(e.plate)}</td><td>${esc(e.message)}</td></tr>`).join("");
    slot.innerHTML = `<p><strong>${data.total_rows}</strong> rows · <strong>${data.valid_rows}</strong> valid · <strong>${data.error_rows}</strong> with errors${commit ? ` · <strong>${data.imported}</strong> imported` : ""}</p>
      ${errRows ? `<table><thead><tr><th>Row</th><th>Plate</th><th>Problem</th></tr></thead><tbody>${errRows}</tbody></table>
      <button class="btn small" id="r-errdl" type="button">Download error report (CSV)</button>` : ""}`;
    $("#r-commit").disabled = data.valid_rows === 0;
    const dl = $("#r-errdl");
    if (dl) dl.addEventListener("click", () => downloadBlob(new Blob([data.error_report_csv], { type: "text/csv" }), "import-errors.csv"));
    if (commit) { toast("Import complete."); load(); }
  };
  const prevBtn = $("#r-preview"), commitBtn = $("#r-commit");
  if (prevBtn) prevBtn.addEventListener("click", () => doImport(false));
  if (commitBtn) commitBtn.addEventListener("click", () => doImport(true));
  await load();
};
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------- Cameras ---------------- */
VIEWS.cameras = async (main) => {
  const data = await apiJson("/cameras").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  state.cameras = data.cameras;
  const canManage = has("camera.manage");
  const rows = data.cameras.map(c => `<tr>
    <td>${esc(c.name)}</td><td>${esc(c.site)}</td><td>${esc(c.gate)} · ${esc(c.lane)}</td>
    <td>${esc(c.role)}</td><td>${esc(c.edge_node)}</td>
    <td>${c.status === "online" ? '<span class="chip known">● Online</span>' : c.status === "disabled" ? '<span class="chip info">Disabled</span>' : '<span class="chip crit">● Offline</span>'}</td>
    <td>${c.last_frame_at ? fmtDateTime(c.last_frame_at) : "—"}</td>
    <td>${canManage ? `<button class="btn small" data-cam-edit="${c.id}" type="button">Setup</button>
    <button class="btn small" data-cam-del="${c.id}" type="button">Delete</button>` : ""}</td></tr>`).join("");
  main.innerHTML = `
    <div class="panel"><table><thead><tr><th>Camera</th><th>Site</th><th>Location</th><th>Role</th>
      <th>Edge node</th><th>Status</th><th>Last frame</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${canManage ? `<div class="kbd-row"><button class="btn primary" id="cam-add" type="button">Add Camera</button></div>` : ""}</div>
    <div id="cam-form-slot"></div>`;
  const form = (c) => {
    const slot = $("#cam-form-slot");
    const val = (k, d = "") => esc(c ? (c[k] ?? d) : d);
    slot.innerHTML = `<section class="panel"><h3>${c ? "Camera setup" : "Add camera"}</h3>
      <form id="cam-form">
        <div class="grid2">
          <div class="field"><label for="c-name">Name</label><input id="c-name" required value="${val("name")}"></div>
          <div class="field"><label for="c-role">Role</label><select id="c-role">${["Entry", "Exit", "Bidirectional"].map(r => `<option ${c && c.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="c-site">Site</label><input id="c-site" value="${val("site", "Main Campus")}"></div>
          <div class="field"><label for="c-gate">Gate</label><input id="c-gate" value="${val("gate", "Main Gate")}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="c-lane">Lane</label><input id="c-lane" value="${val("lane", "Lane 1")}"></div>
          <div class="field"><label for="c-edge">Edge node</label><input id="c-edge" value="${val("edge_node", "Edge Node 1")}"></div>
        </div>
        <div class="field"><label for="c-stream">Stream URL (RTSP)</label><input id="c-stream" value="${val("stream_url")}" placeholder="rtsp://…"></div>
        <div class="grid2">
          <div class="field"><label for="c-roi">Region of interest (JSON)</label>
            <textarea id="c-roi" class="mono" rows="3">${val("roi", "[]")}</textarea>
            <span class="hint">Polygon points as [x, y] pairs in 0–1000 image coordinates.</span></div>
          <div class="field"><label for="c-line">Virtual line (JSON)</label>
            <textarea id="c-line" class="mono" rows="3">${val("virtual_line", "{}")}</textarea>
            <span class="hint">{"{"}"x1":0,"y1":500,"x2":1000,"y2":500{"}"} — crossing direction decides Entry/Exit on bidirectional cameras.</span></div>
        </div>
        <div class="field"><label for="c-status">Status</label><select id="c-status">
          ${["online", "offline", "degraded", "disabled"].map(s => `<option ${c && c.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <p id="c-error" class="error" role="alert" hidden></p>
        <div class="kbd-row"><button class="btn primary" type="submit">Save Camera</button>
        <button class="btn" type="button" id="c-cancel">Cancel</button></div>
      </form></section>`;
    slot.scrollIntoView({ behavior: "smooth" });
    $("#c-cancel").addEventListener("click", () => { slot.innerHTML = ""; });
    $("#cam-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#c-error"); err.hidden = true;
      const body = { name: $("#c-name").value, role: $("#c-role").value, site: $("#c-site").value,
        gate: $("#c-gate").value, lane: $("#c-lane").value, edge_node: $("#c-edge").value,
        stream_url: $("#c-stream").value, roi: $("#c-roi").value, virtual_line: $("#c-line").value,
        status: $("#c-status").value };
      try {
        await apiJson(c ? `/cameras/${c.id}` : "/cameras", { method: c ? "PUT" : "POST", body: JSON.stringify(body) });
        toast("Camera saved."); route();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  };
  const addBtn = $("#cam-add");
  if (addBtn) addBtn.addEventListener("click", () => form(null));
  $$("button[data-cam-edit]", main).forEach(b => b.addEventListener("click", () =>
    form(data.cameras.find(c => c.id === b.dataset.camEdit))));
  $$("button[data-cam-del]", main).forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Delete this camera? Existing events keep their history.")) return;
    await apiJson(`/cameras/${b.dataset.camDel}`, { method: "DELETE" }).catch(e => toast(e.message, true));
    toast("Camera deleted."); route();
  }));
};

/* ---------------- Alerts ---------------- */
VIEWS.alerts = async (main) => {
  const data = await apiJson("/alerts").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  const sev = s => s === "Critical" ? '<span class="chip crit">⛔ Critical</span>'
    : s === "Warning" ? '<span class="chip warn">⚠ Warning</span>' : '<span class="chip info">ℹ Information</span>';
  const rows = data.alerts.map(a => `<tr>
    <td>${sev(a.severity)}</td><td>${esc(a.type)}</td><td>${esc(a.message)}</td>
    <td>${fmtDateTime(a.created_at)}</td>
    <td>${a.ack_by ? `Acknowledged by ${esc(a.ack_by)}` : '<span class="chip warn">Not acknowledged</span>'}</td>
    <td>${!a.ack_by && has("alert.acknowledge") ? `<button class="btn small" data-ack="${a.id}" type="button">Acknowledge</button>` : ""}</td></tr>`).join("");
  main.innerHTML = `<div class="panel"><table><thead><tr><th>Severity</th><th>Type</th><th>Message</th>
    <th>Raised</th><th>Acknowledgement</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No alerts recorded.</td></tr>'}</tbody></table></div>`;
  $$("button[data-ack]", main).forEach(b => b.addEventListener("click", async () => {
    await apiJson(`/alerts/${b.dataset.ack}/ack`, { method: "POST" }).catch(e => toast(e.message, true));
    toast("Alert acknowledged."); refreshAlertBadge(); route();
  }));
};

/* ---------------- Reports ---------------- */
const REPORTS = [["daily-movement", "Daily Movement Summary"], ["currently-inside", "Currently Inside"],
  ["unknown-vehicles", "Unknown Vehicles"], ["dwell-time", "Dwell Time"], ["exceptions", "Exceptions"],
  ["blacklist-alerts", "Blacklist & Suspended Alerts"], ["camera-availability", "Camera Availability"]];
VIEWS.reports = async (main) => {
  main.innerHTML = `
    <form id="report-form" class="filters">
      <div class="field"><label for="rp-type">Report</label><select id="rp-type">
        ${REPORTS.map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
      <div class="field"><label for="rp-from">From</label><input id="rp-from" type="date"></div>
      <div class="field"><label for="rp-to">To</label><input id="rp-to" type="date"></div>
      <button class="btn primary" type="submit">Generate</button>
      ${has("report.export") ? `<button class="btn" data-fmt="csv" type="button">CSV</button>
      <button class="btn" data-fmt="xlsx" type="button">XLSX</button>
      <button class="btn" data-fmt="pdf" type="button">PDF</button>` : ""}
    </form>
    <div id="report-out"><p class="muted">Choose a report and choose Generate.</p></div>`;
  const query = () => {
    const p = new URLSearchParams();
    if ($("#rp-from").value) p.set("date_from", $("#rp-from").value);
    if ($("#rp-to").value) p.set("date_to", $("#rp-to").value + "T23:59:59");
    return p.toString();
  };
  $("#report-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = $("#rp-type").value;
    const data = await apiJson(`/reports/${type}?${query()}`).catch(err => ({ error: err.message }));
    const out = $("#report-out");
    if (data.error) { out.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    const cols = data.rows.length ? Object.keys(data.rows[0]) : [];
    out.innerHTML = `<section class="panel"><h3>${esc(data.title)}</h3>
      <p class="muted">Generated ${esc(data.generated_at)} by ${esc(data.generated_by)} · ${data.rows.length} row${data.rows.length === 1 ? "" : "s"}</p>
      ${cols.length ? `<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${data.rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : '<p class="muted">No records match the selected filters.</p>'}</section>`;
  });
  $$("button[data-fmt]", main).forEach(b => b.addEventListener("click", async () => {
    const type = $("#rp-type").value;
    const res = await api(`/reports/${type}?format=${b.dataset.fmt}&${query()}`);
    if (!res.ok) { toast("Export failed. Your role may not include export.", true); return; }
    downloadBlob(await res.blob(), `${type}.${b.dataset.fmt}`);
  }));
};

/* ---------------- Users ---------------- */
VIEWS.users = async (main) => {
  const data = await apiJson("/users").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  const roleOpts = sel => ["SA", "SS", "GO", "RM", "AU", "RV"]
    .map(r => `<option value="${r}" ${sel === r ? "selected" : ""}>${roleName(r)}</option>`).join("");
  const rows = data.users.map(u => `<tr>
    <td>${esc(u.username)}</td><td>${esc(u.full_name)}</td><td>${roleName(u.role)}</td>
    <td>${u.status === "active" ? '<span class="chip known">Active</span>' : '<span class="chip crit">Disabled</span>'}</td>
    <td>${u.mfa_enabled ? "On" : "Off"}</td><td>${u.last_login ? fmtDateTime(u.last_login) : "Never"}</td>
    <td><select data-role="${u.id}" aria-label="Role for ${esc(u.username)}">${roleOpts(u.role)}</select>
        <button class="btn small" data-toggle="${u.id}" data-status="${u.status}" type="button">${u.status === "active" ? "Disable" : "Enable"}</button>
        <button class="btn small" data-reset="${u.id}" type="button">Reset password</button></td></tr>`).join("");
  main.innerHTML = `
    <div class="panel"><table><thead><tr><th>User name</th><th>Name</th><th>Role</th><th>Status</th>
      <th>MFA</th><th>Last sign-in</th><th>Manage</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">At least two active System Administrator accounts are always kept (the system refuses changes that would break this). Role changes apply from the user's next request.</p></div>
    <section class="panel"><h3>Create user</h3>
      <form id="user-form"><div class="grid2">
        <div class="field"><label for="u-name">User name</label><input id="u-name" required></div>
        <div class="field"><label for="u-full">Full name</label><input id="u-full" required></div>
      </div><div class="grid2">
        <div class="field"><label for="u-role">Role</label><select id="u-role">${roleOpts("GO")}</select></div>
        <div class="field"><label for="u-pass">Password (at least 12 characters)</label><input id="u-pass" type="password" required minlength="12"></div>
      </div><div class="grid2">
        <div class="field"><label for="u-email">Email</label><input id="u-email" type="email"></div>
        <div class="field"><label for="u-phone">Phone</label><input id="u-phone"></div>
      </div>
      <p id="u-error" class="error" role="alert" hidden></p>
      <button class="btn primary" type="submit">Create User</button></form></section>`;
  $$("select[data-role]", main).forEach(sel => sel.addEventListener("change", async () => {
    try {
      await apiJson(`/users/${sel.dataset.role}`, { method: "PUT", body: JSON.stringify({ role: sel.value }) });
      toast("Role updated."); route();
    } catch (e) { toast(e.message, true); route(); }
  }));
  $$("button[data-toggle]", main).forEach(b => b.addEventListener("click", async () => {
    try {
      await apiJson(`/users/${b.dataset.toggle}`, { method: "PUT",
        body: JSON.stringify({ status: b.dataset.status === "active" ? "disabled" : "active" }) });
      toast("User updated."); route();
    } catch (e) { toast(e.message, true); }
  }));
  $$("button[data-reset]", main).forEach(b => b.addEventListener("click", async () => {
    try {
      const r = await apiJson(`/users/${b.dataset.reset}/reset-password`, { method: "POST" });
      alert(`Temporary password (shown once): ${r.temporary_password}\nThe user must change it at the next sign-in.`);
    } catch (e) { toast(e.message, true); }
  }));
  $("#user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#u-error"); err.hidden = true;
    try {
      await apiJson("/users", { method: "POST", body: JSON.stringify({
        username: $("#u-name").value, full_name: $("#u-full").value, role: $("#u-role").value,
        password: $("#u-pass").value, email: $("#u-email").value, phone: $("#u-phone").value }) });
      toast("User created."); route();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
};

/* ---------------- Audit ---------------- */
VIEWS.audit = async (main) => {
  main.innerHTML = `
    <form id="audit-filters" class="filters">
      <div class="field"><label for="a-action">Action contains</label><input id="a-action"></div>
      <div class="field"><label for="a-user">User name contains</label><input id="a-user"></div>
      <button class="btn primary" type="submit">Search</button>
      <button class="btn" id="a-verify" type="button">Verify Chain</button>
      ${has("audit.export") ? `<button class="btn" id="a-export" type="button">Export CSV</button>` : ""}
    </form>
    <p id="a-verify-out" aria-live="polite"></p>
    <div id="audit-results"><p class="muted">Loading…</p></div>`;
  const load = async () => {
    const p = new URLSearchParams();
    if ($("#a-action").value.trim()) p.set("action", $("#a-action").value.trim());
    if ($("#a-user").value.trim()) p.set("username", $("#a-user").value.trim());
    const data = await apiJson("/audit?" + p.toString()).catch(e => ({ error: e.message }));
    const el = $("#audit-results");
    if (data.error) { el.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    const rows = data.entries.map(r => `<tr><td>${fmtDateTime(r.ts)}</td><td>${esc(r.username || "—")}</td>
      <td>${esc(r.role)}</td><td>${esc(r.action)}</td><td>${esc(r.object_type)} ${esc(r.object_id ? "#" + r.object_id.slice(0, 8) : "")}</td>
      <td>${esc(r.result)}</td><td class="mono small">${esc(r.hash)}</td></tr>`).join("");
    el.innerHTML = `<p class="muted">${data.total} entr${data.total === 1 ? "y" : "ies"} · append-only · hash-chained</p>
      <table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Object</th><th>Result</th><th>Hash</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No entries match.</td></tr>'}</tbody></table>`;
  };
  $("#audit-filters").addEventListener("submit", e => { e.preventDefault(); load(); });
  $("#a-verify").addEventListener("click", async () => {
    const out = $("#a-verify-out");
    try {
      const r = await apiJson("/audit/verify");
      out.innerHTML = r.ok
        ? `<span class="chip known">✓ Chain verified — ${r.entries_checked} entries intact</span>`
        : `<span class="chip crit">✕ Chain broken at entry ${esc(r.first_bad_entry || "")}</span>`;
    } catch (e) { out.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  });
  const exp = $("#a-export");
  if (exp) exp.addEventListener("click", async () => {
    const res = await api("/audit/export");
    downloadBlob(await res.blob(), "audit-log.csv");
  });
  await load();
};

/* ---------------- Settings ---------------- */
VIEWS.settings = async (main) => {
  const cfg = await apiJson("/config").catch(e => ({ error: e.message }));
  if (cfg.error) { main.innerHTML = `<p class="error">${esc(cfg.error)}</p>`; return; }
  const formats = await apiJson("/plate-formats").catch(() => ({ formats: [] }));
  const s = cfg.settings;
  const num = (key, label, step = "0.01") => `
    <div class="field"><label for="s-${key}">${label}</label>
    <input id="s-${key}" type="number" step="${step}" value="${esc(s[key])}">
    <span class="hint">${esc(cfg.descriptions[key] || "")}</span></div>`;
  const text = (key, label) => `
    <div class="field"><label for="s-${key}">${label}</label>
    <input id="s-${key}" value="${esc(typeof s[key] === "string" ? s[key] : JSON.stringify(s[key]))}">
    <span class="hint">${esc(cfg.descriptions[key] || "")}</span></div>`;
  const purposeRows = state.purposes.map(p => `<tr><td>${esc(p.label)}</td>
    <td>${p.active ? "Active" : "Inactive"}</td><td>${esc(p.default_for_category || "—")}</td>
    <td><button class="btn small" data-purp-del="${p.id}" type="button">Delete</button></td></tr>`).join("");
  main.innerHTML = `
    <form id="settings-form">
      <section class="panel"><h3>Recognition &amp; logging</h3><div class="grid2">
        ${num("accept_threshold", "Accept threshold (0.50–0.99)")}
        ${num("review_threshold", "Review threshold (below accept)")}
        ${num("duplicate_window_seconds", "Duplicate window, seconds (5–600)", "1")}
        ${num("review_escalation_minutes", "Review escalation, minutes (1–240)", "1")}
        ${num("class_confidence_review", "Class confidence review floor")}
      </div></section>
      <section class="panel"><h3>Retention &amp; site</h3><div class="grid2">
        ${num("image_retention_days", "Image retention, days", "1")}
        ${num("record_retention_years", "Record retention, years", "1")}
        ${text("site_timezone", "Site time zone")}
        ${num("ntp_port", "NTP port", "1")}
      </div>
      <div class="field"><label for="s-notice_text">Notice text (Sign In screen and reports)</label>
        <textarea id="s-notice_text" rows="2">${esc(s.notice_text || "")}</textarea></div></section>
      <section class="panel"><h3>Alert channels</h3><div class="grid2">
        ${text("smtp_server", "SMTP server (blank = email off)")}
        ${text("sms_gateway", "SMS gateway URL (blank = SMS off)")}
        ${text("webhook_url", "Webhook URL (blank = webhooks off)")}
        ${text("webhook_secret", "Webhook HMAC secret")}
      </div>
      <div class="field"><label for="s-alert_channels">Channels per severity (JSON)</label>
        <textarea id="s-alert_channels" class="mono" rows="3">${esc(JSON.stringify(s.alert_channels, null, 1))}</textarea></div>
      <div class="field"><label for="s-overstay_limits">Overstay limits in hours per category (JSON)</label>
        <textarea id="s-overstay_limits" class="mono" rows="3">${esc(JSON.stringify(s.overstay_limits, null, 1))}</textarea></div></section>
      <p id="s-error" class="error" role="alert" hidden></p>
      <button class="btn primary" type="submit">Save Settings</button>
      <span class="muted small">Changes apply within a minute, without a restart, and are audited.</span>
    </form>
    <section class="panel"><h3>Purpose of Visit list</h3>
      <table><thead><tr><th>Label</th><th>State</th><th>Default for category</th><th></th></tr></thead>
      <tbody>${purposeRows}</tbody></table>
      <form id="purpose-add" class="filters" style="margin-top:12px">
        <div class="field"><label for="pa-label">New purpose</label><input id="pa-label" required></div>
        <div class="field"><label for="pa-cat">Default for category</label><select id="pa-cat">
          <option value="">—</option>${CATEGORIES.map(c => `<option>${c}</option>`).join("")}</select></div>
        <button class="btn" type="submit">Add Purpose</button></form></section>
    <section class="panel"><h3>Plate formats</h3>
      <table><thead><tr><th>Region</th><th>Pattern</th><th>Example</th><th>Active</th></tr></thead>
      <tbody>${formats.formats.map(f => `<tr><td>${esc(f.region)}</td><td class="mono small">${esc(f.regex)}</td><td class="plate">${esc(f.example)}</td><td>${f.active ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table>
      <form id="format-add" class="filters" style="margin-top:12px">
        <div class="field"><label for="fa-region">Region</label><input id="fa-region" required></div>
        <div class="field"><label for="fa-regex">Pattern (regex)</label><input id="fa-regex" class="mono" required></div>
        <div class="field"><label for="fa-example">Example</label><input id="fa-example" class="mono"></div>
        <button class="btn" type="submit">Add Format</button></form></section>
    <section class="panel"><h3>Maintenance</h3>
      <div class="kbd-row">
        <button class="btn" id="run-jobs" type="button">Run periodic jobs now</button>
        <button class="btn" id="export-config" type="button">Export configuration (JSON)</button>
      </div><p id="jobs-out" aria-live="polite" class="muted"></p></section>`;
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#s-error"); err.hidden = true;
    const numeric = ["accept_threshold", "review_threshold", "duplicate_window_seconds",
      "review_escalation_minutes", "class_confidence_review", "image_retention_days",
      "record_retention_years", "ntp_port"];
    const textual = ["site_timezone", "notice_text", "smtp_server", "sms_gateway",
      "webhook_url", "webhook_secret"];
    try {
      for (const k of numeric) {
        await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: Number($(`#s-${k}`).value) }) });
      }
      for (const k of textual) {
        await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: $(`#s-${k}`).value }) });
      }
      for (const k of ["alert_channels", "overstay_limits"]) {
        await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: JSON.parse($(`#s-${k}`).value) }) });
      }
      toast("Settings saved.");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $("#purpose-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiJson("/purposes", { method: "POST", body: JSON.stringify({
      label: $("#pa-label").value, active: true,
      default_for_category: $("#pa-cat").value || null }) }).catch(err => toast(err.message, true));
    state.purposes = (await apiJson("/purposes")).purposes;
    toast("Purpose added."); route();
  });
  $$("button[data-purp-del]", main).forEach(b => b.addEventListener("click", async () => {
    await apiJson(`/purposes/${b.dataset.purpDel}`, { method: "DELETE" }).catch(e => toast(e.message, true));
    state.purposes = (await apiJson("/purposes")).purposes;
    route();
  }));
  $("#format-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiJson("/plate-formats", { method: "POST", body: JSON.stringify({
        region: $("#fa-region").value, regex: $("#fa-regex").value,
        example: $("#fa-example").value, active: true }) });
      toast("Plate format added."); route();
    } catch (ex) { toast(ex.message, true); }
  });
  $("#run-jobs").addEventListener("click", async () => {
    const r = await apiJson("/admin/run-jobs", { method: "POST" }).catch(e => ({ error: e.message }));
    $("#jobs-out").textContent = r.error || `Done: ${JSON.stringify(r)}`;
  });
  $("#export-config").addEventListener("click", async () => {
    const r = await apiJson("/config/export");
    downloadBlob(new Blob([JSON.stringify(r.settings, null, 2)], { type: "application/json" }), "nprs-config.json");
  });
};

/* ---------------- Data Protection ---------------- */
VIEWS.data = async (main) => {
  main.innerHTML = `
    <section class="panel"><h3>Legal hold</h3>
      <p class="muted">Events under a legal hold are excluded from retention purges. Place a hold from an event's detail view; release it here when the matter closes.</p>
      <form id="hold-release" class="filters">
        <div class="field"><label for="h-id">Hold ID to release</label><input id="h-id" class="mono"></div>
        <button class="btn" type="submit">Release Hold</button></form>
      <p id="hold-out" aria-live="polite"></p></section>
    ${has("privacy.manage") ? `
    <section class="panel"><h3>Personal data — export</h3>
      <form id="privacy-export" class="filters">
        <div class="field"><label for="pe-plate">Plate</label><input id="pe-plate" class="mono"></div>
        <div class="field"><label for="pe-owner">Owner name contains</label><input id="pe-owner"></div>
        <button class="btn" type="submit">Export Data (JSON)</button></form></section>
    <section class="panel"><h3>Personal data — erasure</h3>
      <p class="muted">Erasure removes the owner's name, contact and organisation from the registry record and clears visitor details on their events. The events themselves remain, anonymised.</p>
      <form id="privacy-erase" class="filters">
        <div class="field"><label for="px-id">Registry record ID</label><input id="px-id" class="mono"></div>
        <button class="btn danger" type="submit">Erase Personal Data</button></form>
      <p id="erase-out" aria-live="polite"></p></section>` : ""}
    ${has("config.manage") ? `
    <section class="panel"><h3>Retention purge</h3>
      <p class="muted">Runs the daily purge now: images past the image retention period and records past the record retention period are removed, except anything under a legal hold. The purge is audited.</p>
      <button class="btn danger" id="run-retention" type="button">Run Retention Purge Now</button>
      <p id="retention-out" aria-live="polite"></p></section>` : ""}`;
  $("#hold-release").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#h-id").value.trim();
    if (!id) return;
    try {
      await apiJson(`/legal-holds/${id}`, { method: "DELETE" });
      $("#hold-out").textContent = "Hold released.";
    } catch (ex) { $("#hold-out").innerHTML = `<span class="error">${esc(ex.message)}</span>`; }
  });
  const pe = $("#privacy-export");
  if (pe) pe.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await apiJson("/privacy/export", { method: "POST", body: JSON.stringify({
      plate: $("#pe-plate").value, owner_name: $("#pe-owner").value }) });
    downloadBlob(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }), "personal-data-export.json");
    toast("Export downloaded. The export itself is recorded in the audit log.");
  });
  const px = $("#privacy-erase");
  if (px) px.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm("Erase this person's personal data? Events remain, anonymised. This is audited.")) return;
    try {
      const r = await apiJson("/privacy/erase", { method: "POST", body: JSON.stringify({ vehicle_id: $("#px-id").value.trim() }) });
      $("#erase-out").textContent = r.note;
    } catch (ex) { $("#erase-out").innerHTML = `<span class="error">${esc(ex.message)}</span>`; }
  });
  const rr = $("#run-retention");
  if (rr) rr.addEventListener("click", async () => {
    const r = await apiJson("/admin/run-retention", { method: "POST" }).catch(e => ({ error: e.message }));
    $("#retention-out").textContent = r.error || `Purged ${r.images_purged} images and ${r.events_purged} event records.`;
  });
};

/* ---------------- boot ---------------- */
(async function boot() {
  if (state.access && state.refresh) {
    try {
      state.user = await apiJson("/auth/me");
      state.cameras = (await apiJson("/cameras").catch(() => ({ cameras: [] }))).cameras;
      state.purposes = (await apiJson("/purposes").catch(() => ({ purposes: [] }))).purposes;
      showApp();
      return;
    } catch { /* fall through to sign-in */ }
  }
  showLogin();
})();
