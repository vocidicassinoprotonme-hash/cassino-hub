/* Cassino Hub Admin (D1-first)
   - Reports: legge /list e aggiorna /admin/update (con admin key)
   - Places/Reviews: legge da /admin/places /admin/reviews (con admin key) oppure fallback /public/*
   - In questa versione "Pubblica su GitHub" è disattivato (fonte dati = D1 via Worker)
*/

const STATE = {
  apiBase: "",
  adminKey: "",
  ghToken: "",
  ghRepo: "",
  reports: [],
  places: [],
  reviews: [],
  reportMap: null,
  editorMap: null,
  contentLoadedOnce: false,
};

const $ = (id) => document.getElementById(id);

// =======================
// UI helpers
// =======================
function setStatus(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg || "";
}

function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function oneLine(s, max = 120) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function uid() {
  return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function parseMaybeNumber(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function invalidateMap(map) {
  if (!map) return;
  setTimeout(() => map.invalidateSize(true), 50);
}

// =======================
// Config (localStorage)
// =======================
function bootSettings() {
  const saved = JSON.parse(localStorage.getItem("cassinoAdminCfg") || "{}");
  STATE.apiBase = saved.apiBase || "";
  STATE.adminKey = saved.adminKey || "";

  $("apiBase").value = STATE.apiBase;
  $("adminKey").value = STATE.adminKey;

  setStatus("cfgStatus", "Config caricata.");
}

function saveSettings() {
  STATE.apiBase = ($("apiBase").value || "").trim().replace(/\/+$/, "");
  STATE.adminKey = ($("adminKey").value || "").trim();

  localStorage.setItem("cassinoAdminCfg", JSON.stringify({
    apiBase: STATE.apiBase,
    adminKey: STATE.adminKey
  }));

  setStatus("cfgStatus", "Salvato ✅");
}

// =======================
// Tabs
// =======================
function setupTopTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const views = {
    reports: $("viewReports"),
    places: $("viewPlaces"),
    reviews: $("viewReviews"),
  };

  function activate(view) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.view === view));
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== view));
    $("detailEmpty").classList.remove("hidden");
    $("detailReport").classList.add("hidden");
    $("detailEditor").classList.add("hidden");

    if (view === "places") renderPlacesAdmin();
    if (view === "reviews") renderReviewsAdmin();
  }

  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.view)));
}

// =======================
// API fetch wrapper
// =======================
async function apiFetch(path, opts = {}) {
  const base = ($("apiBase")?.value || STATE.apiBase || "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, error: "API Base mancante" };

  const url = base + path;

  const headers = new Headers(opts.headers || {});
  // Se non specificato, invio admin key come header (meglio che metterla in URL).
  if (!headers.has("X-Admin-Key") && STATE.adminKey) headers.set("X-Admin-Key", STATE.adminKey);

  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return { ok: false, error: data?.error || data || `${res.status} ${res.statusText}` };
  }
  return data;
}

// =======================
// REPORTS
// =======================
async function loadReports() {
  setStatus("repStatusText", "Carico segnalazioni…");

  // qui serve admin key (header)
  const data = await apiFetch(`/list`);
  if (!data.ok) {
    setStatus("repStatusText", "Errore: " + data.error);
    return;
  }

  STATE.reports = data.rows || [];
  setStatus("repStatusText", `OK • ${STATE.reports.length} segnalazioni`);
  updateKpi();
  renderReportsList();
}

function renderReportsList() {
  const root = $("reportsList");
  if (!root) return;
  root.innerHTML = "";

  const wantStatus = $("repStatus")?.value || "all";
  const rows = (STATE.reports || []).filter(r => wantStatus === "all" ? true : (r.status === wantStatus));

  if (!rows.length) {
    root.innerHTML = `<p class="muted">Nessuna segnalazione per questo filtro.</p>`;
    return;
  }

  rows.forEach(r => {
    const el = document.createElement("div");
    el.className = "item";
    const badge = r.status === "new" ? "warn" : (r.status === "open" ? "ok" : "danger");
    el.innerHTML = `
      <div class="badges">
        <span class="badge ${badge}">${escapeHTML(r.status || "")}</span>
        ${r.photoKey ? `<span class="badge">📷</span>` : ``}
      </div>
      <h4>${escapeHTML(oneLine(r.title, 70))}</h4>
      <p class="muted">${escapeHTML(oneLine(r.description, 120))}</p>
    `;
    el.addEventListener("click", () => openReport(r.id));
    root.appendChild(el);
  });
}

function openReport(id) {
  const r = STATE.reports.find(x => x.id === id);
  if (!r) return;

  $("detailEmpty").classList.add("hidden");
  $("detailEditor").classList.add("hidden");
  $("detailReport").classList.remove("hidden");

  // badges
  const badge = r.status === "new" ? "warn" : (r.status === "open" ? "ok" : "danger");
  $("repBadges").innerHTML = `
    <span class="badge ${badge}">${escapeHTML(r.status || "")}</span>
    ${r.photoKey ? `<span class="badge">📷</span>` : ``}
    ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
  `;

  $("repTitle").textContent = r.title || "";
  $("repMeta").textContent = `ID: ${r.id} • ${r.createdAt || ""}`;
  $("repDesc").textContent = r.description || "";

  $("repEditStatus").value = r.status || "new";
  $("repTags").value = r.tags || "";
  $("repNote").value = r.adminNote || "";
  $("repReply").value = r.adminReply || "";

  // map
  if (!STATE.reportMap) {
    STATE.reportMap = L.map("mapReport", { zoomControl: true }).setView([41.49, 13.83], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(STATE.reportMap);
  }

  // reset layers
  STATE.reportMap.eachLayer(layer => {
    if (layer instanceof L.Marker) STATE.reportMap.removeLayer(layer);
  });

  if (isNum(r.lat) && isNum(r.lng)) {
    const m = L.marker([r.lat, r.lng]).addTo(STATE.reportMap);
    m.bindPopup(escapeHTML(r.title || "Segnalazione"));
    STATE.reportMap.setView([r.lat, r.lng], 16);
  } else {
    STATE.reportMap.setView([41.49, 13.83], 12);
  }
  invalidateMap(STATE.reportMap);

  // photo
  const box = $("repPhotoBox");
  if (r.photoUrl) {
    box.innerHTML = `<a class="btn small acc" target="_blank" href="${escapeHTML(r.photoUrl)}">Apri foto</a>`;
  } else {
    box.textContent = "Nessuna foto";
  }

  setStatus("repSaveStatus", "");
  $("btnSaveReport").onclick = () => saveReportEdits(r.id);
}

async function saveReportEdits(id) {
  setStatus("repSaveStatus", "Salvo…");

  const payload = {
    id,
    status: $("repEditStatus").value,
    tags: $("repTags").value,
    adminNote: $("repNote").value,
    adminReply: $("repReply").value,
  };

  const res = await apiFetch(`/admin/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    setStatus("repSaveStatus", "Errore: " + res.error);
    return;
  }

  // aggiorna in memoria
  const idx = STATE.reports.findIndex(x => x.id === id);
  if (idx >= 0) {
    STATE.reports[idx] = { ...STATE.reports[idx], ...res };
  }

  setStatus("repSaveStatus", "Salvato ✅");
  renderReportsList();
}

// =======================
// PLACES / REVIEWS EDITOR
// =======================
let EDIT_MODE = null; // "places" | "reviews"
let EDIT_ID = null;

function wireCoreButtons() {
  $("btnSaveCfg").addEventListener("click", () => {
    saveSettings();
    updateKpi();
  });

  $("btnLoadReports").addEventListener("click", loadReports);
  $("repStatus").addEventListener("change", renderReportsList);

  $("btnLoadContent").addEventListener("click", async () => {
    await loadContentFromApi();
  });
  $("btnLoadContent2").addEventListener("click", async () => {
    await loadContentFromApi();
  });

  $("btnNewPlace").addEventListener("click", () => openEditor("places"));
  $("btnNewReview").addEventListener("click", () => openEditor("reviews"));

  $("btnCloseEditor").addEventListener("click", closeEditor);
  $("btnSaveItem").addEventListener("click", saveEditorItem);
  $("btnDeleteItem").addEventListener("click", deleteEditorItem);

  $("btnPublish").addEventListener("click", publishToGithub);
}

// =======================
// KPIs
// =======================
function updateKpi() {
  $("kpiReports").textContent = `Reports: ${STATE.reports.length || 0}`;
  $("kpiPlaces").textContent = `Places: ${STATE.places.length || 0}`;
  $("kpiReviews").textContent = `Reviews: ${STATE.reviews.length || 0}`;
}

// =======================
// Editor open/close
// =======================
function openEditor(mode, id = null) {
  EDIT_MODE = mode;
  EDIT_ID = id;

  $("detailEmpty").classList.add("hidden");
  $("detailReport").classList.add("hidden");
  $("detailEditor").classList.remove("hidden");

  $("editorPlace").classList.toggle("hidden", mode !== "places");
  $("editorReview").classList.toggle("hidden", mode !== "reviews");

  $("edMode").textContent = mode === "places" ? "PLACE" : "REVIEW";
  $("edId").textContent = id ? `ID: ${id}` : "Nuovo elemento";
  setStatus("edStatus", "");

  // init map
  if (!STATE.editorMap) {
    STATE.editorMap = L.map("mapEditor", { zoomControl: true }).setView([41.49, 13.83], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(STATE.editorMap);
  }

  // clear marker layers
  STATE.editorMap.eachLayer(layer => {
    if (layer instanceof L.Marker) STATE.editorMap.removeLayer(layer);
  });

  if (mode === "places") {
    const p = id ? STATE.places.find(x => x.id === id) : null;
    $("edName").value = p?.name || "";
    $("edCat").value = p?.category || "posto";
    $("edDesc").value = p?.description || "";
    $("edLat").value = isNum(p?.lat) ? String(p.lat) : "";
    $("edLng").value = isNum(p?.lng) ? String(p.lng) : "";

    if (isNum(p?.lat) && isNum(p?.lng)) {
      L.marker([p.lat, p.lng]).addTo(STATE.editorMap);
      STATE.editorMap.setView([p.lat, p.lng], 16);
    } else {
      STATE.editorMap.setView([41.49, 13.83], 12);
    }
  } else {
    const r = id ? STATE.reviews.find(x => x.id === id) : null;
    $("edTitle").value = r?.title || "";
    $("edPlace").value = r?.place || "";
    $("edRating").value = r?.rating ? String(r.rating) : "5";
    $("edText").value = r?.text || "";
    $("edLat2").value = isNum(r?.lat) ? String(r.lat) : "";
    $("edLng2").value = isNum(r?.lng) ? String(r.lng) : "";

    if (isNum(r?.lat) && isNum(r?.lng)) {
      L.marker([r.lat, r.lng]).addTo(STATE.editorMap);
      STATE.editorMap.setView([r.lat, r.lng], 16);
    } else {
      STATE.editorMap.setView([41.49, 13.83], 12);
    }
  }

  invalidateMap(STATE.editorMap);
}

function closeEditor() {
  EDIT_MODE = null;
  EDIT_ID = null;

  $("detailEditor").classList.add("hidden");
  $("detailReport").classList.add("hidden");
  $("detailEmpty").classList.remove("hidden");
}

// =======================
// Save/Delete in memory
// =======================
function saveEditorItem() {
  if (!EDIT_MODE) return;

  if (EDIT_MODE === "reviews") {
    const rating = parseMaybeNumber($("edRating").value) ?? 5;
    const lat = parseMaybeNumber($("edLat2").value);
    const lng = parseMaybeNumber($("edLng2").value);

    const obj = {
      id: EDIT_ID || uid(),
      placeId: "",
      place: ($("edPlace").value || "").trim(),
      rating: Math.max(1, Math.min(5, Math.trunc(rating))),
      title: ($("edTitle").value || "").trim(),
      text: ($("edText").value || "").trim(),
      author: "Anonimo",
      createdAt: new Date().toISOString(),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    };

    if (!obj.title || !obj.text) {
      $("edStatus").textContent = "Titolo e testo sono obbligatori.";
      return;
    }

    if (EDIT_ID) {
      const idx = STATE.reviews.findIndex(x => x.id === EDIT_ID);
      if (idx >= 0) STATE.reviews[idx] = obj;
    } else {
      STATE.reviews.unshift(obj);
      EDIT_ID = obj.id;
    }

    $("edStatus").textContent = "Salvato in memoria ✅ (ora Pubblica su GitHub)";
    renderReviewsAdmin();
  } else {
    const lat = parseMaybeNumber($("edLat").value);
    const lng = parseMaybeNumber($("edLng").value);

    const obj = {
      id: EDIT_ID || uid(),
      name: ($("edName").value || "").trim(),
      category: (($("edCat").value || "").trim() || "posto"),
      description: ($("edDesc").value || "").trim(),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    };

    if (!obj.name || !obj.description) {
      $("edStatus").textContent = "Nome e descrizione sono obbligatori.";
      return;
    }

    if (EDIT_ID) {
      const idx = STATE.places.findIndex(x => x.id === EDIT_ID);
      if (idx >= 0) STATE.places[idx] = obj;
    } else {
      STATE.places.unshift(obj);
      EDIT_ID = obj.id;
    }

    $("edStatus").textContent = "Salvato in memoria ✅ (ora Pubblica su GitHub)";
    renderPlacesAdmin();
  }

  invalidateMap(STATE.editorMap);
}

function deleteEditorItem() {
  if (!EDIT_MODE || !EDIT_ID) return;
  if (!confirm("Eliminare questo elemento?")) return;

  const isReview = EDIT_MODE === "reviews";
  if (isReview) {
    STATE.reviews = STATE.reviews.filter(x => x.id !== EDIT_ID);
    renderReviewsAdmin();
  } else {
    STATE.places = STATE.places.filter(x => x.id !== EDIT_ID);
    renderPlacesAdmin();
  }
  closeEditor();
}

// =======================
// GITHUB API (places/reviews)
// =======================
function ghHeaders() {
  return {
    "Authorization": `Bearer ${STATE.ghToken}`,
    "Accept": "application/vnd.github+json"
  };
}

async function ghGetFile(path) {
  const [owner, repo] = STATE.ghRepo.split("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, { headers: ghHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function ghPutFile(path, contentStr, sha, message) {
  const [owner, repo] = STATE.ghRepo.split("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(contentStr)))
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`PUT ${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function ensureContentLoaded() {
  // Carica una volta sola
  if (STATE.contentLoadedOnce) return;

  const apiBase = ($("apiBase")?.value || STATE.apiBase || "").trim();
  if (!apiBase) return; // senza base API non posso caricare

  // Se ho già dati in memoria, considero "caricato"
  if (STATE.places.length || STATE.reviews.length) {
    STATE.contentLoadedOnce = true;
    return;
  }

  await loadContentFromApi();
  STATE.contentLoadedOnce = true;
}

async function loadContentFromApi() {
  // In questa versione l’admin non legge più da GitHub: legge direttamente dal Worker (D1).
  setStatus("ghStatus", "Carico contenuti da API…");
  setStatus("ghStatus2", "Carico contenuti da API…");
  try {
    const limit = 500;

    // PLACES (prova admin, poi public)
    let placesRes = await apiFetch(`/admin/places?status=all&limit=${limit}`);
    if (!placesRes.ok) {
      placesRes = await apiFetch(`/public/places?limit=${limit}`, { headers: {} });
    }
    if (!placesRes.ok) throw new Error(placesRes.error || "Errore nel caricamento places");
    const places = placesRes.rows || [];
    STATE.places = places.map(p => ({
      id: p.id,
      name: p.name ?? "",
      description: p.description ?? "",
      category: p.category ?? p.type ?? "",
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      address: p.address ?? "",
      phone: p.phone ?? "",
      website: p.website ?? "",
      tags: p.tags ?? "",
      createdAt: p.createdAt ?? "",
      updatedAt: p.updatedAt ?? ""
    }));

    // REVIEWS (prova admin, poi public)
    let reviewsRes = await apiFetch(`/admin/reviews?status=all&limit=${limit}`);
    if (!reviewsRes.ok) {
      reviewsRes = await apiFetch(`/public/reviews?limit=${limit}`, { headers: {} });
    }
    if (!reviewsRes.ok) throw new Error(reviewsRes.error || "Errore nel caricamento reviews");
    const reviews = reviewsRes.rows || [];
    STATE.reviews = reviews.map(r => ({
      id: r.id,
      placeId: r.placeId ?? "",
      place: r.place ?? "",
      rating: r.rating ?? null,
      title: r.title ?? "",
      text: r.text ?? r.body ?? "",
      author: r.author ?? "",
      createdAt: r.createdAt ?? "",
      lat: r.lat ?? null,
      lng: r.lng ?? null
    }));

    STATE.contentLoadedOnce = true;
    renderPlacesAdmin();
    renderReviewsAdmin();

    setStatus("ghStatus", `OK • Places: ${STATE.places.length} • Reviews: ${STATE.reviews.length}`);
    setStatus("ghStatus2", `OK • Places: ${STATE.places.length} • Reviews: ${STATE.reviews.length}`);
    updateKpi();
  } catch (e) {
    console.error(e);
    setStatus("ghStatus", "Errore: " + (e?.message || e));
    setStatus("ghStatus2", "Errore: " + (e?.message || e));
  }
}

function renderPlacesAdmin() {
  const root = $("placesList");
  if (!root) return;
  root.innerHTML = "";

  if (!STATE.places.length) {
    root.innerHTML = `<p class="muted">Nessun posto. (Premi “Carica da API”)</p>`;
    return;
  }

  for (const p of STATE.places) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(p.category || "posto")}</span>
        ${isNum(p.lat) && isNum(p.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(p.name || "")}</h4>
      <p class="muted">${escapeHTML(oneLine(p.description, 110))}</p>
    `;
    el.addEventListener("click", () => openEditor("places", p.id));
    root.appendChild(el);
  }
}

function renderReviewsAdmin() {
  const root = $("reviewsList");
  if (!root) return;
  root.innerHTML = "";

  if (!STATE.reviews.length) {
    root.innerHTML = `<p class="muted">Nessuna recensione. (Premi “Carica da API”)</p>`;
    return;
  }

  for (const r of STATE.reviews) {
    const stars = "⭐".repeat(Math.max(0, Math.min(5, Number(r.rating || 0))));
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${stars || "recensione"}</span>
        ${r.place ? `<span class="badge">${escapeHTML(oneLine(r.place, 28))}</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(oneLine(r.text, 110))}</p>
    `;
    el.addEventListener("click", () => openEditor("reviews", r.id));
    root.appendChild(el);
  }
}

async function publishToGithub() {
  // Pubblicazione su GitHub disattivata: ora la fonte dati è D1 (tramite Worker).
  setStatus("ghStatus", "Nota: la pubblicazione su GitHub è disattivata. I dati vengono letti/salvati in D1.");
  setStatus("ghStatus2", "Nota: la pubblicazione su GitHub è disattivata. I dati vengono letti/salvati in D1.");
  alert("Pubblicazione su GitHub disattivata: questa admin legge i dati direttamente dal database (D1).");
}

// =======================
// BOOT
// =======================
document.addEventListener("DOMContentLoaded", async () => {
  setupTopTabs();
  bootSettings();
  wireCoreButtons();
  loadReports().catch(() => {});

  // se esistono credenziali salvate, prova a caricare una volta
  await ensureContentLoaded();

  // se tab attivo è places/reviews, render
  const active = document.querySelector(".tab.active")?.dataset?.view;
  if (active === "places") renderPlacesAdmin();
  if (active === "reviews") renderReviewsAdmin();
});

// se ridimensioni finestra, sistemi le mappe
window.addEventListener("resize", () => {
  invalidateMap(STATE.reportMap);
  invalidateMap(STATE.editorMap);
});
