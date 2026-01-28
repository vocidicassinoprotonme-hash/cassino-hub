/* Cassino Hub - admin.js (root) */
const $ = (id) => document.getElementById(id);

const LS = {
  API_BASE: "ch_apiBase_admin",
  ADMIN_KEY: "ch_adminKey",
  GH_TOKEN: "ch_ghToken",
  GH_REPO: "ch_ghRepo",
  GH_BRANCH: "ch_ghBranch",
};

const DEFAULT_API_BASE = "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev";

const STATE = {
  apiBase: "",
  adminKey: "",
  ghToken: "",
  ghRepo: "",
  ghBranch: "main",

  // Segnalazioni (Worker API)
  reports: [],

  // Dataset (GitHub)
  places: [],
  reviews: [],
  contentLoadedOnce: false,

  // Map
  map: null,
  mapMarkers: [],
};

function nowISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function load(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

function setConnStatus(kind, ok, msg) {
  const dot = kind === "api" ? $("dotApi") : $("dotGh");
  if (dot) {
    dot.classList.remove("ok", "bad", "warn");
    dot.classList.add(ok ? "ok" : "bad");
  }
  if ($("statusText")) $("statusText").textContent = msg || (ok ? "ok" : "errore");
}

function setApiStatus(msg) {
  const el = $("apiStatus");
  if (el) el.textContent = msg || "";
}
function setGhStatus(msg) {
  const el = $("ghStatus");
  if (el) el.textContent = msg || "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

function getApiBase() {
  const stored = ($("apiBase")?.value || "").trim();
  return (stored || DEFAULT_API_BASE).replace(/\/$/, "");
}

function getAdminKey() {
  return ($("adminKey")?.value || "").trim();
}

async function apiFetch(path, opts = {}) {
  const base = getApiBase();
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(opts.headers || {});
  const ak = getAdminKey();
  if (ak) headers.set("x-admin-key", ak);

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const errMsg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return data;
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      const el = $("view-" + view);
      if (el) el.classList.add("active");

      if (view === "map") {
        ensureMap();
        renderMap();
      }
    });
  });
}

function setupSettings() {
  $("btnSaveSettings")?.addEventListener("click", () => {
    STATE.apiBase = ($("apiBase")?.value || "").trim();
    STATE.adminKey = ($("adminKey")?.value || "").trim();
    STATE.ghToken = ($("ghToken")?.value || "").trim();
    STATE.ghRepo = ($("ghRepo")?.value || "").trim();
    STATE.ghBranch = ($("ghBranch")?.value || "main").trim() || "main";

    save(LS.API_BASE, STATE.apiBase);
    save(LS.ADMIN_KEY, STATE.adminKey);
    save(LS.GH_TOKEN, STATE.ghToken);
    save(LS.GH_REPO, STATE.ghRepo);
    save(LS.GH_BRANCH, STATE.ghBranch);

    setApiStatus("✅ Impostazioni salvate");
  });

  $("btnTestApi")?.addEventListener("click", testApi);
  $("btnTestGh")?.addEventListener("click", testGh);

  // Load stored settings
  $("apiBase").value = load(LS.API_BASE, DEFAULT_API_BASE);
  $("adminKey").value = load(LS.ADMIN_KEY, "");
  $("ghToken").value = load(LS.GH_TOKEN, "");
  $("ghRepo").value = load(LS.GH_REPO, "vocidicassinoprotonme-hash/cassino-hub");
  $("ghBranch").value = load(LS.GH_BRANCH, "main");

  STATE.apiBase = $("apiBase").value;
  STATE.adminKey = $("adminKey").value;
  STATE.ghToken = $("ghToken").value;
  STATE.ghRepo = $("ghRepo").value;
  STATE.ghBranch = $("ghBranch").value;
}

async function testApi() {
  try {
    setApiStatus("Test API…");
    // endpoint leggero (se esiste)
    const base = getApiBase();
    const res = await fetch(base + "/health", { cache: "no-store" });
    if (res.ok) {
      setConnStatus("api", true, "API ok");
      setApiStatus("✅ API raggiungibile");
    } else {
      // se /health non esiste, testiamo con /list
      await apiFetch(`/list?status=all&limit=1`);
      setConnStatus("api", true, "API ok");
      setApiStatus("✅ API ok (test su /list)");
    }
  } catch (e) {
    setConnStatus("api", false, "API KO");
    setApiStatus("❌ " + (e.message || e));
  }
}

async function testGh() {
  try {
    setGhStatus("Test GitHub…");
    const url = getGitHubRawURL("data/places.json");
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("places.json non è un array");
    setConnStatus("gh", true, "GitHub ok");
    setGhStatus("✅ GitHub ok (places.json letto)");
  } catch (e) {
    setConnStatus("gh", false, "GitHub KO");
    setGhStatus("❌ " + (e.message || e));
  }
}

async function loadReports() {
  try {
    const status = ($("reportStatus")?.value || "all").trim();
    const limit = Number(($("reportLimit")?.value || 100));
    setApiStatus("Caricamento segnalazioni…");
    const data = await apiFetch(`/list?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`);
    STATE.reports = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    renderReports();
    setApiStatus(`✅ Caricate ${STATE.reports.length} segnalazioni`);
    setConnStatus("api", true, "API ok");
  } catch (e) {
    setConnStatus("api", false, "API KO");
    setApiStatus("❌ " + (e.message || e));
  }
}

function renderReports() {
  const wrap = $("reportList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!STATE.reports.length) {
    wrap.innerHTML = `<div class="card"><div class="small">Nessuna segnalazione trovata.</div></div>`;
    return;
  }

  STATE.reports.forEach((r) => {
    const title = escapeHtml(r.title || "(senza titolo)");
    const desc = escapeHtml(r.description || "");
    const st = escapeHtml(r.status || "pending");
    const when = escapeHtml(r.created_at || r.createdAt || "");
    const lat = r.lat ?? r.latitude;
    const lng = r.lng ?? r.longitude;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${title}</h3>
      <div class="small">${desc}</div>
      <div class="meta">
        <span class="tag"><b>stato</b> ${st}</span>
        ${when ? `<span class="tag"><b>data</b> ${when}</span>` : ""}
        ${(typeof lat === "number" && typeof lng === "number") ? `<span class="tag"><b>gps</b> ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>` : ""}
      </div>
    `;
    wrap.appendChild(card);
  });
}

function renderContentTabs() {
  renderPlaces();
  renderReviews();
}

function renderPlaces() {
  const wrap = $("placesList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!STATE.places.length) {
    wrap.innerHTML = `<div class="card"><div class="small">Nessun place caricato. Premi “Carica Places/Reviews da GitHub”.</div></div>`;
    return;
  }

  STATE.places.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escapeHtml(p.name || "(senza nome)")}</h3>
      <div class="small">${escapeHtml(p.description || "")}</div>
      <div class="meta">
        <span class="tag"><b>cat</b> ${escapeHtml(p.category || "-")}</span>
        ${(typeof p.lat === "number" && typeof p.lng === "number") ? `<span class="tag"><b>gps</b> ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>` : ""}
        ${p.id ? `<span class="tag"><b>id</b> ${escapeHtml(p.id)}</span>` : ""}
      </div>
    `;
    wrap.appendChild(card);
  });
}

function renderReviews() {
  const wrap = $("reviewsList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!STATE.reviews.length) {
    wrap.innerHTML = `<div class="card"><div class="small">Nessuna review caricata. Premi “Carica Places/Reviews da GitHub”.</div></div>`;
    return;
  }

  STATE.reviews.forEach((r) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escapeHtml(r.title || r.placeName || "(review)")}</h3>
      <div class="small">${escapeHtml(r.text || r.comment || "")}</div>
      <div class="meta">
        ${r.placeId ? `<span class="tag"><b>placeId</b> ${escapeHtml(r.placeId)}</span>` : ""}
        ${typeof r.rating === "number" ? `<span class="tag"><b>rating</b> ${escapeHtml(r.rating)}</span>` : ""}
        ${r.createdAt ? `<span class="tag"><b>data</b> ${escapeHtml(r.createdAt)}</span>` : ""}
      </div>
    `;
    wrap.appendChild(card);
  });
}

function ensureMap() {
  if (STATE.map) return;
  STATE.map = L.map("map", { zoomControl: true }).setView([41.49, 13.83], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(STATE.map);
}

function clearMapMarkers() {
  STATE.mapMarkers.forEach(m => m.remove());
  STATE.mapMarkers = [];
}

function renderMap() {
  if (!STATE.map) return;
  clearMapMarkers();

  const legend = $("mapLegend");
  if (legend) legend.innerHTML = "";

  // Places markers
  let countPlaces = 0;
  STATE.places.forEach((p) => {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
    const m = L.marker([p.lat, p.lng]).addTo(STATE.map)
      .bindPopup(`<b>${escapeHtml(p.name || "")}</b><br>${escapeHtml(p.category || "")}`);
    STATE.mapMarkers.push(m);
    countPlaces++;
  });

  // Reports markers
  let countReports = 0;
  STATE.reports.forEach((r) => {
    const lat = r.lat ?? r.latitude;
    const lng = r.lng ?? r.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    const m = L.circleMarker([lat, lng], { radius: 7 }).addTo(STATE.map)
      .bindPopup(`<b>${escapeHtml(r.title || "Segnalazione")}</b><br>${escapeHtml(r.status || "")}`);
    STATE.mapMarkers.push(m);
    countReports++;
  });

  if (legend) {
    legend.innerHTML = `
      <div class="card">
        <div class="meta">
          <span class="tag"><b>places</b> ${countPlaces}</span>
          <span class="tag"><b>segnalazioni</b> ${countReports}</span>
        </div>
        <div class="small" style="margin-top:8px;">La mappa mostra i places dal dataset GitHub e le segnalazioni con coordinate dall’API.</div>
      </div>
    `;
  }
}

function setupActions() {
  $("btnLoadReports")?.addEventListener("click", loadReports);
  $("btnRefreshReports")?.addEventListener("click", loadReports);

  $("btnLoadContent")?.addEventListener("click", () => loadContentFromGitHub());
  $("btnPublishGithub")?.addEventListener("click", publishToGithub);
}

/* -------------------------
   GitHub RAW + Publish
-------------------------- */

function getGitHubRawURL(path) {
  const repo = (STATE.ghRepo || "").trim();
  const branch = ($("ghBranch")?.value || "main").trim();
  if (!repo) throw new Error("Repo GitHub mancante (es: vocidicassinoprotonme-hash/cassino-hub)");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`.replace(/\s+/g, "");
}

async function ensureContentLoaded() {
  if (STATE.contentLoadedOnce) return;
  await loadContentFromGitHub();
}

async function loadContentFromGitHub() {
  // Carica i file pubblici dal repo (non serve token)
  try {
    const placesUrl = getGitHubRawURL("data/places.json");
    const reviewsUrl = getGitHubRawURL("data/reviews.json");

    setGhStatus("Caricamento places/reviews da GitHub…");

    const [pRes, rRes] = await Promise.all([
      fetch(placesUrl, { cache: "no-store" }),
      fetch(reviewsUrl, { cache: "no-store" })
    ]);

    if (!pRes.ok) throw new Error(`Errore places.json: HTTP ${pRes.status}`);
    if (!rRes.ok) throw new Error(`Errore reviews.json: HTTP ${rRes.status}`);

    const places = await pRes.json();
    const reviews = await rRes.json();

    if (!Array.isArray(places)) throw new Error("places.json non è un array JSON");
    if (!Array.isArray(reviews)) throw new Error("reviews.json non è un array JSON");

    STATE.places = places;
    STATE.reviews = reviews;

    STATE.contentLoadedOnce = true;

    renderContentTabs();
    setConnStatus("gh", true, "GitHub ok");
    setGhStatus(`Caricati da GitHub: ${STATE.places.length} places, ${STATE.reviews.length} reviews`);
  } catch (e) {
    setConnStatus("gh", false, "GitHub KO");
    setGhStatus(`Errore caricamento GitHub: ${e.message || e}`);
    console.error(e);
  }
}

/* GitHub API (serve token per PUT) */
async function ghApi(path, opts = {}) {
  const url = `https://api.github.com${path}`;
  const headers = new Headers(opts.headers || {});
  headers.set("Accept", "application/vnd.github+json");
  if (STATE.ghToken) headers.set("Authorization", `Bearer ${STATE.ghToken}`);
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function ghGetFile(path) {
  const repo = (STATE.ghRepo || "").trim();
  const branch = ($("ghBranch")?.value || "main").trim() || "main";
  const data = await ghApi(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
  return data;
}

async function ghPutFile(path, contentText, message, sha = null) {
  const repo = (STATE.ghRepo || "").trim();
  const branch = ($("ghBranch")?.value || "main").trim() || "main";
  const b64 = btoa(unescape(encodeURIComponent(contentText)));

  const body = {
    message,
    content: b64,
    branch,
  };
  if (sha) body.sha = sha;

  return await ghApi(`/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function publishToGithub() {
  try {
    if (!STATE.ghToken) throw new Error("GitHub Token mancante");
    if (!STATE.ghRepo) throw new Error("Repo GitHub mancante (es: vocidicassinoprotonme-hash/cassino-hub)");

    const msg = `Update places/reviews ${nowISO()}`;

    setGhStatus("Leggo SHA attuali…");
    const placesInfo = await ghGetFile("data/places.json");
    const reviewsInfo = await ghGetFile("data/reviews.json");
    const placesSha = placesInfo?.sha || null;
    const reviewsSha = reviewsInfo?.sha || null;

    setGhStatus("Pubblicazione su GitHub in corso…");

    const placesText = JSON.stringify(STATE.places, null, 2) + "\n";
    const reviewsText = JSON.stringify(STATE.reviews, null, 2) + "\n";

    await ghPutFile("data/places.json", placesText, msg, placesSha);
    await ghPutFile("data/reviews.json", reviewsText, msg, reviewsSha);

    setConnStatus("gh", true, "GitHub ok");
    setGhStatus("✅ Pubblicato su GitHub (places.json + reviews.json)");
  } catch (e) {
    setConnStatus("gh", false, "GitHub KO");
    setGhStatus(`❌ Pubblicazione fallita: ${e.message || e}`);
    console.error(e);
  }
}

(function init() {
  setupTabs();
  setupSettings();
  setupActions();

  // Stato iniziale
  setConnStatus("api", false, "API?");
  setConnStatus("gh", false, "GitHub?");

  // Pre-carica (non obbligatorio)
  setApiStatus("Pronto.");
  setGhStatus("Pronto.");

  // Se vuoi: carica subito i dataset GitHub
  // loadContentFromGitHub();
})();
