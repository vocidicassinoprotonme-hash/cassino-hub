/* Cassino Hub - admin.js (root) */

const $ = (id) => document.getElementById(id);

const LS = {
  API_BASE: "ch_admin_apiBase_v1",
  ADMIN_KEY: "ch_admin_adminKey_v1",
  GH_TOKEN: "ch_admin_ghToken_v1",
  GH_REPO: "ch_admin_ghRepo_v1",
  GH_BRANCH: "ch_admin_ghBranch_v1",
};

const DEFAULT_API_BASE = "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev";
const DEFAULT_GH_REPO = "vocidicassinoprotonme-hash/cassino-hub";
const DEFAULT_GH_BRANCH = "main";

const STATE = {
  places: [],
  reviews: [],
  reports: [],
};

// ------------------------
// LocalStorage helpers
// ------------------------
function lsGet(key, fallback = "") {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

// ------------------------
// UI helpers
// ------------------------
function setStatus(lines) {
  const box = $("statusBox");
  if (!box) return;

  box.innerHTML = "";
  for (const l of lines) {
    const line = document.createElement("div");
    line.className = "line";

    const dot = document.createElement("span");
    dot.className = "dot" + (l.type ? ` ${l.type}` : "");

    const txt = document.createElement("span");
    txt.textContent = l.text;

    line.appendChild(dot);
    line.appendChild(txt);
    box.appendChild(line);
  }
}

function safeTrim(v) {
  return (v || "").toString().trim();
}

function getApiBase() {
  const v = safeTrim($("apiBase")?.value);
  return (v || DEFAULT_API_BASE).replace(/\/+$/, "");
}
function getAdminKey() {
  return safeTrim($("adminKey")?.value);
}
function getGhToken() {
  return safeTrim($("ghToken")?.value);
}
function getGhRepo() {
  return safeTrim($("ghRepo")?.value) || DEFAULT_GH_REPO;
}
function getGhBranch() {
  return safeTrim($("ghBranch")?.value) || DEFAULT_GH_BRANCH;
}

function loadSettingsUI() {
  if ($("apiBase")) $("apiBase").value = lsGet(LS.API_BASE, DEFAULT_API_BASE);
  if ($("adminKey")) $("adminKey").value = lsGet(LS.ADMIN_KEY, "");
  if ($("ghToken")) $("ghToken").value = lsGet(LS.GH_TOKEN, "");
  if ($("ghRepo")) $("ghRepo").value = lsGet(LS.GH_REPO, DEFAULT_GH_REPO);
  if ($("ghBranch")) $("ghBranch").value = lsGet(LS.GH_BRANCH, DEFAULT_GH_BRANCH);
}

function saveSettingsUI() {
  lsSet(LS.API_BASE, getApiBase());
  lsSet(LS.ADMIN_KEY, getAdminKey());
  lsSet(LS.GH_TOKEN, getGhToken());
  lsSet(LS.GH_REPO, getGhRepo());
  lsSet(LS.GH_BRANCH, getGhBranch());
}

// ------------------------
// Auth headers / API fetch
// ------------------------
function buildAdminHeaders() {
  const k = getAdminKey();
  const h = {};
  if (k) {
    // Worker spesso usa uno di questi due
    h["X-Admin-Key"] = k;
    h["Authorization"] = `Bearer ${k}`;
  }
  return h;
}

/**
 * Esegue fetch al Worker.
 * - mette la key in header
 * - e anche in query (?ak=...&adminKey=...)
 */
async function apiFetch(path, opts = {}) {
  const base = getApiBase();
  const url = new URL(base + path);

  const k = getAdminKey();
  if (k) {
    url.searchParams.set("ak", k);
    url.searchParams.set("adminKey", k);
  }

  const headers = {
    ...(opts.headers || {}),
    ...buildAdminHeaders(),
  };

  const res = await fetch(url.toString(), { ...opts, headers });
  const ctype = (res.headers.get("content-type") || "").toLowerCase();

  let body;
  if (ctype.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.text().catch(() => "");
  }

  return { res, body, url: url.toString() };
}

// prova endpoint in ordine finché uno risponde ok
async function tryApiEndpoints(candidates, method = "GET") {
  for (const p of candidates) {
    const out = await apiFetch(p, { method });
    if (out.res.ok) return { ok: true, ...out, path: p };
  }
  // se nessuno ok, ritorna l'ultimo tentativo per vedere status e body
  const last = await apiFetch(candidates[candidates.length - 1], { method });
  return { ok: false, ...last, path: candidates[candidates.length - 1] };
}

// ------------------------
// Render helpers (solo conteggi + lista semplice)
// ------------------------
function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function renderList(container, items, kind) {
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<div class="item"><h3>Nessun elemento</h3><p>Vuoto.</p></div>`;
    return;
  }

  for (const it of items) {
    const el = document.createElement("div");
    el.className = "item";

    if (kind === "places") {
      el.innerHTML = `
        <div class="t">
          <h3>${esc(it.name || it.title || "Senza nome")}</h3>
          <small>${esc(it.category || "")} ${esc(it.id || "")}</small>
        </div>
        <p>${esc(it.description || "")}</p>
        <p><small>lat: ${esc(it.lat)} • lng: ${esc(it.lng)}</small></p>
      `;
    } else if (kind === "reviews") {
      el.innerHTML = `
        <div class="t">
          <h3>${esc(it.title || it.placeName || "Recensione")}</h3>
          <small>${esc(it.id || "")}</small>
        </div>
        <p>${esc(it.text || it.comment || "")}</p>
        <p><small>rating: ${esc(it.rating ?? "")} • placeId: ${esc(it.placeId ?? "")}</small></p>
      `;
    } else {
      el.innerHTML = `
        <div class="t">
          <h3>${esc(it.title || "Segnalazione")}</h3>
          <small>${esc(it.id || "")}</small>
        </div>
        <p>${esc(it.description || it.text || "")}</p>
        <p><small>${esc(it.createdAt || it.date || "")}</small></p>
      `;
    }

    container.appendChild(el);
  }
}

// ------------------------
// GitHub helpers
// ------------------------
function ghHeaders() {
  const t = getGhToken();
  const h = { "Accept": "application/vnd.github+json" };
  if (t) h["Authorization"] = `token ${t}`;
  return h;
}

// carica JSON da Pages se c’è, altrimenti raw
async function ghLoadJson(path) {
  const repo = getGhRepo();
  const branch = getGhBranch();
  const [owner, name] = repo.split("/");

  const pagesUrl = `https://${owner}.github.io/${name}/${path}`;
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`;

  // 1) Pages
  let r = await fetch(pagesUrl, { cache: "no-store" }).catch(() => null);
  if (r && r.ok) return await r.json();

  // 2) Raw
  r = await fetch(rawUrl, { cache: "no-store" });
  if (!r.ok) throw new Error(`GitHub RAW ${r.status}`);
  return await r.json();
}

// salva file su GitHub via Contents API
async function ghPutFile(path, contentText, message) {
  const repo = getGhRepo();
  const branch = getGhBranch();
  const [owner, name] = repo.split("/");

  const apiUrl = `https://api.github.com/repos/${owner}/${name}/contents/${path}`;

  // leggi sha se esiste
  let sha = null;
  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders() }).catch(() => null);
  if (getRes && getRes.ok) {
    const j = await getRes.json();
    sha = j.sha;
  }

  const payload = {
    message: message || "Update dataset",
    content: btoa(unescape(encodeURIComponent(contentText))),
    branch,
  };
  if (sha) payload.sha = sha;

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    throw new Error(`GitHub PUT ${putRes.status}: ${t.slice(0, 200)}`);
  }

  return await putRes.json();
}

// ------------------------
// Actions
// ------------------------
async function testApi() {
  setStatus([{ type:"warn", text:"Test API in corso..." }]);

  // endpoint realistici (include quelli che tu hai già visto: /public/places)
  const candidates = [
    "/health",
    "/ping",
    "/public/places",
    "/public/reviews",
    "/places",
    "/reviews",
    "/list",
  ];

  try {
    const out = await tryApiEndpoints(candidates, "GET");

    if (!out.ok) {
      setStatus([
        { type:"bad", text:`Test API FALLITO (HTTP ${out.res.status}).` },
        { type:"bad", text:`Endpoint provato: ${out.path}` },
        { type:"bad", text:`URL: ${out.url}` },
        { type:"bad", text:`Risposta: ${typeof out.body === "string" ? out.body.slice(0,160) : JSON.stringify(out.body).slice(0,160)}` },
      ]);
      return;
    }

    setStatus([
      { type:"ok", text:`API OK (HTTP ${out.res.status})` },
      { type:"ok", text:`Endpoint: ${out.path}` },
      { type:"ok", text:`URL: ${out.url}` },
      { type:"ok", text:`Body: ${typeof out.body === "string" ? out.body.slice(0,120) : "JSON"}` },
    ]);
  } catch (e) {
    setStatus([{ type:"bad", text:`Errore Test API: ${e.message}` }]);
  }
}

async function loadReportsFromApi() {
  setStatus([{ type:"warn", text:"Carico segnalazioni (API)..." }]);

  // qui non sappiamo il tuo endpoint esatto: proviamo varie strade comuni
  const candidates = [
    "/admin/reports",
    "/reports",
    "/admin/list",
    "/list",
  ];

  try {
    const out = await tryApiEndpoints(candidates, "GET");

    if (!out.ok) {
      setStatus([
        { type:"bad", text:`Segnalazioni: HTTP ${out.res.status}` },
        { type:"bad", text:`Endpoint: ${out.path}` },
        { type:"bad", text:`Risposta: ${typeof out.body === "string" ? out.body.slice(0,160) : JSON.stringify(out.body).slice(0,160)}` },
      ]);
      return;
    }

    // normalizziamo possibili formati
    const data = Array.isArray(out.body) ? out.body : (out.body?.data || out.body?.items || []);
    STATE.reports = Array.isArray(data) ? data : [];
    setStatus([{ type:"ok", text:`Segnalazioni caricate: ${STATE.reports.length}` }]);
  } catch (e) {
    setStatus([{ type:"bad", text:`Errore segnalazioni: ${e.message}` }]);
  }
}

async function loadPlacesReviewsFromApi() {
  setStatus([{ type:"warn", text:"Carico places/reviews da API..." }]);

  try {
    // PLACES
    const pOut = await tryApiEndpoints(
      ["/public/places", "/places", "/data/places", "/public/data/places", "/public/places.json"],
      "GET"
    );

    if (!pOut.ok) {
      setStatus([
        { type:"bad", text:`Places: HTTP ${pOut.res.status}` },
        { type:"bad", text:`Endpoint: ${pOut.path}` },
      ]);
      return;
    }

    const places = Array.isArray(pOut.body) ? pOut.body : (pOut.body?.data || pOut.body?.items || []);
    STATE.places = Array.isArray(places) ? places : [];

    // REVIEWS
    const rOut = await tryApiEndpoints(
      ["/public/reviews", "/reviews", "/data/reviews", "/public/data/reviews", "/public/reviews.json"],
      "GET"
    );

    if (!rOut.ok) {
      setStatus([
        { type:"bad", text:`Reviews: HTTP ${rOut.res.status}` },
        { type:"bad", text:`Endpoint: ${rOut.path}` },
      ]);
      return;
    }

    const reviews = Array.isArray(rOut.body) ? rOut.body : (rOut.body?.data || rOut.body?.items || []);
    STATE.reviews = Array.isArray(reviews) ? reviews : [];

    // render se esistono container
    renderList($("placesList"), STATE.places, "places");
    renderList($("reviewsList"), STATE.reviews, "reviews");

    setStatus([
      { type:"ok", text:`Caricati da API: ${STATE.places.length} places, ${STATE.reviews.length} reviews` },
    ]);
  } catch (e) {
    setStatus([{ type:"bad", text:`Errore API places/reviews: ${e.message}` }]);
  }
}

async function testGitHub() {
  setStatus([{ type:"warn", text:"Test GitHub in corso..." }]);

  try {
    const repo = getGhRepo();
    const [owner, name] = repo.split("/");
    const r = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers: ghHeaders() });

    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    setStatus([{ type:"ok", text:`GitHub OK: ${j.full_name}` }]);
  } catch (e) {
    setStatus([{ type:"bad", text:`Errore GitHub: ${e.message}` }]);
  }
}

async function loadGhData() {
  setStatus([{ type:"warn", text:"Carico places/reviews da GitHub..." }]);

  try {
    const places = await ghLoadJson("data/places.json");
    const reviews = await ghLoadJson("data/reviews.json");

    STATE.places = Array.isArray(places) ? places : [];
    STATE.reviews = Array.isArray(reviews) ? reviews : [];

    renderList($("placesList"), STATE.places, "places");
    renderList($("reviewsList"), STATE.reviews, "reviews");

    setStatus([{ type:"ok", text:`Caricati da GitHub: ${STATE.places.length} places, ${STATE.reviews.length} reviews` }]);
  } catch (e) {
    setStatus([{ type:"bad", text:`Errore GitHub data: ${e.message}` }]);
  }
}

async function publishToGitHub() {
  setStatus([{ type:"warn", text:"Pubblico su GitHub (data/places.json + data/reviews.json)..." }]);

  try {
    // Se non hai ancora caricato nulla in memoria, prima prova a prenderli dall’API
    if (!STATE.places.length || !STATE.reviews.length) {
      setStatus([{ type:"warn", text:"Dataset in memoria vuoto: provo prima a caricarli da API..." }]);
      await loadPlacesReviewsFromApi();
    }

    if (!STATE.places.length && !STATE.reviews.length) {
      throw new Error("Nessun dataset disponibile (né da API né in memoria).");
    }

    const placesText = JSON.stringify(STATE.places, null, 2);
    const reviewsText = JSON.stringify(STATE.reviews, null, 2);

    await ghPutFile("data/places.json", placesText, "Update places dataset");
    await ghPutFile("data/reviews.json", reviewsText, "Update reviews dataset");

    setStatus([{ type:"ok", text:"Pubblicazione OK ✅ (controlla GitHub Pages /raw)." }]);
  } catch (e) {
    setStatus([{ type:"bad", text:`Errore pubblicazione: ${e.message}` }]);
  }
}

// ------------------------
// Tabs (se ci sono)
// ------------------------
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  if (!tabs.length) return;

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const v = btn.dataset.view;
      const vp = $("view_places");
      const vr = $("view_reviews");
      const vm = $("view_map");

      if (vp) vp.style.display = v === "places" ? "" : "none";
      if (vr) vr.style.display = v === "reviews" ? "" : "none";
      if (vm) vm.style.display = v === "map" ? "" : "none";
    });
  });
}

// ------------------------
// Wire up
// ------------------------
function wire() {
  loadSettingsUI();
  setupTabs();

  $("btnSave")?.addEventListener("click", () => {
    saveSettingsUI();
    setStatus([{ type:"ok", text:"Impostazioni salvate ✅" }]);
  });

  $("btnTestApi")?.addEventListener("click", testApi);
  $("btnTestGh")?.addEventListener("click", testGitHub);

  $("btnLoadReports")?.addEventListener("click", loadReportsFromApi);
  $("btnLoadGhData")?.addEventListener("click", loadGhData);

  // Se nel tuo admin.html vuoi un bottone per caricare da API places/reviews,
  // puoi aggiungerlo e collegarlo a questa funzione:
  // loadPlacesReviewsFromApi()
  // (Io per ora lo uso internamente prima della publish)

  $("btnPublish")?.addEventListener("click", publishToGitHub);

  setStatus([{ type:"ok", text:"Pronto. Premi Salva, poi Test API e Test GitHub." }]);
}

document.addEventListener("DOMContentLoaded", wire);
