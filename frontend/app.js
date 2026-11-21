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
  currentEventId: null,
  currentTaskId: null,
  vehicleEdit: undefined,   // undefined = closed, null = add, object = edit/view
  cameraEdit: undefined,
  liveCameraId: null,
  importPreview: null,
  reportType: null,
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
function fmtDateShort(ts) {
  const d = parseTs(ts);
  if (!d || isNaN(d)) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}
function fmtDayTime(ts) {
  const d = parseTs(ts);
  if (!d || isNaN(d)) return "Never";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  if (sameDay) return `Today ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  return `${fmtDateShort(ts)} ${time}`;
}
function fmtHeadClock(d) {
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} · ${time}`;
}
function dwellText(seconds) {
  if (seconds == null) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min`;
}
function classTitle(c) {
  if (!c) return "—";
  return c.charAt(0).toUpperCase() + c.slice(1);
}
function typeWord(ev) { return ev.event_type === "Exit" ? "EXIT ↑" : "ENTRY ↓"; }
function evtCode(ev) { return "EVT-" + String(ev.id || "").slice(0, 8).toUpperCase(); }
function confText(v) { return v == null ? "—" : Number(v).toFixed(2); }
function confClass(v) {
  if (v == null) return "";
  return v >= 0.85 ? "conf-good" : v >= 0.5 ? "conf-mid" : "conf-bad";
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
function go(key) {
  if (location.hash === "#/" + key) route();
  else location.hash = "#/" + key;
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function loadImg(imgEl, url) {
  try {
    const res = await api(url);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    imgEl.src = URL.createObjectURL(blob);
  } catch { imgEl.alt = "Image not available"; }
}

/* ---------------- status model (design: icon + word) ---------------- */
function evStatus(ev) {
  if (ev.plate_status === "UNREADABLE") return { key: "unreadable", icon: "✕", label: "UNREADABLE" };
  if (ev.plate_status === "Needs Review") return { key: "review", icon: "◐", label: "REVIEW" };
  if (ev.status === "Known") return { key: "known", icon: "✓", label: "KNOWN" };
  return { key: "unknown", icon: "!", label: "UNKNOWN" };
}
function pill(ev) {
  const s = evStatus(ev);
  return `<span class="pill ${s.key}">${s.icon} ${s.label}</span>`;
}
function plateText(ev) {
  if (ev.plate_status === "UNREADABLE") return "UNREADABLE";
  return ev.plate_display || ev.plate_normalised || "UNKNOWN";
}
function feedMeta(ev) {
  const parts = [typeWord(ev), esc(ev.gate || ""), classTitle(ev.vehicle_class), fmtTime(ev.ts)];
  let meta = parts.join(" · ");
  const extras = [];
  if (ev.purpose) extras.push(`Purpose: ${esc(ev.purpose)}`);
  if (ev.candidates && ev.candidates.length) extras.push("Candidate match attached");
  if (ev.plate_status === "No Plate Detected") extras.push("No plate detected");
  if (ev.plate_status === "UNREADABLE") extras.push("Plate could not be read");
  if (ev.status === "UNKNOWN" && ev.plate_raw) extras.push(`Plate: ${esc(ev.plate_raw)}`);
  if (ev.flags && ev.flags.length) extras.push(esc(ev.flags.join(", ")) + " flag" + (ev.flags.length > 1 ? "s" : ""));
  if (ev.manual) extras.push("Manual event");
  if (extras.length) meta += " · " + extras.join(" · ");
  return meta;
}
function feedRow(ev) {
  const s = evStatus(ev);
  const img = (ev.images || []).find(i => i.kind === "full") || (ev.images || [])[0];
  return `<button type="button" class="feed-row" data-event="${ev.id}">
    ${img ? `<img class="feed-thumb" data-img="${ev.id}/${img.id}" alt="">` : `<span class="feed-thumb" aria-hidden="true"></span>`}
    <span class="feed-main">
      <span class="feed-plate">${esc(plateText(ev))}</span><br>
      <span class="feed-meta">${feedMeta(ev)}</span>
    </span>
    ${pill(ev)}
    <span class="feed-conf ${confClass(ev.confidence)}">${confText(ev.confidence)}</span>
  </button>`;
}
function wireFeed(root) {
  $$("img[data-img]", root).forEach(img => {
    const [eid, iid] = img.dataset.img.split("/");
    loadImg(img, `/events/${eid}/images/${iid}`);
  });
  $$("[data-event]", root).forEach(el => el.addEventListener("click", () => {
    state.currentEventId = el.dataset.event;
    go("event");
  }));
}

/* ---------------- modals ---------------- */
function closeModal() { $("#modal-root").innerHTML = ""; }
function askReason({ title, sub, label, placeholder = "", hint = "", confirmText, danger = false }) {
  return new Promise(resolve => {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="ask-title">
      <h3 id="ask-title">${esc(title)}</h3>
      ${sub ? `<p class="m-sub">${esc(sub)}</p>` : ""}
      <form id="ask-form">
        <div class="field"><label for="ask-input">${esc(label)}</label>
          <input id="ask-input" placeholder="${esc(placeholder)}">
          ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>
        <p id="ask-error" class="error" role="alert" hidden></p>
        <button class="btn ${danger ? "danger" : "blue"} block" type="submit" style="width:100%">${esc(confirmText)}</button>
        <button class="btn outline" type="button" id="ask-cancel" style="width:100%;margin-top:10px">Cancel</button>
      </form></div></div>`;
    $("#ask-input").focus();
    $("#ask-cancel").addEventListener("click", () => { closeModal(); resolve(null); });
    $("#ask-form").addEventListener("submit", e => {
      e.preventDefault();
      const v = $("#ask-input").value.trim();
      if (!v) { const er = $("#ask-error"); er.textContent = "A reason is required."; er.hidden = false; return; }
      closeModal(); resolve(v);
    });
  });
}
function openImageModal(eventId, imageId, caption) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal wide" role="dialog" aria-modal="true" aria-label="Evidence image">
    <img class="big" data-big-img alt="${esc(caption)}">
    <p class="muted">${esc(caption)} — the original can never be edited (FR-CAP-06).</p>
    <button class="btn outline" type="button" id="img-close" style="width:100%">Close</button></div></div>`;
  loadImg($("img[data-big-img]", root), `/events/${eventId}/images/${imageId}`);
  $("#img-close").addEventListener("click", closeModal);
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
  $("#side-user-role").textContent = `${roleName(state.user.role)} · Gate A`;
  buildNav();
  updateCamPill();
  route();
  startClock();
  connectLive();
  refreshBadges();
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
  ["data", "Data Protection", null],
];
const VIEW_PERM = {
  dashboard: "dashboard.view", live: "live.view", events: "event.read", event: "event.read",
  review: "review.resolve", reviewdetail: "review.resolve", manual: "event.create_manual",
  inside: "event.read", registry: "registry.read", vehicleform: "registry.read",
  import: "registry.import", cameras: "dashboard.view", camerasetup: "dashboard.view",
  alerts: "dashboard.view", reports: "report.generate", users: "user.manage",
  audit: "audit.view", settings: "config.manage", data: null,
};
const NAV_PARENT = { event: "events", reviewdetail: "review", vehicleform: "registry",
                     import: "registry", camerasetup: "cameras" };
function canOpen(key) {
  if (key === "data") return has("legal.hold") || has("privacy.manage");
  const perm = VIEW_PERM[key];
  return perm ? has(perm) : true;
}
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
    a.dataset.route = key;
    a.innerHTML = `<span class="nav-dot" aria-hidden="true"></span>${esc(label)}` +
      (key === "review" ? `<span class="nav-badge" id="review-badge" hidden></span>` : "");
    nav.appendChild(a);
  }
}
const META = {
  dashboard: { title: "Dashboard", foot: "DASHBOARD · UC-14 · FR-DSH-01…05 · UPDATES BY PUSH WITHIN 3 S" },
  live: { title: "Live Monitor", foot: "LIVE MONITOR · UC-14 · UI-04 · FR-CAM-06 PREVIEW ≤ 3 S DELAY" },
  events: { title: "Event Log", sub: "Every recorded movement — search anything", foot: "EVENT LOG · UC-15 · FR-RPT-01/02 · 50 PER PAGE · ≤ 3 S AT 1M EVENTS" },
  event: { title: "Event", foot: "EVENT DETAIL · UC-15 · FR-RPT-07 · FR-POV-03/05 · FR-LOG-10 VERSIONS" },
  review: { title: "Review Queue", foot: "REVIEW QUEUE · UC-10 · FR-REV-01/02 · ESCALATES AT 15 MIN (FR-REV-05)" },
  reviewdetail: { title: "Review", foot: "REVIEW · UC-10 · UI-05 · FR-REV-03 · FR-REG-04" },
  manual: { title: "New Manual Event", sub: "For camera or recognition outages — the event is flagged Manual and audited", foot: "MANUAL EVENT · UC-11 · FR-REV-06 · FLAGGED MANUAL" },
  inside: { title: "Vehicles Inside", foot: "VEHICLES INSIDE · UC-08 · OPEN VISIT SESSIONS" },
  registry: { title: "Vehicle Registry", foot: "REGISTRY · UC-12 · FR-REG-01/02/07/10 · SOFT DELETE KEEPS HISTORY" },
  vehicleform: { title: "Vehicle", foot: "REGISTRY · UC-12 · FR-REG-01 FIELDS · FR-REG-02 UNIQUE PLATE" },
  import: { title: "Import Vehicles", foot: "IMPORT · UC-13 · FR-REG-08 · UP TO 10,000 ROWS · VALID ROWS ONLY" },
  cameras: { title: "Cameras", sub: "System Administrator only · changes never interrupt other cameras (FR-CAM-07)", foot: "CAMERAS · UC-20 · FR-CAM-03/04/05/07 · OFFLINE AFTER 10 S, ALERT IN 15 S" },
  camerasetup: { title: "Camera Setup", foot: "CAMERA SETUP · UC-20 · FR-CAM-03 · APPENDIX A.4 INSTALLATION PARAMETERS" },
  alerts: { title: "Alerts", sub: "Critical alerts repeat every 5 minutes until acknowledged (FR-ALR-04)", foot: "ALERTS · UC-17 · FR-ALR-01…05 · IN-APP ≤ 5 S" },
  reports: { title: "Reports", sub: "Report Viewer sees reports and events — never images or contact numbers (§5.3)", foot: "REPORTS · UC-16 · FR-RPT-03…06 · EXPORTS ARE AUDITED" },
  users: { title: "Users & Roles", sub: "One person, one role. Two duties means two accounts (§5.4)", foot: "USERS · UC-19 · FR-SEC-05/07/11 · AT LEAST TWO ADMINS ALWAYS" },
  audit: { title: "Audit Log", sub: "Auditor view — read and export only. Nobody can edit an entry, not even an administrator.", foot: "AUDIT · UC-22 · FR-AUD-01…06 · APPEND-ONLY · KEPT ≥ 2 YEARS" },
  settings: { title: "Settings", sub: "Every change is validated, applied within 60 seconds without a restart, and audited (FR-CFG-03)", foot: "SETTINGS · UC-21 · FR-CFG-01…04 · FR-DAT-01/02 · APPLIES ≤ 60 S" },
  data: { title: "Data Protection", sub: "Legal holds and personal-data requests — every action audited", foot: "DATA · UC-23 · FR-DAT-03/06 · LEG-01/02" },
};
function setScreen(key, overrides = {}) {
  const m = { ...(META[key] || {}), ...overrides };
  $("#page-title").textContent = m.title || "Dashboard";
  $("#page-sub").textContent = m.sub || "";
  $("#page-foot").textContent = m.foot || "";
  const parent = NAV_PARENT[key] || key;
  $$("#main-nav a").forEach(a => {
    if (a.dataset.route === parent) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
let currentView = "dashboard";
function route() {
  const key = (location.hash.replace("#/", "") || "dashboard").split("?")[0];
  currentView = key;
  const view = VIEWS[key] || VIEWS.dashboard;
  if (VIEWS[key] && !canOpen(key)) { VIEWS.forbidden($("#main"), key); return; }
  view($("#main"));
  $("#page-title").focus({ preventScroll: true });
}
window.addEventListener("hashchange", () => route());

function startClock() {
  const tick = () => { $("#clock").textContent = fmtHeadClock(new Date()); };
  tick(); setInterval(tick, 15000);
}
function updateCamPill() {
  const pillEl = $("#cam-pill");
  const cam = (state.cameras || []).find(c => c.status === "online") || (state.cameras || [])[0];
  if (!cam) { pillEl.hidden = true; return; }
  const label = cam.name.replace(/ Lane \d+$/, "");
  pillEl.innerHTML = `<span class="dot"></span>${esc(label)} — ${cam.status === "online" ? "Online" : esc(cam.status)}`;
  pillEl.classList.toggle("off", cam.status !== "online");
  pillEl.hidden = false;
}

/* ---------------- live push & badges ---------------- */
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
          refreshBadges();
        }
      } catch {}
    };
    state.ws.onclose = () => setTimeout(connectLive, 5000);
  } catch {}
}
async function refreshBadges() {
  const badge = $("#review-badge");
  if (badge && has("review.resolve")) {
    const data = await apiJson("/review").catch(() => null);
    if (data && data.waiting > 0) { badge.hidden = false; badge.textContent = data.waiting; }
    else badge.hidden = true;
  }
  const cams = await apiJson("/cameras").catch(() => null);
  if (cams) { state.cameras = cams.cameras; updateCamPill(); }
}

/* ================= VIEWS ================= */
const VIEWS = {};

/* ---------------- Forbidden (design: 40 States) ---------------- */
VIEWS.forbidden = (main, key) => {
  const name = (META[key] && META[key].title) || "This screen";
  setScreen(key, { title: name, sub: "Opened by a direct link" });
  main.innerHTML = `<div class="empty-card">
    <div class="ec-icon" aria-hidden="true">⛔</div>
    <h3>You cannot open the ${esc(name)}</h3>
    <p>Your role (${esc(roleName(state.user.role))}) does not include this screen — that separation is
    deliberate (§5.1). This attempt has been written to the audit log, as every refused request is (§5.4).</p>
    <p>If you need something from this screen, ask a colleague whose role includes it.</p>
    <button class="btn blue" id="fb-home" type="button">Go to Dashboard</button>
  </div>`;
  $("#fb-home").addEventListener("click", () => go("dashboard"));
};

/* ---------------- Dashboard ---------------- */
VIEWS.dashboard = async (main) => {
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  setScreen("dashboard", { sub: `${today} · Main Gate` });
  main.innerHTML = `<p class="muted">Loading…</p>`;
  const s = await apiJson("/dashboard/summary").catch(e => ({ error: e.message }));
  if (s.error) { main.innerHTML = `<p class="error">${esc(s.error)}</p>`; return; }
  refreshBadges();
  const feed = await apiJson("/live/events").catch(() => ({ events: [] }));
  const alerts = await apiJson("/alerts?limit=50").catch(() => ({ alerts: [] }));
  const cats = Object.entries(s.inside_by_category);
  const camItems = s.cameras.map(c => `
    <div class="side-item">
      <div class="si-title"><span class="dot ${c.status === "online" ? "on" : c.status === "degraded" ? "deg" : "off"}"></span>${esc(c.name)}</div>
      <div class="si-sub">${c.status === "online" ? "Online" : esc(c.status)} · ${esc(c.gate)} · ${esc(c.lane)}</div>
    </div>`).join("");
  const edgeNodes = [...new Set(s.cameras.map(c => c.edge_node))].map(n => `
    <div class="side-item">
      <div class="si-title"><span class="dot on"></span>${esc(n)}</div>
      <div class="si-sub">Online · ${s.cameras.filter(c => c.edge_node === n).length} camera${s.cameras.filter(c => c.edge_node === n).length === 1 ? "" : "s"} · buffer syncs to the server</div>
    </div>`).join("");
  const alertLines = alerts.alerts.slice(0, 3).map(a => `
    <div class="alert-line ${a.severity === "Critical" ? "crit" : a.severity === "Warning" ? "warn" : ""}">
      ${a.severity === "Critical" ? "⛔" : "●"} ${esc(a.severity.toUpperCase())} — ${esc(a.message)} ${fmtTime(a.created_at)}${a.ack_at ? ` (acknowledged ${fmtTime(a.ack_at)})` : ""}
    </div>`).join("");
  main.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${s.inside_now}</div><div class="lbl">Vehicles inside now</div></div>
      <div class="stat"><div class="num">${s.entries_today}</div><div class="lbl">Entries today</div></div>
      <div class="stat"><div class="num">${s.exits_today}</div><div class="lbl">Exits today</div></div>
      <div class="stat"><div class="num red">${s.unknown_today}</div><div class="lbl">UNKNOWN today</div></div>
      <div class="stat"><div class="num red">${s.reviews_waiting}</div><div class="lbl">Reviews waiting</div></div>
      <div class="stat"><div class="num red">${s.active_alerts}</div><div class="lbl">Active alerts</div></div>
    </div>
    <div class="grid-main-side">
      <section class="panel">
        <h3 class="panel-title">Live event feed</h3>
        <p class="panel-sub">The latest events, newest first — recorded automatically, no operator action (FR-DSH-02)</p>
        <div class="feed" id="dash-feed" aria-live="polite">
          ${feed.events.slice(0, 7).map(feedRow).join("") || '<p class="muted">No events yet. When a vehicle passes a camera, it appears here.</p>'}
        </div>
        <p class="foot-note" style="margin-top:14px">Showing the latest ${Math.min(7, feed.events.length)} of the last 50 · open the Event Log for the full record</p>
      </section>
      <section class="panel">
        <h3 class="panel-title">System status</h3>
        <p class="panel-sub">Cameras and edge nodes (FR-DSH-03)</p>
        <div class="side-list">${camItems}${edgeNodes}
          <div class="side-item">
            <div class="si-title"><span class="dot on"></span>Server link</div>
            <div class="si-sub">Connected · this page updates by push</div>
          </div>
        </div>
        <hr class="hr">
        <h3 class="panel-title" style="font-size:1rem">Inside by category</h3>
        <p class="foot-note">${cats.length ? cats.map(([k, v]) => `${esc(k)} ${v}`).join(" · ") : "No vehicles inside."}</p>
        <hr class="hr">
        <h3 class="panel-title" style="font-size:1rem">Active alerts</h3>
        ${alertLines || '<p class="foot-note">No active alerts.</p>'}
      </section>
    </div>`;
  wireFeed(main);
};

/* ---------------- Live Monitor ---------------- */
VIEWS.live = async (main) => {
  setScreen("live", { sub: "Live preview · events from the selected camera appear within 3 s" });
  main.innerHTML = `<p class="muted">Loading…</p>`;
  if (!state.cameras.length)
    state.cameras = (await apiJson("/cameras").catch(() => ({ cameras: [] }))).cameras;
  if (!state.liveCameraId && state.cameras.length) state.liveCameraId = state.cameras[0].id;
  const cam = state.cameras.find(c => c.id === state.liveCameraId) || state.cameras[0];
  const render = async () => {
    const data = await apiJson("/live/events").catch(() => ({ events: [] }));
    if (currentView !== "live") return;
    const camEvents = cam ? data.events.filter(e => e.camera_id === cam.id) : [];
    const latest = camEvents[0];
    const fullImg = latest && (latest.images || []).find(i => i.kind === "full");
    let roiBox = "", vline = "";
    if (cam) {
      try {
        const roi = JSON.parse(cam.roi || "[]");
        if (Array.isArray(roi) && roi.length >= 2) {
          const xs = roi.map(p => p[0] / 10), ys = roi.map(p => p[1] / 10);
          const l = Math.min(...xs), t = Math.min(...ys);
          roiBox = `<div class="roi-box" style="left:${l}%;top:${t}%;width:${Math.max(...xs) - l}%;height:${Math.max(...ys) - t}%"><span class="roi-label">REGION OF INTEREST</span></div>`;
        }
      } catch {}
      try {
        const vl = JSON.parse(cam.virtual_line || "{}");
        if (vl && vl.y1 != null && vl.y1 === vl.y2)
          vline = `<div class="vline" style="top:${vl.y1 / 10}%"></div>`;
      } catch {}
    }
    main.innerHTML = `
    <div class="grid-main-side">
      <div class="scene">
        <div class="scene-head">
          <span>● LIVE — ${esc(cam ? cam.name : "No camera")}</span>
          <span class="sh-right">Preview — latest captured frame (FR-CAM-06)</span>
        </div>
        <div class="scene-frame">
          ${fullImg ? `<img class="scene-img" data-scene-img alt="Latest captured frame from ${esc(cam.name)}">` : `<div class="scene-empty">Waiting for the next vehicle at this camera…</div>`}
          ${roiBox}${vline}
          ${latest ? `<div class="scene-chip">${esc(classTitle(latest.vehicle_class).toUpperCase())} · ${esc(plateText(latest))} · ${confText(latest.confidence)}</div>
          <div class="scene-plate">${esc(plateText(latest))}</div>` : ""}
        </div>
        <p class="scene-cap">— Virtual line (crossing triggers capture) · shaded area = region of interest</p>
      </div>
      <section class="panel">
        <h3 class="panel-title">Happening now</h3>
        <p class="panel-sub">Events from this camera appear here within 3 s (FR-LOG-11)</p>
        <div id="live-now">
          ${camEvents.slice(0, 5).map(ev => `
            <button type="button" class="mini-row" data-event="${ev.id}">
              ${(ev.images || []).find(i => i.kind === "full") ? `<img class="feed-thumb" data-img="${ev.id}/${ev.images.find(i => i.kind === "full").id}" alt="">` : `<span class="feed-thumb" aria-hidden="true"></span>`}
              <span class="feed-main"><span class="feed-plate">${esc(plateText(ev))}</span>
              <span class="feed-meta">${feedMeta(ev)}</span></span>
            </button>`).join("") || '<p class="muted">No events from this camera yet.</p>'}
        </div>
        <h3 class="panel-title" style="font-size:1rem;margin-top:18px">Cameras</h3>
        ${state.cameras.map(c => `
          <button type="button" class="cam-link" data-cam="${c.id}">
            <span class="dot ${c.status === "online" ? "on" : c.status === "degraded" ? "deg" : "off"}"></span>${esc(c.name)}${c.id === state.liveCameraId ? " (watching)" : ""}${c.status !== "online" ? ` (${esc(c.status)})` : ""}
          </button>`).join("")}
        <p class="foot-note" style="margin-top:14px">A role without the live-monitor permission never sees this screen — it is removed from their menu, and the server refuses the stream (UI-02, §5.3).</p>
      </section>
    </div>`;
    const sceneImg = $("img[data-scene-img]", main);
    if (sceneImg && latest && fullImg) loadImg(sceneImg, `/events/${latest.id}/images/${fullImg.id}`);
    wireFeed(main);
    $$("button[data-cam]", main).forEach(b => b.addEventListener("click", () => {
      state.liveCameraId = b.dataset.cam;
      route();
    }));
  };
  await render();
  const timer = setInterval(() => { if (currentView !== "live") clearInterval(timer); else render(); }, 5000);
};

/* ---------------- Event Log ---------------- */
function eventLogTable(events) {
  if (!events.length) return `<div class="panel"><h3 class="panel-title">No events match</h3>
    <p class="panel-sub">The filters stay in place — widen the dates or clear a filter to see more (UC-15 E1).</p></div>`;
  const rows = events.map(ev => {
    const s = evStatus(ev);
    const statusExtra = (ev.flags || []).length ? ` · ${esc(ev.flags.join(", "))} flag` : "";
    return `<tr class="clickable ${s.key === "unknown" || s.key === "unreadable" ? "row-unknown" : s.key === "review" ? "row-review" : ""}" data-event="${ev.id}" tabindex="0">
      <td class="t-bold">${fmtTime(ev.ts)}</td>
      <td class="plate">${esc(plateText(ev))}</td>
      <td style="white-space:nowrap">${typeWord(ev)}</td>
      <td><span class="status-word ${s.key}">${s.icon} ${s.label}</span>${statusExtra}</td>
      <td>${esc(classTitle(ev.vehicle_class))}</td>
      <td>${esc(ev.camera_name)}</td>
      <td>${esc(ev.purpose || "—")}</td>
      <td class="${confClass(ev.confidence)}" style="font-weight:700">${confText(ev.confidence)}</td></tr>`;
  }).join("");
  return `<table class="tbl"><thead><tr><th>Time</th><th>Plate</th><th>Type</th><th>Status</th>
    <th>Class</th><th>Camera</th><th>Purpose</th><th>Conf.</th></tr></thead><tbody>${rows}</tbody></table>`;
}
VIEWS.events = async (main) => {
  setScreen("events");
  const camOpts = state.cameras.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const catOpts = CATEGORIES.map(c => `<option>${c}</option>`).join("");
  main.innerHTML = `
    <form id="event-filters" class="filter-panel">
      <div class="filter-row">
        <div class="field"><label for="f-q">Plate (full or part)</label><input id="f-q" class="mono"></div>
        <div class="field"><label for="f-from">From</label><input id="f-from" type="datetime-local"></div>
        <div class="field"><label for="f-to">To</label><input id="f-to" type="datetime-local"></div>
        <div class="field"><label for="f-type">Type</label><select id="f-type">
          <option value="">All</option><option>Entry</option><option>Exit</option></select></div>
        <button class="btn blue" type="submit" style="min-width:150px">Search</button>
      </div>
      <div class="filter-row2">
        <span class="mini-field">Status: <select id="f-status"><option value="">All</option><option>Known</option><option>UNKNOWN</option></select></span>
        <span class="mini-field">Plate: <select id="f-plate-status"><option value="">All</option><option>Accepted</option><option>Needs Review</option><option>UNREADABLE</option><option>No Plate Detected</option></select></span>
        <span class="mini-field">Camera: <select id="f-camera"><option value="">All</option>${camOpts}</select></span>
        <span class="mini-field">Category: <select id="f-category"><option value="">All</option>${catOpts}</select></span>
        <span class="mini-field">Purpose: <input id="f-purpose" size="10"></span>
        <span class="mini-field">Flag: <input id="f-flag" size="12" placeholder="e.g. Type Mismatch"></span>
        <span class="foot-note" style="margin-left:auto">Filters stay in place when nothing matches (UC-15 E1).</span>
      </div>
    </form>
    <div id="event-results"><p class="muted">Loading…</p></div>
    <p style="color:var(--critical);font-weight:700;margin:16px 0 0">UNKNOWN is printed in every list, report and export — never only implied by a colour (FR-LOG-13).</p>
    <div class="pager">
      <span id="ev-page" class="foot-note" aria-live="polite"></span>
      <span>
        <button class="btn outline" id="ev-prev" type="button">‹ Previous</button>
        <button class="btn outline" id="ev-next" type="button">Next ›</button>
      </span>
    </div>
    ${has("event.create_manual") ? `<div class="kbd-row" style="margin-top:22px">
      <button class="btn navy" id="ev-manual" type="button">+ New manual event</button>
      <span class="foot-note">Manual events are for outages — they are flagged Manual and audited (FR-REV-06).</span></div>` : ""}`;
  let page = 1, totalPages = 1;
  const load = async () => {
    const params = new URLSearchParams({ page });
    const set = (id, key) => { const v = $(id).value.trim(); if (v) params.set(key, v); };
    set("#f-q", "q"); set("#f-type", "type"); set("#f-status", "status");
    set("#f-plate-status", "plate_status"); set("#f-camera", "camera_id");
    set("#f-category", "category"); set("#f-purpose", "purpose"); set("#f-flag", "flag");
    const from = $("#f-from").value, to = $("#f-to").value;
    if (from) params.set("date_from", new Date(from).toISOString());
    if (to) params.set("date_to", new Date(to).toISOString());
    const data = await apiJson("/events?" + params.toString()).catch(e => ({ error: e.message }));
    const el = $("#event-results");
    if (data.error) { el.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    totalPages = Math.max(1, Math.ceil(data.total / 50));
    el.innerHTML = eventLogTable(data.events);
    $$("tr[data-event]", el).forEach(tr => {
      const open = () => { state.currentEventId = tr.dataset.event; go("event"); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    });
    $("#ev-page").textContent = `Page ${data.page} of ${totalPages} · 50 per page · ${data.total} event${data.total === 1 ? "" : "s"} match`;
    $("#ev-prev").disabled = page <= 1;
    $("#ev-next").disabled = page >= totalPages;
  };
  $("#event-filters").addEventListener("submit", e => { e.preventDefault(); page = 1; load(); });
  $("#ev-prev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
  $("#ev-next").addEventListener("click", () => { if (page < totalPages) { page++; load(); } });
  const manBtn = $("#ev-manual");
  if (manBtn) manBtn.addEventListener("click", () => go("manual"));
  await load();
};

/* ---------------- Event Detail (design: full screen) ---------------- */
function evidencePanel(ev, note) {
  const full = (ev.images || []).find(i => i.kind === "full");
  const crop = (ev.images || []).find(i => i.kind === "plate");
  const s = evStatus(ev);
  return `<section class="panel">
    <h3 class="panel-title">Evidence images</h3>
    <p class="panel-sub">${esc(note)}</p>
    ${has("event.image") ? `
    ${full ? `<div class="evidence-full">
      <img data-ev-full alt="Full vehicle image from ${esc(ev.camera_name)}">
      <span class="evidence-cap">Full vehicle image · ${esc(ev.camera_name)} · ${fmtDateTime(ev.ts)}</span>
    </div>` : '<p class="muted">No full image stored for this event.</p>'}
    <div class="plate-row">
      <div class="plate-card">${crop ? `<img data-ev-crop alt="Plate crop">` : `<span class="pc-text">${esc(plateText(ev))}</span>`}</div>
      <div class="plate-side">Plate crop · confidence ${confText(ev.confidence)} (${esc(ev.plate_status)})<br>
      Zoom: click either image. The originals can never be edited (FR-CAP-06).</div>
    </div>` : `<p class="muted">Your role cannot view evidence images.</p>`}
  </section>`;
}
function wireEvidence(root, ev) {
  const full = (ev.images || []).find(i => i.kind === "full");
  const crop = (ev.images || []).find(i => i.kind === "plate");
  const f = $("img[data-ev-full]", root);
  if (f && full) { loadImg(f, `/events/${ev.id}/images/${full.id}`);
    f.style.cursor = "zoom-in";
    f.addEventListener("click", () => openImageModal(ev.id, full.id, `Full vehicle image · ${ev.camera_name} · ${fmtDateTime(ev.ts)}`)); }
  const c = $("img[data-ev-crop]", root);
  if (c && crop) { loadImg(c, `/events/${ev.id}/images/${crop.id}`);
    c.style.cursor = "zoom-in";
    c.addEventListener("click", () => openImageModal(ev.id, crop.id, `Plate crop · ${plateText(ev)}`)); }
}
VIEWS.event = async (main) => {
  const id = state.currentEventId;
  if (!id) { go("events"); return; }
  setScreen("event", { title: "Event", sub: "Event Log" });
  main.innerHTML = `<p class="muted">Loading…</p>`;
  const ev = await apiJson(`/events/${id}`).catch(e => ({ error: e.message }));
  if (ev.error) { main.innerHTML = `<p class="error">${esc(ev.error)}</p>`; return; }
  const s = evStatus(ev);
  const versions = [...(ev.history || [])].sort((a, b) => a.version - b.version);
  const maxVersion = Math.max(ev.version, ...versions.map(v => v.version));
  setScreen("event", {
    title: `Event — ${plateText(ev)}`,
    sub: `Event Log › ${evtCode(ev)} · Version ${ev.version} of ${maxVersion}${ev.status === "UNKNOWN" ? " · UNKNOWN entry" : ""}`,
    foot: ev.status === "UNKNOWN"
      ? "EVENT DETAIL · UC-07 · FR-LOG-03 · FR-POV-04 OPTIONAL VISITOR FIELDS"
      : "EVENT DETAIL · UC-15 · FR-RPT-07 · FR-POV-03/05 · FR-LOG-10 VERSIONS",
  });
  let banner;
  if (s.key === "known") {
    const v = ev.vehicle || {};
    const vehicleDesc = [v.make, v.model].filter(Boolean).join(" ") + (v.colour ? ` (${v.colour})` : "");
    banner = `<div class="banner known"><div class="b-icon">✓</div><div>
      <div class="b-title">✓ KNOWN VEHICLE — ${typeWord(ev)} RECORDED ${ev.manual ? "MANUALLY" : "AUTOMATICALLY"}</div>
      <div class="b-sub">${esc(v.owner_name || "—")} · ${esc(v.category || "—")} · ${esc(classTitle(ev.vehicle_class))}${vehicleDesc.trim() ? ` · ${esc(vehicleDesc)}` : ""}</div></div></div>`;
  } else if (s.key === "review") {
    banner = `<div class="banner review"><div class="b-icon">◐</div><div>
      <div class="b-title">◐ NEEDS REVIEW — WAITING IN THE REVIEW QUEUE</div>
      <div class="b-sub">${typeWord(ev)} · ${esc(classTitle(ev.vehicle_class))} · ${esc(ev.gate)} · ${fmtTime(ev.ts)} · the provisional record is already stored (FR-REV-07)</div></div></div>`;
  } else {
    banner = `<div class="banner unknown"><div class="b-icon">!</div><div>
      <div class="b-title">! UNKNOWN VEHICLE — NOT IN THE REGISTRY</div>
      <div class="b-sub">Plate read as ${esc(ev.plate_raw || "—")} · ${esc(classTitle(ev.vehicle_class))} · ${esc(ev.gate)} · ${fmtTime(ev.ts)}</div></div></div>`;
  }
  const sess = ev.session;
  const sessText = !sess ? "—"
    : sess.state === "open" ? `OPEN — entered ${fmtTime(sess.entry_ts)} · inside now`
    : `CLOSED — dwell ${dwellText(sess.dwell_seconds)}`;
  const mismatch = (ev.flags || []).includes("Type Mismatch");
  const detailsPanel = `<section class="panel">
    <h3 class="panel-title">Event details</h3>
    <p class="panel-sub">Times in site time zone; stored in UTC (FR-LOG-05)</p>
    <dl class="defs">
      <dt>Event type</dt><dd>${typeWord(ev)} — ${esc(ev.gate)}, ${esc(ev.camera_name)}</dd>
      <dt>Time</dt><dd>${fmtDateTime(ev.ts)}</dd>
      <dt>Plate (normalised)</dt><dd><span class="plate">${esc(ev.plate_normalised || "—")}</span> · raw: "${esc(ev.plate_raw || "—")}"</dd>
      <dt>Vehicle class</dt><dd>${esc(classTitle(ev.vehicle_class))}${ev.vehicle ? (mismatch ? " (differs from the registered type — flagged)" : " (matches registered type)") : ""}</dd>
      <dt>Recognition</dt><dd>Confidence ${confText(ev.confidence)} · Model ${esc(ev.model_version || "—")}</dd>
      <dt>Visit session</dt><dd>${sessText}</dd>
      ${(ev.flags || []).length ? `<dt>Flags</dt><dd>${esc(ev.flags.join(", "))}</dd>` : ""}
      ${ev.manual ? `<dt>Source</dt><dd>Manual event — flagged and audited (FR-REV-06)</dd>` : ""}
    </dl>
    ${s.key === "known" && has("purpose.edit") ? `
    <hr class="hr">
    <form id="purpose-form">
      <div class="field"><label for="p-purpose">Purpose of visit · Optional</label>
        <input id="p-purpose" list="purpose-list" maxlength="250" value="${esc(ev.purpose || "")}">
        <datalist id="purpose-list">${state.purposes.filter(p => p.active).map(p => `<option>${esc(p.label)}</option>`).join("")}</datalist>
        <span class="hint">Prefilled from the category default where one is set (FR-POV-07). Changing it is audited with the old value.</span></div>
      <button class="btn blue" type="submit">Save purpose</button>
    </form>` : ""}
    ${s.key === "known" && !has("purpose.edit") && ev.purpose ? `<hr class="hr"><p><strong>Purpose of visit:</strong> ${esc(ev.purpose)}</p>` : ""}
  </section>`;
  const visitorPanel = `<section class="panel">
    <h3 class="panel-title">Visitor details — all optional (FR-POV-04)</h3>
    <p class="panel-sub">For unknown vehicles only. Leaving everything empty is a valid, complete record.</p>
    ${has("purpose.edit") ? `
    <form id="purpose-form">
      <div class="field"><label for="p-purpose">Purpose of visit · Optional</label>
        <input id="p-purpose" list="purpose-list" maxlength="250" value="${esc(ev.purpose || "")}" placeholder="Type or choose from the list">
        <datalist id="purpose-list">${state.purposes.filter(p => p.active).map(p => `<option>${esc(p.label)}</option>`).join("")}</datalist></div>
      <div class="field"><label for="p-visitor">Visitor name · Optional</label>
        <input id="p-visitor" value="${esc(ev.visitor_name || "")}" placeholder="Type the visitor name"></div>
      <div class="grid2">
        <div class="field"><label for="p-contact">Contact number · Optional</label>
          <input id="p-contact" value="${esc(ev.visitor_contact || "")}" placeholder="03xx-xxxxxxx"></div>
        <div class="field"><label for="p-person">Person visited · Optional</label>
          <input id="p-person" value="${esc(ev.person_visited || "")}" placeholder="Name or office"></div>
      </div>
      <button class="btn blue" type="submit">Save details</button>
    </form>` : `<p class="muted">Your role cannot add visitor details.</p>`}
  </section>`;
  const histLines = versions.map(h => `
    <p class="foot-note">v${h.version} · ${fmtTime(h.ts)} — ${h.version === ev.version ? "Current version." : "Superseded by a correction."} Plate read as ${esc(h.plate_raw || h.plate_normalised || "—")}.</p>`).join("");
  main.innerHTML = `
    ${banner}
    <div class="grid2">
      ${evidencePanel(ev, "Stored with SHA-256 hashes — view is audited (FR-CAP-05, FR-DAT-08)")}
      ${s.key === "unknown" ? visitorPanel : detailsPanel}
    </div>
    ${s.key === "unknown" ? `
    <div class="info-panel"><div class="ip-title">What happens next</div>
      <p>Nothing is required. The exit will be matched to this entry by plate and the dwell time computed (UC-08). If this vehicle should be known, the Registry Manager adds it on the Registry screen — operators never edit the registry (§5.3). Purpose and visitor details copy onto the exit event (FR-POV-05).</p></div>
    <section class="panel">
      <h3 class="panel-title">Event details</h3>
      <p class="panel-sub">Times in site time zone; stored in UTC (FR-LOG-05)</p>
      <dl class="defs">
        <dt>Event type</dt><dd>${typeWord(ev)} — ${esc(ev.gate)}, ${esc(ev.camera_name)}</dd>
        <dt>Time</dt><dd>${fmtDateTime(ev.ts)}</dd>
        <dt>Recognition</dt><dd>Confidence ${confText(ev.confidence)} · Model ${esc(ev.model_version || "—")}</dd>
        <dt>Visit session</dt><dd>${sessText}</dd>
        ${(ev.flags || []).length ? `<dt>Flags</dt><dd>${esc(ev.flags.join(", "))}</dd>` : ""}
      </dl>
    </section>` : `
    <section class="panel">
      <h3 class="panel-title">History &amp; versions</h3>
      <p class="panel-sub">Events are immutable — a correction creates a new linked version, the original stays (FR-LOG-10)</p>
      ${histLines || `<p class="foot-note">v${ev.version} · ${fmtTime(ev.ts)} — Recorded ${ev.manual ? "manually" : "automatically by the recognition pipeline"}. No corrections.</p>`}
      ${has("legal.hold") ? `<div class="kbd-row" style="justify-content:flex-end">
        <button class="btn outline" id="ev-hold" type="button">Place legal hold</button></div>` : ""}
    </section>`}`;
  wireEvidence(main, ev);
  const pf = $("#purpose-form");
  if (pf) pf.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiJson(`/events/${ev.id}/purpose`, { method: "PUT", body: JSON.stringify({
        purpose: $("#p-purpose").value,
        visitor_name: $("#p-visitor") ? $("#p-visitor").value : (ev.visitor_name || ""),
        visitor_contact: $("#p-contact") ? $("#p-contact").value : (ev.visitor_contact || ""),
        person_visited: $("#p-person") ? $("#p-person").value : (ev.person_visited || "") }) });
      toast("Saved.");
      route();
    } catch (ex) { toast(ex.message, true); }
  });
  const holdBtn = $("#ev-hold");
  if (holdBtn) holdBtn.addEventListener("click", async () => {
    const reason = await askReason({
      title: "Place a legal hold?", label: "Reason *",
      sub: "Held events are excluded from the nightly retention purge, whatever their age (FR-DAT-03). The hold is audited.",
      placeholder: "e.g. Incident of 14 Nov — held for the investigation",
      confirmText: "Place hold" });
    if (reason === null) return;
    await apiJson("/legal-holds", { method: "POST", body: JSON.stringify({ event_id: ev.id, reason }) })
      .then(() => toast("Legal hold placed. This event is excluded from retention purges."))
      .catch(e => toast(e.message, true));
  });
};

/* ---------------- Review Queue ---------------- */
function waitingText(createdAt) {
  const mins = Math.max(0, Math.round((Date.now() - parseTs(createdAt).getTime()) / 60000));
  return mins < 1 ? "just now" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
VIEWS.review = async (main) => {
  setScreen("review", { sub: "Loading…" });
  main.innerHTML = `<p class="muted">Loading the queue…</p>`;
  const data = await apiJson("/review").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  setScreen("review", { sub: `${data.waiting} task${data.waiting === 1 ? "" : "s"} waiting · oldest first · records are already stored — review only settles them` });
  refreshBadges();
  const rows = data.tasks.map(t => {
    const ev = t.event;
    const esc_ = t.state === "escalated";
    return `<tr class="clickable" data-task="${t.id}" tabindex="0">
      <td class="t-bold" ${esc_ ? 'style="color:var(--critical)"' : ""}>${waitingText(t.created_at)}${esc_ ? " · escalated" : ""}</td>
      <td class="plate">${esc(ev.plate_raw || "—")}</td>
      <td>${esc(t.reason)}</td>
      <td>${typeWord(ev)} · ${esc(classTitle(ev.vehicle_class))} · ${esc(ev.gate)}</td>
      <td class="${confClass(ev.confidence)}" style="font-weight:700">${confText(ev.confidence)}</td>
      <td><span class="link-btn blue">Review ›</span></td></tr>`;
  }).join("");
  const resolved = (data.resolved_today || []).map(r => `
    <div class="side-item"><div class="si-title" style="font-weight:600">✓ ${fmtTime(r.resolved_at)} — ${esc(r.plate)} ${esc(r.resolution)}${r.resolved_by ? ` <span class="muted">(${esc(r.resolved_by)})</span>` : ""}</div></div>`).join("");
  main.innerHTML = `
    ${data.tasks.length ? `<table class="tbl"><thead><tr><th>Waiting</th><th>Plate (as read)</th><th>Reason</th>
      <th>Event</th><th>Confidence</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="panel"><h3 class="panel-title">Queue is clear</h3>
       <p class="panel-sub">No events are waiting for review. New uncertain readings appear here, oldest first.</p></div>`}
    <div class="info-panel" style="margin-top:20px"><div class="ip-title" style="color:var(--ink)">Why these are here (FR-REV-01)</div>
      <p style="color:var(--ink-muted)">Needs Review readings, Candidate Matches, unreadable plates, doubtful vehicle classes and vehicles with no plate. Everything else never reaches this queue — it is already final. A task left over 15 minutes escalates to the Security Supervisor automatically.</p></div>
    <section class="panel">
      <h3 class="panel-title">Resolved today</h3>
      <p class="panel-sub">Corrections are new versions — originals are never overwritten (FR-REV-04)</p>
      <div class="side-list">${resolved || '<p class="foot-note">Nothing has been resolved yet today.</p>'}</div>
    </section>
    <p class="note-bold">Resolve a task in 3 interactions or fewer (NFR-USA-01): open → compare → decide.</p>`;
  $$("tr[data-task]", main).forEach(tr => {
    const open = () => { state.currentTaskId = tr.dataset.task; go("reviewdetail"); };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
  });
};

/* ---------------- Review Detail (design: UI-05) ---------------- */
VIEWS.reviewdetail = async (main) => {
  const taskId = state.currentTaskId;
  if (!taskId) { go("review"); return; }
  setScreen("reviewdetail", { title: "Review", sub: "Review Queue" });
  main.innerHTML = `<p class="muted">Loading…</p>`;
  const data = await apiJson("/review").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  const idx = data.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) {
    main.innerHTML = `<div class="empty-card"><div class="ec-icon" aria-hidden="true">✓</div>
      <h3>This task has already been resolved</h3>
      <p>Another reviewer settled it first — nothing was overwritten (UC-10 E2).</p>
      <button class="btn blue" onclick="location.hash='#/review'">Back to the queue</button></div>`;
    return;
  }
  const task = data.tasks[idx];
  const ev = task.event;
  setScreen("reviewdetail", {
    title: `Review — ${ev.plate_raw || "No plate"}`,
    sub: `Review Queue › Task ${idx + 1} of ${data.tasks.length} · waiting ${waitingText(task.created_at)}`,
  });
  const hasCandidate = (ev.candidates || []).length > 0;
  const bannerTitle = hasCandidate ? "A CANDIDATE MATCH WAS FOUND"
    : ev.plate_status === "UNREADABLE" ? "THE PLATE COULD NOT BE READ"
    : ev.plate_status === "No Plate Detected" ? "NO PLATE WAS DETECTED"
    : "THE READING NEEDS A DECISION";
  const bandHint = ev.confidence >= 0.85
    ? `Confidence ${confText(ev.confidence)} — in the accepted band, but a Candidate Match always goes to review (FR-REG-04).`
    : ev.confidence >= 0.5
    ? `Confidence ${confText(ev.confidence)} — inside the review band (0.50 – 0.85), so a person decides (FR-OCR-07).`
    : `Confidence ${confText(ev.confidence)} — below 0.50, so the plate counts as unreadable until a person reads the photo.`;
  const candCards = (ev.candidates || []).map(c => `
    <div class="cand-card">
      <div class="cc-tag">CANDIDATE MATCH — DIFFERS BY 1 CHARACTER</div>
      <div class="cc-plate">${esc(c.plate)}</div>
      <p class="foot-note" style="margin:0 0 10px">Registered: ${esc(c.owner_name || "—")} — ${esc(c.category || "—")} · ${esc(classTitle(c.type))}</p>
      <button class="btn blue" data-act="select_candidate" data-plate="${esc(c.plate)}" type="button">Use candidate</button>
    </div>`).join("");
  main.innerHTML = `
    <div class="banner review"><div class="b-icon">◐</div><div>
      <div class="b-title">◐ NEEDS REVIEW — ${bannerTitle}</div>
      <div class="b-sub">${typeWord(ev)} · ${esc(classTitle(ev.vehicle_class))} · ${esc(ev.gate)} · ${fmtTime(ev.ts)} · Provisional record already stored (FR-REV-07)</div></div></div>
    <div class="grid2">
      ${evidencePanel(ev, "Full image and plate crop, as captured").replace("Evidence images", "Evidence — compare before you decide")}
      <section class="panel">
        <h3 class="panel-title">Decide</h3>
        <p class="panel-sub">Correcting creates a new version — the original reading stays (FR-REV-04)</p>
        <div class="field"><label for="rv-plate">Plate text (edit if the photo shows different)</label>
          <input id="rv-plate" class="mono" value="${esc(ev.plate_raw || "")}">
          <span class="hint">${esc(bandHint)}</span></div>
        ${candCards}
        <div class="decide-grid">
          <button class="btn success" data-act="confirm" type="button">✓ Confirm as read</button>
          <button class="btn blue" data-act="correct" type="button">Save correction</button>
          <button class="btn outline" data-act="mark_unknown" type="button">Mark UNKNOWN</button>
          <button class="btn danger" data-act="discard" type="button">Discard event…</button>
        </div>
      </section>
    </div>
    <p class="foot-note">If another reviewer resolves this task first, your save is refused and the result is shown — nothing is overwritten (UC-10 E2).</p>`;
  wireEvidence(main, ev);
  const resolve = async (action, plate) => {
    try {
      await apiJson(`/review/${task.id}/resolve`, { method: "POST", body: JSON.stringify({
        action, plate_text: plate != null ? plate : $("#rv-plate").value, reason: "" }) });
      toast(action === "discard" ? "Event discarded." : "Review saved.");
      go("review");
    } catch (ex) { toast(ex.message, true); }
  };
  $$("button[data-act]", main).forEach(btn => btn.addEventListener("click", async () => {
    const action = btn.dataset.act;
    if (action === "discard") {
      const reason = await askReason({
        title: "Discard this event?",
        sub: "Discarding is only for false triggers — a shadow, a reflection, a detection with no vehicle. The event disappears from lists and reports but stays in the audit trail with your reason (FR-REV-03).",
        label: "Reason *", placeholder: "e.g. Shadow of the barrier arm — no vehicle in the image",
        hint: "Required. “Not a vehicle” alone is not enough — say what it was.",
        confirmText: "Discard event", danger: true });
      if (reason === null) return;
      try {
        await apiJson(`/review/${task.id}/resolve`, { method: "POST", body: JSON.stringify({
          action: "discard", plate_text: $("#rv-plate").value, reason }) });
        toast("Event discarded.");
        go("review");
      } catch (ex) { toast(ex.message, true); }
      return;
    }
    if (action === "select_candidate") resolve("select_candidate", btn.dataset.plate);
    else resolve(action);
  }));
};

/* ---------------- Manual Event ---------------- */
VIEWS.manual = async (main) => {
  setScreen("manual");
  const camOpts = state.cameras.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  main.innerHTML = `
  <div class="grid-main-side">
    <section class="panel">
      <h3 class="panel-title">Vehicle movement recorded by hand</h3>
      <p class="panel-sub">The plate is matched against the registry exactly as an automatic event would be.</p>
      <form id="manual-form">
        <div class="field"><label for="m-plate">Plate number *</label>
          <input id="m-plate" class="mono" required placeholder="Type the plate as seen"></div>
        <div class="grid2">
          <div class="field"><label for="m-type">Event type *</label>
            <select id="m-type"><option>Entry</option><option>Exit</option></select></div>
          <div class="field"><label for="m-camera">Camera / gate *</label>
            <select id="m-camera">${camOpts}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="m-ts">Time</label>
            <input id="m-ts" type="datetime-local" value="${nowLocal}" required>
            <span class="hint">Defaults to now.</span></div>
          <div class="field"><label for="m-class">Vehicle class</label>
            <select id="m-class">${["car","motorcycle","scooter","auto-rickshaw","van","bus","truck","bicycle","other"].map(t => `<option>${t}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="m-reason">Reason for a past time · Required only if the time is in the past</label>
          <input id="m-reason" placeholder="e.g. Camera 1 was offline from 10:55 to 11:01">
          <span class="hint">A future time is rejected outright (UN-30).</span></div>
        <div class="field"><label for="m-purpose">Purpose of visit · Optional</label>
          <input id="m-purpose" maxlength="250" list="purpose-list" placeholder="Type or choose from the list">
          <datalist id="purpose-list">${state.purposes.filter(p => p.active).map(p => `<option>${esc(p.label)}</option>`).join("")}</datalist></div>
        <p id="m-error" class="error" role="alert" hidden></p>
        <div class="kbd-row">
          <button class="btn blue" type="submit" style="min-width:200px">Create event</button>
          <button class="btn outline" type="button" id="m-cancel">Cancel</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <h3 class="panel-title">When to use this</h3>
      <p class="panel-sub">Manual events are the fallback, not the routine (UN-18, UN-39)</p>
      <ul style="margin:0;padding-left:20px;color:var(--ink-muted)">
        <li style="margin-bottom:12px">The camera or edge node is down and a vehicle must pass.</li>
        <li style="margin-bottom:12px">An emergency vehicle passed too fast to capture.</li>
        <li style="margin-bottom:12px">The recognition service reported a fault.</li>
        <li>Never for a vehicle the system already recorded — duplicates are flagged, not merged silently.</li>
      </ul>
    </section>
  </div>`;
  $("#m-cancel").addEventListener("click", () => go("events"));
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
      go("events");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
};

/* ---------------- Vehicles Inside ---------------- */
VIEWS.inside = async (main) => {
  const data = await apiJson("/sessions/inside").catch(e => ({ error: e.message }));
  if (data.error) { setScreen("inside"); main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  setScreen("inside", { sub: `${data.inside.length} vehicle${data.inside.length === 1 ? "" : "s"} inside now · open visit sessions (UC-08)` });
  const rows = data.inside.map(s => {
    const entered = parseTs(s.entry_ts);
    const mins = entered ? Math.max(0, Math.round((Date.now() - entered.getTime()) / 60000)) : 0;
    return `<tr><td class="plate">${esc(s.plate)}</td><td>${esc(s.category)}</td>
      <td>${fmtDateTime(s.entry_ts)}</td><td>${dwellText(mins * 60)}</td><td>${esc(s.purpose || "—")}</td>
      ${has("session.close_manual") ? `<td><button class="link-btn blue" data-close="${s.id}" type="button">Close visit ›</button></td>` : ""}</tr>`;
  }).join("");
  main.innerHTML = `<table class="tbl"><thead><tr><th>Plate</th><th>Category</th><th>Entered</th>
    <th>Time inside</th><th>Purpose of Visit (Optional)</th>${has("session.close_manual") ? "<th></th>" : ""}</tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No vehicles are inside.</td></tr>'}</tbody></table>`;
  $$("button[data-close]", main).forEach(btn => btn.addEventListener("click", async () => {
    const reason = await askReason({
      title: "Close this visit manually?", label: "Reason *",
      sub: "The visit is closed without an exit event. The reason is recorded in the audit log.",
      placeholder: "e.g. Vehicle left through the service gate during the outage",
      confirmText: "Close visit" });
    if (reason === null) return;
    try {
      await apiJson(`/sessions/${btn.dataset.close}/close`, { method: "POST", body: JSON.stringify({ reason }) });
      toast("Visit closed."); route();
    } catch (ex) { toast(ex.message, true); }
  }));
};

/* ---------------- Registry ---------------- */
const CATEGORIES = ["Staff", "Resident", "Student", "Contractor", "Fleet", "Pre-registered Visitor", "VIP"];
const VTYPES = ["car", "motorcycle", "scooter", "auto-rickshaw", "van", "bus", "truck", "bicycle", "other"];
function regStatus(v) {
  if (v.status === "Suspended") return { icon: "⏸", label: "SUSPENDED", cls: "suspended" };
  if (v.status === "Blacklisted") return { icon: "⛔", label: "BLACKLISTED", cls: "blacklisted" };
  if (v.valid_to && parseTs(v.valid_to) < new Date()) return { icon: "●", label: "EXPIRED", cls: "" };
  return { icon: "●", label: "ACTIVE", cls: "known" };
}
VIEWS.registry = async (main) => {
  const canWrite = has("registry.write"), canImport = has("registry.import"), canStatus = has("registry.status");
  setScreen("registry", { sub: "Loading…" });
  main.innerHTML = `
    <div class="filter-row" style="align-items:center;margin-bottom:18px">
      ${canWrite ? `<button class="btn blue" id="r-add" type="button" style="min-width:180px">+ Add vehicle</button>` : ""}
      ${canImport ? `<button class="btn outline" id="r-import" type="button">Import file</button>
      <button class="btn outline" id="r-export" type="button">Export CSV</button>` : ""}
      <form id="reg-filters" style="display:flex;gap:10px;flex:1;min-width:280px">
        <input id="r-q" aria-label="Search the registry" placeholder="Search: plate, owner, category, status — e.g. “LEA” or “Contractor” (FR-REG-10)"
          style="flex:1;font:inherit;padding:10px 12px;border:1px solid #8FA6BC;border-radius:8px;min-height:44px">
        <select id="r-cat" aria-label="Category" style="font:inherit;padding:10px;border:1px solid #8FA6BC;border-radius:8px">
          <option value="">All categories</option>${CATEGORIES.map(c => `<option>${c}</option>`).join("")}</select>
        <select id="r-status" aria-label="Status" style="font:inherit;padding:10px;border:1px solid #8FA6BC;border-radius:8px">
          <option value="">All statuses</option><option>Active</option><option>Suspended</option><option>Blacklisted</option></select>
        <button class="btn blue" type="submit">Search</button>
      </form>
    </div>
    <div id="reg-results"><p class="muted">Loading…</p></div>
    <p class="foot-note" style="margin-top:16px">An expired record still matches as Known — the event is flagged Expired Registration and an alert is raised (FR-REG-05). Suspended and Blacklisted matches raise a Critical alert immediately (FR-REG-06).</p>
    <p class="note-bold">Owner contact numbers are visible only to roles with the registry-view permission — Report Viewers never see them (FR-DAT-07).</p>`;
  const load = async () => {
    const params = new URLSearchParams();
    const q = $("#r-q").value.trim(); if (q) params.set("q", q);
    if ($("#r-cat").value) params.set("category", $("#r-cat").value);
    if ($("#r-status").value) params.set("status", $("#r-status").value);
    const data = await apiJson("/registry?" + params.toString()).catch(e => ({ error: e.message }));
    const el = $("#reg-results");
    if (data.error) { el.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    setScreen("registry", { sub: `${data.total} record${data.total === 1 ? "" : "s"} · plates are unique in normalised form` });
    const rows = data.vehicles.map(v => {
      const st = regStatus(v);
      const rowCls = v.status === "Blacklisted" ? "row-unknown" : v.status === "Suspended" ? "row-review" : "";
      return `<tr class="${rowCls}">
      <td class="plate">${esc(v.plate_display)}</td><td>${esc(v.owner_name || "—")}</td>
      <td>${esc(classTitle(v.type))}</td><td>${esc(v.category)}</td>
      <td>${v.valid_to ? fmtDateShort(v.valid_to) : "— (no end date)"}</td>
      <td><span class="status-word ${st.cls}">${st.icon} ${st.label}</span></td>
      <td style="white-space:nowrap">
        <button class="link-btn blue" data-view="${v.id}" type="button">View ›</button>
        ${canStatus ? `<button class="link-btn" data-status="${v.id}" type="button">Status</button>` : ""}
        ${canWrite ? `<button class="link-btn" data-del="${v.id}" type="button">Deactivate</button>` : ""}
      </td></tr>`;
    }).join("");
    el.innerHTML = `<table class="tbl"><thead><tr><th>Plate</th><th>Owner / Driver</th><th>Type</th>
      <th>Category</th><th>Valid until</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No records match.</td></tr>'}</tbody></table>`;
    $$("button[data-view]", el).forEach(b => b.addEventListener("click", () => {
      state.vehicleEdit = data.vehicles.find(v => v.id === b.dataset.view);
      go("vehicleform");
    }));
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
  $("#reg-filters").addEventListener("submit", e => { e.preventDefault(); load(); });
  const addBtn = $("#r-add");
  if (addBtn) addBtn.addEventListener("click", () => { state.vehicleEdit = null; go("vehicleform"); });
  const impBtn = $("#r-import");
  if (impBtn) impBtn.addEventListener("click", () => { state.importPreview = null; go("import"); });
  const expBtn = $("#r-export");
  if (expBtn) expBtn.addEventListener("click", async () => {
    const res = await api("/registry/export?format=csv");
    downloadBlob(await res.blob(), "registry.csv");
  });
  await load();
};

/* ---------------- Vehicle Form (design: Add Vehicle) ---------------- */
VIEWS.vehicleform = async (main) => {
  const v = state.vehicleEdit;
  const canWrite = has("registry.write");
  setScreen("vehicleform", {
    title: v ? `Vehicle — ${v.plate_display}` : "Add Vehicle",
    sub: v ? `Registry › ${v.plate_display}` : "Registry › New record",
  });
  const val = (k, d = "") => esc(v ? (v[k] ?? d) : d);
  const makeModel = v ? [v.make, v.model].filter(Boolean).join(" ") : "";
  const dis = canWrite ? "" : "disabled";
  main.innerHTML = `
  <div class="grid-main-side">
    <section class="panel">
      <h3 class="panel-title">Vehicle &amp; owner</h3>
      <p class="panel-sub">The plate is stored in display form and in normalised form — matching always uses the normalised form.</p>
      <form id="vehicle-form">
        <div class="grid2">
          <div class="field"><label for="v-plate">Plate number *</label>
            <input id="v-plate" class="mono" required value="${val("plate_display")}" placeholder="e.g. LEA-24-5831" ${dis}>
            <span class="hint">If this plate already exists, saving is refused and the existing record is shown (AT-19).</span></div>
          <div class="field"><label for="v-type">Vehicle type *</label>
            <select id="v-type" ${dis}>${VTYPES.map(t => `<option ${v && v.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-makemodel">Make &amp; model</label>
            <input id="v-makemodel" value="${esc(makeModel)}" placeholder="Toyota Corolla" ${dis}></div>
          <div class="field"><label for="v-colour">Colour</label>
            <input id="v-colour" value="${val("colour")}" placeholder="Silver" ${dis}></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-owner">Owner / driver name *</label>
            <input id="v-owner" value="${val("owner_name")}" placeholder="Full name" ${dis}></div>
          <div class="field"><label for="v-contact">Contact number</label>
            <input id="v-contact" value="${val("contact")}" placeholder="03xx-xxxxxxx" ${dis}></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="v-org">Organisation / department</label>
            <input id="v-org" value="${val("organisation")}" placeholder="e.g. Computer Science" ${dis}></div>
          <div class="field"><label for="v-cat">Category *</label>
            <select id="v-cat" ${dis}>${CATEGORIES.map(c => `<option ${v && v.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        </div>
        <div class="filter-row">
          <div class="field"><label for="v-from">Valid from</label>
            <input id="v-from" type="date" value="${v && v.valid_from ? v.valid_from.slice(0, 10) : ""}" ${dis}></div>
          <div class="field"><label for="v-to">Valid to</label>
            <input id="v-to" type="date" value="${v && v.valid_to ? v.valid_to.slice(0, 10) : ""}" ${dis}>
            <span class="hint">Leave empty for no end date.</span></div>
          <div class="field"><label for="v-status">Status *</label>
            <select id="v-status" ${dis}>${["Active", "Suspended", "Blacklisted"].map(s => `<option ${v && v.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="v-remarks">Remarks</label>
          <input id="v-remarks" value="${val("remarks")}" ${dis}></div>
        <p id="v-error" class="error" role="alert" hidden></p>
        ${canWrite ? `<div class="kbd-row">
          <button class="btn blue" type="submit" style="min-width:220px">Save vehicle</button>
          <button class="btn outline" type="button" id="v-cancel">Cancel</button>
          ${v ? `<button class="btn outline" type="button" id="v-deactivate" style="color:var(--critical);border-color:var(--critical)">Deactivate record</button>` : ""}
        </div>` : `<div class="kbd-row"><button class="btn outline" type="button" id="v-cancel">Back to Registry</button></div>`}
      </form>
    </section>
    <section class="panel">
      <h3 class="panel-title">Status meanings</h3>
      <p class="panel-sub">Status changes are audited with the old value (FR-AUD-01)</p>
      <p><span class="status-word known">● Active</span><br><span class="muted">Matches as a Known Vehicle.</span></p>
      <p><span class="status-word suspended">⏸ Suspended</span><br><span class="muted">Still recorded — a Warning/Critical alert is raised at the gate.</span></p>
      <p><span class="status-word blacklisted">⛔ Blacklisted</span><br><span class="muted">Recorded and a Critical alert fires within 5 seconds (FR-ALR-03).</span></p>
      <p><strong>Deactivate (soft delete)</strong><br><span class="muted">The record leaves matching but its full history stays (FR-REG-07).</span></p>
    </section>
  </div>`;
  $("#v-cancel").addEventListener("click", () => go("registry"));
  const deact = $("#v-deactivate");
  if (deact) deact.addEventListener("click", async () => {
    if (!confirm("Deactivate this record? Its history stays; the plate stops matching.")) return;
    await apiJson(`/registry/${v.id}`, { method: "DELETE" }).catch(e => toast(e.message, true));
    toast("Record deactivated.");
    go("registry");
  });
  const form = $("#vehicle-form");
  if (canWrite) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#v-error"); err.hidden = true;
    const mm = $("#v-makemodel").value.trim();
    const sp = mm.indexOf(" ");
    const body = { plate_display: $("#v-plate").value, type: $("#v-type").value,
      make: sp === -1 ? mm : mm.slice(0, sp), model: sp === -1 ? "" : mm.slice(sp + 1),
      colour: $("#v-colour").value, owner_name: $("#v-owner").value,
      organisation: $("#v-org").value, contact: $("#v-contact").value,
      category: $("#v-cat").value, status: $("#v-status").value, remarks: $("#v-remarks").value,
      valid_from: $("#v-from").value || null, valid_to: $("#v-to").value || null };
    try {
      await apiJson(v ? `/registry/${v.id}` : "/registry",
        { method: v ? "PUT" : "POST", body: JSON.stringify(body) });
      toast(v ? "Vehicle updated." : "Vehicle added.");
      go("registry");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
};

/* ---------------- Import (design: Import Vehicles) ---------------- */
VIEWS.import = async (main) => {
  setScreen("import", { sub: "Registry › Import" });
  const prev = state.importPreview;
  main.innerHTML = `
    <section class="panel">
      <h3 class="panel-title">Choose the file</h3>
      <p class="panel-sub">CSV or XLSX, up to 10,000 rows. Nothing is imported until you confirm the preview (UC-13 A1).</p>
      <div class="filter-row" style="align-items:end">
        <div class="field" style="flex:1;min-width:260px"><label for="r-file">File</label>
          <input id="r-file" type="file" accept=".csv,.xlsx"></div>
        <button class="btn blue" id="r-preview" type="button">Preview file</button>
      </div>
      <p id="import-error" class="error" role="alert" hidden></p>
    </section>
    <div id="import-result"></div>`;
  const slot = $("#import-result");
  const renderPreview = (data) => {
    setScreen("import", { sub: `Registry › Import · ${esc(data.filename || "file")}` });
    const errRows = (data.errors || []).map(e => `<tr><td class="t-bold">${e.row}</td>
      <td class="plate">${esc(e.plate || "(empty)")}</td><td>${esc(e.message)}</td></tr>`).join("");
    slot.innerHTML = `
      <div class="summary-strip">
        <div><div class="ss-num" style="color:var(--success)">${data.valid_rows.toLocaleString()}</div><div class="ss-lbl">rows ready to import</div></div>
        <div><div class="ss-num" style="color:var(--critical)">${data.error_rows.toLocaleString()}</div><div class="ss-lbl">rows rejected — see the error report</div></div>
        <div><div class="ss-num">${data.total_rows.toLocaleString()}</div><div class="ss-lbl">rows in the file (the maximum is 10,000)</div></div>
        <div class="ss-spacer"></div>
        <button class="btn blue" id="r-commit" type="button" ${data.valid_rows === 0 ? "disabled" : ""}>Import ${data.valid_rows.toLocaleString()} rows</button>
      </div>
      ${errRows ? `<table class="tbl"><thead><tr><th>Row</th><th>Plate</th><th>Why it was rejected</th></tr></thead><tbody>${errRows}</tbody></table>` : ""}
      <div class="kbd-row" style="margin-top:16px">
        ${data.error_report_csv ? `<button class="btn outline" id="r-errdl" type="button">Download error report (CSV)</button>` : ""}
        <button class="btn outline" id="r-cancel" type="button">Cancel import</button>
      </div>
      <p class="foot-note" style="margin-top:12px">Nothing is imported until you confirm. Cancelling after the preview imports nothing (UC-13 A1). The import itself is written to the audit log.</p>`;
    const commit = $("#r-commit");
    if (commit) commit.addEventListener("click", () => doImport(true));
    const cancel = $("#r-cancel");
    if (cancel) cancel.addEventListener("click", () => { state.importPreview = null; go("registry"); });
    const dl = $("#r-errdl");
    if (dl) dl.addEventListener("click", () =>
      downloadBlob(new Blob([data.error_report_csv], { type: "text/csv" }), "import-errors.csv"));
  };
  const doImport = async (commit) => {
    const file = $("#r-file").files[0];
    const errEl = $("#import-error"); errEl.hidden = true;
    if (!file) { errEl.textContent = "Choose a CSV or XLSX file first."; errEl.hidden = false; return; }
    const fd = new FormData();
    fd.append("file", file); fd.append("commit", commit ? "true" : "false");
    const res = await fetch("/api/registry/import", { method: "POST",
      headers: { Authorization: "Bearer " + state.access }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { errEl.textContent = data.detail || "Import failed."; errEl.hidden = false; return; }
    data.filename = file.name;
    if (commit) {
      toast(`Import complete — ${data.imported} rows imported.`);
      state.importPreview = null;
      go("registry");
      return;
    }
    state.importPreview = data;
    renderPreview(data);
  };
  $("#r-preview").addEventListener("click", () => doImport(false));
  if (prev) renderPreview(prev);
};

/* ---------------- Cameras ---------------- */
VIEWS.cameras = async (main) => {
  setScreen("cameras");
  const data = await apiJson("/cameras").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  state.cameras = data.cameras;
  updateCamPill();
  const canManage = has("camera.manage");
  const rows = data.cameras.map(c => {
    const st = c.status === "online" ? `<span class="dot on"></span>Online`
      : c.status === "degraded" ? `<span class="dot deg"></span>Degraded`
      : c.status === "disabled" ? `<span class="dot"></span>Disabled`
      : `<span class="dot off"></span>Offline`;
    const rowCls = c.status === "degraded" || c.status === "offline" ? "row-review" : "";
    return `<tr class="${rowCls}">
    <td class="t-bold">${esc(c.name)}</td><td>${esc(c.role)}</td>
    <td>${c.stream_url ? "RTSP · stream set" : "—"}</td>
    <td>${st}</td>
    <td>${c.last_frame_at ? fmtDayTime(c.last_frame_at) : "—"}</td>
    <td style="white-space:nowrap">${canManage ? `
      <button class="link-btn blue" data-cam-edit="${c.id}" type="button">Edit ›</button>
      ${c.status === "disabled"
        ? `<button class="link-btn" data-cam-toggle="${c.id}" data-to="online" type="button">Enable ›</button>`
        : `<button class="link-btn" data-cam-toggle="${c.id}" data-to="disabled" type="button">Disable ›</button>`}
      <button class="link-btn" data-cam-del="${c.id}" type="button">Delete</button>` : ""}</td></tr>`;
  }).join("");
  const edgeNodes = [...new Set(data.cameras.map(c => c.edge_node))].map(n => `
    <p class="foot-note" style="font-size:0.98rem;color:var(--ink)">${esc(n)} — ${data.cameras.filter(c => c.edge_node === n).length} camera${data.cameras.filter(c => c.edge_node === n).length === 1 ? "" : "s"} · buffers events for 72 hours if the server is unreachable (FR-LOG-12)</p>`).join("");
  main.innerHTML = `
    ${canManage ? `<div style="margin-bottom:18px"><button class="btn blue" id="cam-add" type="button" style="min-width:190px">+ Add camera</button></div>` : ""}
    <table class="tbl"><thead><tr><th>Camera</th><th>Role</th><th>Stream</th><th>Status</th><th>Last frame</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="foot-note" style="margin-top:16px">Offline rule (FR-CAM-04/05): no frame for 10 seconds → camera declared offline, alert within 15 seconds. The stream is retried every 5 s, backing off to 60 s, and every outage is logged with its start and end.</p>
    <p class="note-bold">Camera streams travel only on the isolated camera network — they are never reachable from office workstations (CM-03). Credentials are stored encrypted (FR-CAM-03).</p>
    <section class="panel" style="margin-top:20px">
      <h3 class="panel-title">Edge nodes</h3>
      <p class="panel-sub">Each edge node processes up to 8 streams at 1080p / 15 fps (FR-CAM-02) and buffers events for 72 hours if the server is unreachable (FR-LOG-12)</p>
      ${edgeNodes || '<p class="foot-note">No edge nodes yet.</p>'}
    </section>`;
  const addBtn = $("#cam-add");
  if (addBtn) addBtn.addEventListener("click", () => { state.cameraEdit = null; go("camerasetup"); });
  $$("button[data-cam-edit]", main).forEach(b => b.addEventListener("click", () => {
    state.cameraEdit = data.cameras.find(c => c.id === b.dataset.camEdit);
    go("camerasetup");
  }));
  $$("button[data-cam-toggle]", main).forEach(b => b.addEventListener("click", async () => {
    const c = data.cameras.find(x => x.id === b.dataset.camToggle);
    try {
      await apiJson(`/cameras/${c.id}`, { method: "PUT", body: JSON.stringify({
        name: c.name, role: c.role, site: c.site, gate: c.gate, lane: c.lane,
        edge_node: c.edge_node, stream_url: c.stream_url, roi: c.roi,
        virtual_line: c.virtual_line, status: b.dataset.to }) });
      toast(`Camera ${b.dataset.to === "disabled" ? "disabled" : "enabled"}.`);
      route();
    } catch (e) { toast(e.message, true); }
  }));
  $$("button[data-cam-del]", main).forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Delete this camera? Existing events keep their history.")) return;
    await apiJson(`/cameras/${b.dataset.camDel}`, { method: "DELETE" }).catch(e => toast(e.message, true));
    toast("Camera deleted."); route();
  }));
};

/* ---------------- Camera Setup (design: UC-20) ---------------- */
VIEWS.camerasetup = async (main) => {
  const c = state.cameraEdit;
  setScreen("camerasetup", {
    title: c ? `Camera Setup — ${c.name}` : "Camera Setup — New camera",
    sub: c ? `Cameras › ${c.name} · draw the region and the line on the live preview` : "Cameras › New camera",
  });
  const val = (k, d = "") => esc(c ? (c[k] ?? d) : d);
  let roiBox = "", vline = "";
  if (c) {
    try {
      const roi = JSON.parse(c.roi || "[]");
      if (Array.isArray(roi) && roi.length >= 2) {
        const xs = roi.map(p => p[0] / 10), ys = roi.map(p => p[1] / 10);
        const l = Math.min(...xs), t = Math.min(...ys);
        roiBox = `<div class="roi-box" style="left:${l}%;top:${t}%;width:${Math.max(...xs) - l}%;height:${Math.max(...ys) - t}%"><span class="roi-label">REGION OF INTEREST</span></div>`;
      }
    } catch {}
    try {
      const vl = JSON.parse(c.virtual_line || "{}");
      if (vl && vl.y1 != null && vl.y1 === vl.y2) vline = `<div class="vline" style="top:${vl.y1 / 10}%"></div>`;
    } catch {}
  }
  const events = c ? await apiJson("/live/events").catch(() => ({ events: [] })) : { events: [] };
  const latest = c ? events.events.find(e => e.camera_id === c.id) : null;
  const fullImg = latest && (latest.images || []).find(i => i.kind === "full");
  main.innerHTML = `
  <div class="grid-main-side">
    <div>
      <div class="scene">
        <div class="scene-head"><span>LIVE PREVIEW — test the stream before saving (UC-20 step 3)</span></div>
        <div class="scene-frame">
          ${fullImg ? `<img class="scene-img" data-setup-img alt="Latest frame from this camera">` : `<div class="scene-empty">${c ? "No frame captured from this camera yet." : "Save the camera, then its frames appear here."}</div>`}
          ${roiBox}${vline}
        </div>
        <p class="scene-cap">— VIRTUAL LINE — crossing it captures the vehicle and sets the direction<br>
        Geometry check: the plate should be at least ~120 px wide at the line — keep the camera within the Appendix A.4 installation angles.</p>
      </div>
      <p class="foot-note" style="margin-top:14px">If the stream test fails, the camera is not activated and the error is explained in plain language (UC-20 E1, UI-07).</p>
    </div>
    <section class="panel">
      <h3 class="panel-title">Camera details</h3>
      <p class="panel-sub">Role decides the event type (FR-LOG-01)</p>
      <form id="cam-form">
        <div class="field"><label for="c-name">Name *</label>
          <input id="c-name" required value="${val("name")}" placeholder="Camera 1 — Main Gate"></div>
        <div class="field"><label for="c-role">Role *</label>
          <select id="c-role">${["Entry", "Exit", "Bidirectional"].map(r => `<option ${c && c.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>
          <span class="hint">Entry, Exit, or Bidirectional (direction from the track).</span></div>
        <div class="field"><label for="c-stream">Stream address (RTSP) *</label>
          <input id="c-stream" value="${val("stream_url")}" placeholder="rtsp://…/stream1"></div>
        <div class="field"><label for="c-edge">Edge node *</label>
          <input id="c-edge" value="${val("edge_node", "Edge Node 1")}"></div>
        <div class="grid2">
          <div class="field"><label for="c-site">Site</label><input id="c-site" value="${val("site", "Main Campus")}"></div>
          <div class="field"><label for="c-gate">Gate</label><input id="c-gate" value="${val("gate", "Main Gate")}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="c-lane">Lane</label><input id="c-lane" value="${val("lane", "Lane 1")}"></div>
          <div class="field"><label for="c-status">Status</label>
            <select id="c-status">${["online", "offline", "degraded", "disabled"].map(s => `<option ${c && c.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="c-roi">Region of interest (JSON)</label>
          <textarea id="c-roi" class="mono" rows="2">${val("roi", "[]")}</textarea>
          <span class="hint">Polygon points as [x, y] pairs in 0–1000 image coordinates.</span></div>
        <div class="field"><label for="c-line">Virtual line (JSON)</label>
          <textarea id="c-line" class="mono" rows="2">${val("virtual_line", "{}")}</textarea>
          <span class="hint">{"x1":0,"y1":500,"x2":1000,"y2":500} — crossing direction decides Entry/Exit on bidirectional cameras.</span></div>
        <p id="c-error" class="error" role="alert" hidden></p>
        <button class="btn blue" type="submit" style="width:100%">Test stream, then save</button>
        <button class="btn outline" type="button" id="c-cancel" style="width:100%;margin-top:10px">Cancel</button>
      </form>
    </section>
  </div>`;
  const img = $("img[data-setup-img]", main);
  if (img && latest && fullImg) loadImg(img, `/events/${latest.id}/images/${fullImg.id}`);
  $("#c-cancel").addEventListener("click", () => go("cameras"));
  $("#cam-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#c-error"); err.hidden = true;
    const body = { name: $("#c-name").value, role: $("#c-role").value, site: $("#c-site").value,
      gate: $("#c-gate").value, lane: $("#c-lane").value, edge_node: $("#c-edge").value,
      stream_url: $("#c-stream").value, roi: $("#c-roi").value, virtual_line: $("#c-line").value,
      status: $("#c-status").value };
    try {
      await apiJson(c ? `/cameras/${c.id}` : "/cameras", { method: c ? "PUT" : "POST", body: JSON.stringify(body) });
      toast("Camera saved.");
      go("cameras");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
};

/* ---------------- Alerts ---------------- */
VIEWS.alerts = async (main) => {
  setScreen("alerts");
  const data = await apiJson("/alerts?limit=100").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  const sevWord = a => a.severity === "Critical"
    ? `<span class="status-word blacklisted">⛔ CRITICAL</span>`
    : a.severity === "Warning" ? `<span class="status-word suspended">● WARNING</span>`
    : `<span class="status-word">● INFO</span>`;
  const rows = data.alerts.map(a => `<tr class="${a.severity === "Critical" ? "row-unknown" : a.severity === "Warning" ? "row-review" : ""}">
    <td>${sevWord(a)}</td>
    <td>${esc(a.message)}</td>
    <td style="white-space:nowrap">${fmtTime(a.created_at)}</td>
    <td>${a.ack_at ? `Acknowledged ${fmtTime(a.ack_at)}${a.ack_by ? ` · ${esc(a.ack_by)}` : ""}` : "NOT acknowledged"}</td>
    <td style="white-space:nowrap">${!a.ack_at && has("alert.acknowledge")
      ? `<button class="link-btn blue" data-ack="${a.id}" type="button">Acknowledge</button>`
      : a.related_type === "event" && a.related_id ? `<button class="link-btn blue" data-open-event="${a.related_id}" type="button">Open ›</button>` : ""}</td></tr>`).join("");
  main.innerHTML = `
    <table class="tbl"><thead><tr><th>Severity</th><th>Alert</th><th>Time</th><th>State</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">No alerts recorded.</td></tr>'}</tbody></table>
    <p class="foot-note" style="margin-top:16px">Alert types (FR-ALR-01): Blacklisted · Suspended · Expired Registration · Camera offline · Review overdue · Overstay · Exit Without Entry · Repeated Entry · Storage over 85% · Sync failure · Repeated failed sign-in. Delivery channels per type — in-app, email, SMS, webhook — are set in Settings (FR-ALR-03).</p>
    <p class="note-bold">Acknowledging records who and when. The history stays searchable by type, severity, time and state (FR-ALR-05).</p>`;
  $$("button[data-ack]", main).forEach(b => b.addEventListener("click", async () => {
    await apiJson(`/alerts/${b.dataset.ack}/ack`, { method: "POST" }).catch(e => toast(e.message, true));
    toast("Alert acknowledged."); refreshBadges(); route();
  }));
  $$("button[data-open-event]", main).forEach(b => b.addEventListener("click", () => {
    state.currentEventId = b.dataset.openEvent;
    go("event");
  }));
};

/* ---------------- Reports ---------------- */
const REPORTS = [
  ["daily-movement", "Daily Movement", "All entries and exits for a day, with counts by gate and class"],
  ["currently-inside", "Vehicles Currently Inside", "Open sessions right now, with entry time and dwell so far"],
  ["unknown-vehicles", "Unknown Vehicles", "Every UNKNOWN event with plates as read and purposes"],
  ["dwell-time", "Dwell Time", "Visit durations by category — averages and the longest stays"],
  ["exceptions", "Exceptions", "Exit Without Entry, Repeated Entry, Unclosed, Type Mismatch, Expired"],
  ["blacklist-alerts", "Blacklist & Alerts", "Blacklisted/suspended passages and the alert history"],
  ["camera-availability", "Camera Availability", "Uptime and every outage per camera, with durations"],
];
VIEWS.reports = async (main) => {
  setScreen("reports");
  main.innerHTML = `
  <div class="grid-main-side">
    <div id="report-list">
      ${REPORTS.map(([k, t, d]) => `
      <div class="report-card" data-report-card="${k}">
        <div><div class="rc-title">${esc(t)}</div><div class="rc-desc">${esc(d)}</div></div>
        <button class="btn outline" data-open-report="${k}" type="button">Open report</button>
      </div>`).join("")}
      <div id="report-out" style="margin-top:18px"><p class="muted">Open a report to see it here.</p></div>
    </div>
    <section class="panel">
      <h3 class="panel-title">Export &amp; schedule</h3>
      <p class="panel-sub">Every export carries the filters, the generation time and your name (FR-RPT-04)</p>
      <div class="grid2">
        <div class="field"><label for="rp-from">From</label><input id="rp-from" type="date"></div>
        <div class="field"><label for="rp-to">To</label><input id="rp-to" type="date"></div>
      </div>
      <div class="field"><span class="field-label">Format</span>
        <div style="display:flex;gap:10px">
          ${has("report.export") ? `
          <button class="btn outline" data-fmt="pdf" type="button" style="flex:1">PDF</button>
          <button class="btn outline" data-fmt="csv" type="button" style="flex:1">CSV</button>
          <button class="btn outline" data-fmt="xlsx" type="button" style="flex:1">XLSX</button>`
          : `<span class="muted">Your role cannot export files.</span>`}
        </div></div>
      <div class="field"><span class="field-label">Images in exports</span>
        <p class="foot-note" style="margin:0">${has("event.image")
          ? "Your role holds the image permission, so exports you generate may include evidence images (FR-RPT-05)."
          : "Only roles with the image permission may include images — your role does not hold it, so the option is not shown (FR-RPT-05, UI-02)."}</p></div>
      <div class="field"><span class="field-label">Email schedule</span>
        <p class="foot-note" style="margin:0">Scheduled emailed reports (FR-RPT-06) are configured with the alert channels in Settings.</p></div>
      <button class="btn navy" id="rp-schedule" type="button" style="width:100%">Change schedule</button>
    </section>
  </div>`;
  const query = () => {
    const p = new URLSearchParams();
    if ($("#rp-from").value) p.set("date_from", $("#rp-from").value);
    if ($("#rp-to").value) p.set("date_to", $("#rp-to").value + "T23:59:59");
    return p.toString();
  };
  const openReport = async (type) => {
    state.reportType = type;
    $$("[data-report-card]", main).forEach(card =>
      card.classList.toggle("sel", card.dataset.reportCard === type));
    const out = $("#report-out");
    out.innerHTML = `<p class="muted">Generating…</p>`;
    const data = await apiJson(`/reports/${type}?${query()}`).catch(err => ({ error: err.message }));
    if (data.error) { out.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    const cols = data.rows.length ? Object.keys(data.rows[0]) : [];
    out.innerHTML = `<section class="panel"><h3 class="panel-title">${esc(data.title)}</h3>
      <p class="panel-sub">Generated ${esc(data.generated_at)} by ${esc(data.generated_by)} · ${data.rows.length} row${data.rows.length === 1 ? "" : "s"}</p>
      ${cols.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${data.rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : '<p class="muted">No records match the selected filters.</p>'}</section>`;
  };
  $$("button[data-open-report]", main).forEach(b => b.addEventListener("click", () => openReport(b.dataset.openReport)));
  $$("button[data-fmt]", main).forEach(b => b.addEventListener("click", async () => {
    if (!state.reportType) { toast("Open a report first, then export it.", true); return; }
    const res = await api(`/reports/${state.reportType}?format=${b.dataset.fmt}&${query()}`);
    if (!res.ok) { toast("Export failed. Your role may not include export.", true); return; }
    downloadBlob(await res.blob(), `${state.reportType}.${b.dataset.fmt}`);
  }));
  $("#rp-schedule").addEventListener("click", () => {
    if (has("config.manage")) go("settings");
    else toast("Only a System Administrator can change the schedule.", true);
  });
  if (state.reportType) openReport(state.reportType);
};

/* ---------------- Users & Roles ---------------- */
VIEWS.users = async (main) => {
  setScreen("users");
  const data = await apiJson("/users").catch(e => ({ error: e.message }));
  if (data.error) { main.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
  const roleOpts = sel => ["SA", "SS", "GO", "RM", "AU", "RV"]
    .map(r => `<option value="${r}" ${sel === r ? "selected" : ""}>${roleName(r)}</option>`).join("");
  const rows = data.users.map(u => `<tr ${u.status !== "active" ? 'style="color:var(--ink-muted)"' : ""}>
    <td class="t-bold">${esc(u.full_name)}</td><td>${esc(u.username)}</td><td>${roleName(u.role)}</td>
    <td>${u.mfa_enabled ? "Enrolled" : "Not enrolled"}</td>
    <td>${u.last_login ? fmtDayTime(u.last_login) : "Never"}</td>
    <td><span class="status-word ${u.status === "active" ? "known" : ""}">${u.status === "active" ? "● Active" : "○ Disabled"}</span></td>
    <td style="white-space:nowrap">
      <select data-role="${u.id}" aria-label="Role for ${esc(u.username)}"
        style="font:inherit;padding:6px 8px;border:1px solid var(--border);border-radius:7px">${roleOpts(u.role)}</select>
      <button class="link-btn" data-toggle="${u.id}" data-status="${u.status}" type="button">${u.status === "active" ? "Disable" : "Enable"}</button>
      <button class="link-btn" data-reset="${u.id}" type="button">Reset password</button>
    </td></tr>`).join("");
  main.innerHTML = `
    <div class="filter-row" style="align-items:center;margin-bottom:18px">
      <button class="btn blue" id="u-add" type="button" style="min-width:180px">+ Add user</button>
      <span class="foot-note">New accounts get a one-time password and must change it at first sign in (UC-19).</span>
    </div>
    <table class="tbl"><thead><tr><th>User</th><th>User name</th><th>Role</th><th>MFA</th>
      <th>Last sign in</th><th>Status</th><th>Manage</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="banner review" style="margin-top:20px"><div>
      <div class="b-sub" style="margin:0">The system refuses to disable or delete an administrator when that would leave fewer than two active System Administrators (FR-SEC-07). Disabling a user never deletes their history — their events and audit entries remain (FR-SEC-11).</div></div></div>
    <p class="foot-note">A role change applies from the user's very next request, even in an open session (FR-SEC-08).</p>`;
  $("#u-add").addEventListener("click", () => {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="u-title">
      <h3 id="u-title">Add user</h3>
      <p class="m-sub">One person, one role. The account gets a one-time password and must change it at first sign in (UC-19).</p>
      <form id="user-form">
        <div class="field"><label for="u-name">User name *</label><input id="u-name" required></div>
        <div class="field"><label for="u-full">Full name *</label><input id="u-full" required></div>
        <div class="field"><label for="u-role">Role *</label><select id="u-role">${roleOpts("GO")}</select></div>
        <div class="field"><label for="u-pass">Password (at least 12 characters) *</label><input id="u-pass" type="password" required minlength="12"></div>
        <div class="grid2">
          <div class="field"><label for="u-email">Email</label><input id="u-email" type="email"></div>
          <div class="field"><label for="u-phone">Phone</label><input id="u-phone"></div>
        </div>
        <p id="u-error" class="error" role="alert" hidden></p>
        <button class="btn blue" type="submit" style="width:100%">Create user</button>
        <button class="btn outline" type="button" id="u-cancel" style="width:100%;margin-top:10px">Cancel</button>
      </form></div></div>`;
    $("#u-cancel").addEventListener("click", closeModal);
    $("#user-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#u-error"); err.hidden = true;
      try {
        await apiJson("/users", { method: "POST", body: JSON.stringify({
          username: $("#u-name").value, full_name: $("#u-full").value, role: $("#u-role").value,
          password: $("#u-pass").value, email: $("#u-email").value, phone: $("#u-phone").value }) });
        closeModal();
        toast("User created."); route();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  });
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
};

/* ---------------- Audit Log ---------------- */
VIEWS.audit = async (main) => {
  setScreen("audit");
  main.innerHTML = `
    <div id="a-banner"><div class="banner known"><div class="b-icon">✓</div><div>
      <div class="b-title">Checking the hash chain…</div></div></div></div>
    <div class="filter-row" style="align-items:center;margin-bottom:18px">
      <button class="btn navy" id="a-verify" type="button">Verify chain now</button>
      ${has("audit.export") ? `<button class="btn outline" id="a-export" type="button">Export audit log</button>` : ""}
      <form id="audit-filters" style="display:flex;gap:10px;align-items:center;margin-left:auto">
        <span class="foot-note">Filters:</span>
        <input id="a-action" aria-label="Action contains" placeholder="action" style="font:inherit;padding:9px 11px;border:1px solid #8FA6BC;border-radius:8px">
        <input id="a-user" aria-label="User name contains" placeholder="user" style="font:inherit;padding:9px 11px;border:1px solid #8FA6BC;border-radius:8px">
        <button class="btn blue" type="submit">Search</button>
      </form>
    </div>
    <div id="audit-results"><p class="muted">Loading…</p></div>
    <p class="foot-note" style="margin-top:14px">Entries keep the previous value and the new value for every change (FR-AUD-02). The application's own database account has no permission to update or delete audit rows (DB-05).</p>`;
  const humanAction = a => { const s = a.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
  const objLabel = r => {
    const id8 = r.object_id ? r.object_id.slice(0, 8).toUpperCase() : "";
    if (r.object_type === "event") return `Event EVT-${id8}`;
    if (r.object_type === "vehicle") return `Vehicle ${id8}`;
    if (r.object_type === "user") return `User ${id8}`;
    if (r.object_type === "alert") return `Alert ${id8}`;
    return `${esc(r.object_type)} ${id8}`;
  };
  const verify = async () => {
    const banner = $("#a-banner");
    try {
      const r = await apiJson("/audit/verify");
      banner.innerHTML = r.ok
        ? `<div class="banner known"><div class="b-icon">✓</div><div>
             <div class="b-title">✓ Hash chain verified — ${r.entries_checked.toLocaleString()} entries intact, checked just now</div>
             <div class="b-sub">Each entry carries the hash of the one before it. Any tampering breaks the chain and raises a Critical alert (FR-AUD-04).</div></div></div>`
        : `<div class="banner unknown"><div class="b-icon">!</div><div>
             <div class="b-title">✕ Hash chain broken at entry ${esc(r.first_bad_entry || "")}</div>
             <div class="b-sub">A Critical alert has been raised. Treat the log as evidence and contact the System Administrator.</div></div></div>`;
    } catch (e) {
      banner.innerHTML = `<div class="banner review"><div class="b-icon">◐</div><div>
        <div class="b-title">Verification could not run</div><div class="b-sub">${esc(e.message)}</div></div></div>`;
    }
  };
  const load = async () => {
    const p = new URLSearchParams();
    if ($("#a-action").value.trim()) p.set("action", $("#a-action").value.trim());
    if ($("#a-user").value.trim()) p.set("username", $("#a-user").value.trim());
    const data = await apiJson("/audit?" + p.toString()).catch(e => ({ error: e.message }));
    const el = $("#audit-results");
    if (data.error) { el.innerHTML = `<p class="error">${esc(data.error)}</p>`; return; }
    const rows = data.entries.map(r => {
      const change = (r.prev_value || r.new_value)
        ? `${esc(String(r.prev_value).slice(0, 60))} → ${esc(String(r.new_value).slice(0, 60))}`
        : (r.result === "success" ? "—" : esc(r.result));
      return `<tr><td class="t-bold">${fmtTime(r.ts)}</td>
      <td>${esc(r.username || "System")}${r.role ? ` · ${esc(r.role)}` : ""}</td>
      <td>${esc(humanAction(r.action))}</td><td>${objLabel(r)}</td><td>${change}</td></tr>`;
    }).join("");
    el.innerHTML = `<table class="tbl"><thead><tr><th>Time (UTC shown local)</th><th>User · Role</th>
      <th>Action</th><th>Object</th><th>Change</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No entries match.</td></tr>'}</tbody></table>
      <p class="foot-note" style="margin-top:10px">Showing ${data.entries.length} of ${data.total} entries · append-only · hash-chained</p>`;
  };
  $("#audit-filters").addEventListener("submit", e => { e.preventDefault(); load(); });
  $("#a-verify").addEventListener("click", verify);
  const exp = $("#a-export");
  if (exp) exp.addEventListener("click", async () => {
    const res = await api("/audit/export");
    downloadBlob(await res.blob(), "audit-log.csv");
  });
  await verify();
  await load();
};

/* ---------------- Settings ---------------- */
VIEWS.settings = async (main) => {
  setScreen("settings");
  const cfg = await apiJson("/config").catch(e => ({ error: e.message }));
  if (cfg.error) { main.innerHTML = `<p class="error">${esc(cfg.error)}</p>`; return; }
  const formats = await apiJson("/plate-formats").catch(() => ({ formats: [] }));
  state.purposes = (await apiJson("/purposes").catch(() => ({ purposes: state.purposes }))).purposes;
  const s = cfg.settings;
  const num = (key, label, hint, step = "0.01") => `
    <div class="field"><label for="s-${key}">${label}</label>
    <input id="s-${key}" type="number" step="${step}" value="${esc(s[key])}">
    <span class="hint">${esc(hint || cfg.descriptions[key] || "")}</span></div>`;
  const text = (key, label, hint) => `
    <div class="field"><label for="s-${key}">${label}</label>
    <input id="s-${key}" value="${esc(typeof s[key] === "string" ? s[key] : JSON.stringify(s[key]))}">
    <span class="hint">${esc(hint || cfg.descriptions[key] || "")}</span></div>`;
  const purposeRows = state.purposes.map(p => `<tr><td>${esc(p.label)}</td>
    <td>${p.active ? "Active" : "Inactive"}</td><td>${esc(p.default_for_category || "—")}</td>
    <td><button class="link-btn" data-purp-del="${p.id}" type="button">Delete</button></td></tr>`).join("");
  main.innerHTML = `
    <form id="settings-form">
    <div class="grid2">
      <section class="panel">
        <h3 class="panel-title">Recognition &amp; logging</h3>
        <p class="panel-sub">Ranges are enforced — an out-of-range value is rejected with the allowed range (FR-CFG-02)</p>
        ${num("accept_threshold", "Acceptance threshold (auto-accept at or above)", "Allowed 0.50 – 0.99.")}
        ${num("review_threshold", "Review threshold (below this: UNREADABLE)", "Allowed 0.10 – 0.84, and always below the acceptance threshold.")}
        ${num("duplicate_window_seconds", "Duplicate window (seconds, same plate + camera)", "Detections inside the window attach to one event (FR-LOG-09).", "1")}
        ${num("review_escalation_minutes", "Review escalation (minutes, then alert the Supervisor)", "", "1")}
        ${num("class_confidence_review", "Class confidence review floor", "Vehicle classes read below this confidence also go to review.")}
        <div class="field"><label for="s-overstay_limits">Overstay limits by category</label>
          <textarea id="s-overstay_limits" class="mono" rows="2">${esc(JSON.stringify(s.overstay_limits))}</textarea>
          <span class="hint">Hours per category as JSON. Per-category limits raise overstay alerts (FR-LOG-14).</span></div>
      </section>
      <section class="panel">
        <h3 class="panel-title">Retention, purposes &amp; channels</h3>
        <p class="panel-sub">Purging is automatic and daily; legal holds are never purged (FR-DAT-02/03)</p>
        ${num("image_retention_days", "Keep event images (days)", "Default 90 (FR-DAT-01).", "1")}
        ${num("record_retention_years", "Keep event records (years)", "Audit entries are kept at least 2 years (FR-AUD-05).", "1")}
        ${text("site_timezone", "Site time zone")}
        ${text("smtp_server", "SMTP server (blank = email off)")}
        ${text("sms_gateway", "SMS gateway URL (blank = SMS off)")}
        ${text("webhook_url", "Webhook URL (blank = webhooks off)")}
        ${text("webhook_secret", "Webhook HMAC secret")}
        <div class="field"><label for="s-alert_channels">Alert channels by type</label>
          <textarea id="s-alert_channels" class="mono" rows="3">${esc(JSON.stringify(s.alert_channels, null, 1))}</textarea>
          <span class="hint">Channels per severity as JSON — in-app, email, sms, webhook (FR-ALR-03).</span></div>
        <div class="field"><label for="s-notice_text">Notice text (Sign In screen and reports)</label>
          <textarea id="s-notice_text" rows="2">${esc(s.notice_text || "")}</textarea></div>
        <div class="kbd-row">
          <button class="btn outline" id="export-config" type="button">Export configuration</button>
          <button class="btn outline" id="import-config" type="button">Import configuration</button>
          <input id="import-config-file" type="file" accept=".json" hidden>
        </div>
      </section>
    </div>
    <p id="s-error" class="error" role="alert" hidden></p>
    <button class="btn blue" type="submit" style="min-width:240px">Save settings</button>
    <p class="foot-note" style="margin-top:14px">Plate format rules are data, not code: each region's pattern is a regular expression with an example, editable below (FR-OCR-05). A future barrier controller can subscribe to the event output — release 1.0 actuates nothing (HW-04, §2.7).</p>
    </form>
    <section class="panel">
      <h3 class="panel-title">Purpose of visit list</h3>
      <p class="panel-sub">The list operators choose from (FR-POV-08). Free text is always allowed.</p>
      <table class="tbl"><thead><tr><th>Label</th><th>State</th><th>Default for category</th><th></th></tr></thead>
      <tbody>${purposeRows}</tbody></table>
      <form id="purpose-add" class="filter-row" style="margin-top:14px;align-items:end">
        <div class="field"><label for="pa-label">New purpose</label><input id="pa-label" required></div>
        <div class="field"><label for="pa-cat">Default for category</label><select id="pa-cat">
          <option value="">—</option>${CATEGORIES.map(c => `<option>${c}</option>`).join("")}</select></div>
        <button class="btn outline" type="submit">Add Purpose</button></form>
    </section>
    <section class="panel">
      <h3 class="panel-title">Plate formats</h3>
      <p class="panel-sub">Each region's pattern is a regular expression with an example (FR-OCR-05)</p>
      <table class="tbl"><thead><tr><th>Region</th><th>Pattern</th><th>Example</th><th>Active</th></tr></thead>
      <tbody>${formats.formats.map(f => `<tr><td>${esc(f.region)}</td><td class="mono small">${esc(f.regex)}</td><td class="plate">${esc(f.example)}</td><td>${f.active ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table>
      <form id="format-add" class="filter-row" style="margin-top:14px;align-items:end">
        <div class="field"><label for="fa-region">Region</label><input id="fa-region" required></div>
        <div class="field"><label for="fa-regex">Pattern (regex)</label><input id="fa-regex" class="mono" required></div>
        <div class="field"><label for="fa-example">Example</label><input id="fa-example" class="mono"></div>
        <button class="btn outline" type="submit">Add Format</button></form>
    </section>
    <section class="panel">
      <h3 class="panel-title">Maintenance</h3>
      <p class="panel-sub">Run the periodic checks now instead of waiting for the schedule</p>
      <div class="kbd-row">
        <button class="btn outline" id="run-jobs" type="button">Run periodic jobs now</button>
      </div><p id="jobs-out" aria-live="polite" class="muted"></p>
    </section>`;
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#s-error"); err.hidden = true;
    const numeric = ["accept_threshold", "review_threshold", "duplicate_window_seconds",
      "review_escalation_minutes", "class_confidence_review", "image_retention_days",
      "record_retention_years"];
    const textual = ["site_timezone", "notice_text", "smtp_server", "sms_gateway",
      "webhook_url", "webhook_secret"];
    try {
      for (const k of numeric)
        await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: Number($(`#s-${k}`).value) }) });
      for (const k of textual)
        await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: $(`#s-${k}`).value }) });
      for (const k of ["alert_channels", "overstay_limits"])
        await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: JSON.parse($(`#s-${k}`).value) }) });
      toast("Settings saved.");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $("#purpose-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiJson("/purposes", { method: "POST", body: JSON.stringify({
      label: $("#pa-label").value, active: true,
      default_for_category: $("#pa-cat").value || null }) }).catch(err => toast(err.message, true));
    toast("Purpose added."); route();
  });
  $$("button[data-purp-del]", main).forEach(b => b.addEventListener("click", async () => {
    await apiJson(`/purposes/${b.dataset.purpDel}`, { method: "DELETE" }).catch(e => toast(e.message, true));
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
  $("#import-config").addEventListener("click", () => $("#import-config-file").click());
  $("#import-config-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const settings = parsed.settings || parsed;
      let applied = 0;
      for (const [k, v] of Object.entries(settings)) {
        try { await apiJson(`/config/${k}`, { method: "PUT", body: JSON.stringify({ value: v }) }); applied++; }
        catch { /* unknown or invalid key — skipped */ }
      }
      toast(`Configuration imported — ${applied} settings applied.`);
      route();
    } catch { toast("That file is not a valid configuration JSON.", true); }
  });
};

/* ---------------- Data Protection ---------------- */
VIEWS.data = async (main) => {
  setScreen("data");
  const holds = has("legal.hold")
    ? await apiJson("/legal-holds").catch(() => ({ holds: [] })) : { holds: [] };
  const holdItems = (holds.holds || []).map(h => `
    <div class="side-item" style="margin-bottom:14px">
      <div class="si-title">⚖ ${esc("EVT-" + h.event_id.slice(0, 8).toUpperCase())} · ${esc(h.plate)}</div>
      <div class="si-sub">${esc(h.reason || "No reason recorded")} — held by ${esc(h.placed_by)}, ${fmtDateShort(h.placed_at)}</div>
      <button class="link-btn blue" data-release="${h.id}" type="button">Release this hold</button>
    </div>`).join("");
  main.innerHTML = `
  <div class="grid2">
    <section class="panel">
      <h3 class="panel-title">Legal holds</h3>
      <p class="panel-sub">Held events are excluded from the nightly purge, whatever their age (FR-DAT-03)</p>
      <div class="side-list">${holdItems || '<p class="foot-note">No events are under a legal hold right now.</p>'}</div>
      <div class="kbd-row">
        <button class="btn blue" id="d-place" type="button">Place a hold</button>
      </div>
      <p class="foot-note" style="margin-top:10px">Holds are placed from an event's detail screen. Releasing a hold needs a reason and is audited like placing one.</p>
    </section>
    ${has("privacy.manage") ? `
    <section class="panel">
      <h3 class="panel-title">Personal data requests (FR-DAT-06)</h3>
      <p class="panel-sub">On a documented request, export or erase one person's data</p>
      <div class="field"><label for="pe-plate">Person — plate</label>
        <input id="pe-plate" class="mono" placeholder="Search the registry by name or plate, then choose:"></div>
      <div class="field"><label for="pe-owner">Person — owner name contains</label>
        <input id="pe-owner"></div>
      <div class="filter-row">
        <button class="btn outline" id="pe-export" type="button" style="flex:1">Export their data</button>
        <button class="btn danger" id="pe-erase-open" type="button" style="flex:1">Erase their data…</button>
      </div>
      <div id="erase-slot"></div>
      <p class="foot-note" style="margin-top:14px">Erasure removes the personal fields (name, contact) from the registry. The person's events stay, anonymised — the gate record must remain truthful (UN-31). Events under legal hold are kept in anonymised form, as the law permits.</p>
      <p class="note-bold">Nothing is shared with third parties except by an audited action of an authorised user (LEG-02).</p>
    </section>` : ""}
  </div>
  <section class="panel" style="background:var(--surface-muted);border:0">
    <h3 class="panel-title">Nightly retention job (UC-23)</h3>
    <p class="foot-note" style="margin:0">The purge runs nightly: images past the image retention period and records past the record retention period are removed, except anything under a legal hold. The purge count is logged every night (FR-DAT-02); a failed job raises a Warning alert and retries.</p>
    ${has("config.manage") ? `<div class="kbd-row"><button class="btn navy" id="run-retention" type="button">Run retention purge now</button></div>
    <p id="retention-out" aria-live="polite" class="muted"></p>` : ""}
  </section>`;
  $$("button[data-release]", main).forEach(b => b.addEventListener("click", async () => {
    const reason = await askReason({
      title: "Release this legal hold?", label: "Reason *",
      sub: "Releasing a hold is audited like placing one. The event returns to the normal retention purge.",
      placeholder: "e.g. Investigation closed on 20 Nov",
      confirmText: "Release hold" });
    if (reason === null) return;
    try {
      await apiJson(`/legal-holds/${b.dataset.release}`, { method: "DELETE" });
      toast("Hold released."); route();
    } catch (ex) { toast(ex.message, true); }
  }));
  const place = $("#d-place");
  if (place) place.addEventListener("click", () => go("events"));
  const peExp = $("#pe-export");
  if (peExp) peExp.addEventListener("click", async () => {
    const r = await apiJson("/privacy/export", { method: "POST", body: JSON.stringify({
      plate: $("#pe-plate").value, owner_name: $("#pe-owner").value }) });
    downloadBlob(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }), "personal-data-export.json");
    toast("Export downloaded. The export itself is recorded in the audit log.");
  });
  const peErase = $("#pe-erase-open");
  if (peErase) peErase.addEventListener("click", () => {
    $("#erase-slot").innerHTML = `
      <form id="privacy-erase" class="filter-row" style="align-items:end;margin-top:6px">
        <div class="field"><label for="px-id">Registry record ID</label><input id="px-id" class="mono"></div>
        <button class="btn danger" type="submit">Erase personal data</button>
      </form><p id="erase-out" aria-live="polite"></p>`;
    $("#privacy-erase").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!confirm("Erase this person's personal data? Events remain, anonymised. This is audited.")) return;
      try {
        const r = await apiJson("/privacy/erase", { method: "POST", body: JSON.stringify({ vehicle_id: $("#px-id").value.trim() }) });
        $("#erase-out").textContent = r.note;
      } catch (ex) { $("#erase-out").innerHTML = `<span class="error">${esc(ex.message)}</span>`; }
    });
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
