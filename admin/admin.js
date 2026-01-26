/* Admin • Cassino Hub (admin.js) — FIX tabs + maps + auto render */

const $ = (id) => document.getElementById(id);

const LS = {
  ADMIN_KEY: "ch_adminKey",
  API_BASE: "ch_apiBase",
  GH_TOKEN: "ch_ghToken",
  GH_REPO: "ch_ghRepo"
};

const STATE = {
  apiBase: "",
  adminKey: "",
  ghToken: "",
  ghRepo: "",

  reports: [],
  selected: null,

  places: [],
  reviews: [],
  placesSha: null,
  reviewsSha: null,

  reportMap: null,
  reportPin: null,

  editorMap: null,
  editorPin: null,

  contentLoadedOnce: false
};

// ================= UTIL =================
function load(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}
function del(key) {
  try { localStorage.removeItem(key); } catch {}
}
function escapeHTML(s) {
  return (s || "").toString().replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}
function isNum(n) { return typeof n === "number" && Number.isFinite(n); }
function oneLine(s, max = 120) {
  const t = (s || "").toString().replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

function headersAdmin() {
  return { "X-Admin-Key": STATE.adminKey };
}

function normBase(u) {
  return (u || "").trim().replace(/\/$/, "");
}

function setConnStatus(msg) {
  if ($("connStatus")) $("connStatus").textContent = msg || "";
}
function setGhStatus(msg) {
  if ($("ghStatus")) $("ghStatus").textContent = msg || "";
}

function invalidateMap(map) {
  if (!map) return;
  // Leaflet: serve dopo che il contenitore è visibile
  setTimeout(() => {
    try { map.invalidateSize(); } catch {}
  }, 50);
}

// =======================
// TOP TABS
// =======================
function setupTopTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;

      // hide all views
      $("view-reports")?.classList.add("hidden");
      $("view-content")?.classList.add("hidden");

      if (view === "reports") {
        $("view-reports")?.classList.remove("hidden");
        // la mappa report può essere dentro un pannello che prima era hidden
        invalidateMap(STATE.reportMap);
        return;
      }

      // content views (places/reviews)
      $("view-content")?.classList.remove("hidden");

      // Se ho già token/repo salvati e non ho mai caricato, provo una volta
      await ensureContentLoaded();

      if (view === "places") {
        if ($("contentTitle")) $("contentTitle").textContent = "Posti";
        $("placesList")?.classList.remove("hidden");
        $("reviewsList")?.classList.add("hidden");
        $("btnAddPlace")?.classList.remove("hidden");
        $("btnAddReview")?.classList.add("hidden");
        $("editor")?.classList.add("hidden");

        // ✅ FIX: render sempre quando apro il TAB
        renderPlacesAdmin();
        return;
      }

      if (view === "reviews") {
        if ($("contentTitle")) $("contentTitle").textContent = "Recensioni";
        $("reviewsList")?.classList.remove("hidden");
        $("placesList")?.classList.add("hidden");
        $("btnAddReview")?.classList.remove("hidden");
        $("btnAddPlace")?.classList.add("hidden");
        $("editor")?.classList.add("hidden");

        // ✅ FIX: render sempre quando apro il TAB
        renderReviewsAdmin();
        return;
      }
    });
  });
}

// =======================
// CONNECTION / BUTTONS
// =======================
function bootSettings() {
  STATE.apiBase  = normBase(load(LS.API_BASE, ""));
  STATE.adminKey = load(LS.ADMIN_KEY, "");
  STATE.ghToken  = load(LS.GH_TOKEN, "");
  STATE.ghRepo   = load(LS.GH_REPO, "");

  if ($("apiBase")) $("apiBase").value = STATE.apiBase;
  if ($("adminKey")) $("adminKey").value = STATE.adminKey;

  if ($("ghToken")) $("ghToken").value = STATE.ghToken;
  if ($("ghRepo")) $("ghRepo").value = STATE.ghRepo;
}

function wireCoreButtons() {
  $("btnSaveKey")?.addEventListener("click", () => {
    STATE.apiBase  = normBase($("apiBase")?.value || "");
    STATE.adminKey = ($("adminKey")?.value || "").trim();
    save(LS.API_BASE, STATE.apiBase);
    save(LS.ADMIN_KEY, STATE.adminKey);
    setConnStatus("Salvato ✅");
  });

  $("btnTest")?.addEventListener("click", async () => {
    STATE.apiBase  = normBase($("apiBase")?.value || "");
    STATE.adminKey = ($("adminKey")?.value || "").trim();

    if (!STATE.apiBase || !STATE.adminKey) {
      setConnStatus("Inserisci Worker base URL e Admin Key.");
      return;
    }

    setConnStatus("Test in corso...");
    try {
      const res = await fetch(`${STATE.apiBase}/list`, { headers: headersAdmin() });
      if (!res.ok) {
        setConnStatus(`Test FALLITO: /list ${res.status}`);
        return;
      }
      const data = await res.json().catch(() => null);
      setConnStatus(`Test OK ✅ (${(data?.rows || []).length} righe)`);
    } catch (e) {
      console.warn(e);
      setConnStatus("Test FALLITO: errore rete.");
    }
  });

  $("btnRefresh")?.addEventListener("click", loadReports);
  $("btnExport")?.addEventListener("click", exportReports);
  $("q")?.addEventListener("input", renderReportList);

  $("btnSaveReport")?.addEventListener("click", saveSelectedReport);

  $("btnAddPlace")?.addEventListener("click", () => openEditor("places", null));
  $("btnAddReview")?.addEventListener("click", () => openEditor("reviews", null));

  $("btnCloseEditor")?.addEventListener("click", closeEditor);
  $("btnPickOnMap")?.addEventListener("click", togglePickOnMap);
  $("btnSaveItem")?.addEventListener("click", saveEditorItem);
  $("btnDeleteItem")?.addEventListener("click", deleteEditorItem);

  $("btnLoadContent")?.addEventListener("click", async () => {
    await loadContentFromGithub();
    // se stai guardando un tab content, aggiorna subito la vista
    const active = document.querySelector(".tab.active")?.dataset?.view;
    if (active === "places") renderPlacesAdmin();
    if (active === "reviews") renderReviewsAdmin();
  });

  $("btnPublish")?.addEventListener("click", publishToGithub);
}

// =======================
// REPORTS
// =======================
async function loadReports() {
  STATE.apiBase  = normBase($("apiBase")?.value || "");
  STATE.adminKey = ($("adminKey")?.value || "").trim();
  save(LS.API_BASE, STATE.apiBase);
  save(LS.ADMIN_KEY, STATE.adminKey);

  if (!STATE.apiBase || !STATE.adminKey) {
    setConnStatus("Inserisci Worker base URL e Admin Key.");
    return;
  }

  setConnStatus("Carico...");
  try {
    const res = await fetch(`${STATE.apiBase}/list`, { headers: headersAdmin() });
    if (!res.ok) {
      setConnStatus(`Errore /list: ${res.status}`);
      return;
    }
    const data = await res.json();
    STATE.reports = data.rows || [];
    setConnStatus(`OK ✅ ${STATE.reports.length} segnalazioni`);
    renderReportList();
  } catch (e) {
    console.warn(e);
    setConnStatus("Errore rete.");
  }
}

function renderReportList() {
  const root = $("list");
  if (!root) return;
  root.innerHTML = "";

  const q = ($("q")?.value || "").toLowerCase().trim();
  const items = STATE.reports.filter(r => {
    const t = `${r.title || ""} ${r.description || ""}`.toLowerCase();
    return !q || t.includes(q);
  });

  if (!items.length) {
    root.innerHTML = `<p class="muted">Nessuna segnalazione.</p>`;
    return;
  }

  for (const r of items) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${new Date(r.createdAt).toLocaleString("it-IT")}</span>
        <span class="badge">${escapeHTML(r.status || "new")}</span>
        ${r.photoKey ? `<span class="badge">📷</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(oneLine(r.title, 60))}</h4>
      <p class="muted">${escapeHTML(oneLine(r.description, 90))}</p>
    `;
    el.addEventListener("click", () => selectReport(r.id));
    root.appendChild(el);
  }
}

function selectReport(id) {
  const r = STATE.reports.find(x => x.id === id);
  if (!r) return;
  STATE.selected = r;

  $("detailEmpty")?.classList.add("hidden");
  $("detail")?.classList.remove("hidden");

  if ($("selMeta")) $("selMeta").textContent = `${new Date(r.createdAt).toLocaleString("it-IT")} • ${r.id}`;
  if ($("dTitle")) $("dTitle").textContent = r.title || "";
  if ($("dDesc")) $("dDesc").textContent = r.description || "";

  if (r.photoKey) {
    $("dPhotoWrap")?.classList.remove("hidden");
    $("dPhoto").src = `${STATE.apiBase}/photo?key=${encodeURIComponent(r.photoKey)}&ak=${encodeURIComponent(STATE.adminKey)}`;
  } else {
    $("dPhotoWrap")?.classList.add("hidden");
    $("dPhoto")?.removeAttribute("src");
  }

  if (isNum(r.lat) && isNum(r.lng)) {
    if ($("dCoords")) $("dCoords").textContent = `Lat ${r.lat.toFixed(6)} • Lng ${r.lng.toFixed(6)}`;
  } else {
    if ($("dCoords")) $("dCoords").textContent = "Nessuna coordinata.";
  }

  if ($("dStatus")) $("dStatus").value = r.status || "new";
  if ($("dTags")) $("dTags").value = r.tags || "";
  if ($("dNote")) $("dNote").value = r.adminNote || "";
  if ($("dReply")) $("dReply").value = r.adminReply || "";
  if ($("saveStatus")) $("saveStatus").textContent = "";

  ensureReportMap();
  renderReportPin(r.lat, r.lng);
  invalidateMap(STATE.reportMap);
}

async function saveSelectedReport() {
  if (!STATE.selected) return;

  const payload = {
    id: STATE.selected.id,
    status: $("dStatus")?.value,
    tags: $("dTags")?.value,
    adminNote: $("dNote")?.value,
    adminReply: $("dReply")?.value
  };

  if ($("saveStatus")) $("saveStatus").textContent = "Salvo...";
  try {
    const res = await fetch(`${STATE.apiBase}/admin/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headersAdmin() },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      if ($("saveStatus")) $("saveStatus").textContent = `Errore: ${res.status}`;
      console.log("update error", data);
      return;
    }

    if ($("saveStatus")) $("saveStatus").textContent = "Salvato ✅";
    Object.assign(STATE.selected, data);

    const idx = STATE.reports.findIndex(x => x.id === STATE.selected.id);
    if (idx >= 0) STATE.reports[idx] = { ...STATE.reports[idx], ...data };

    renderReportList();
  } catch (e) {
    console.warn(e);
    if ($("saveStatus")) $("saveStatus").textContent = "Errore rete.";
  }
}

function exportReports() {
  const blob = new Blob([JSON.stringify(STATE.reports, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "reports-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// =======================
// MAP REPORT
// =======================
function ensureReportMap() {
  if (STATE.reportMap) return;
  if (!window.L) {
    alert("Leaflet non caricato. Controlla internet o i link Leaflet in admin.html");
    return;
  }
  const el = $("mapReport");
  if (!el) return;

  STATE.reportMap = L.map("mapReport");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.reportMap);
  STATE.reportMap.setView([41.492, 13.832], 13);
}

function renderReportPin(lat, lng) {
  if (!STATE.reportMap) return;
  if (STATE.reportPin) { STATE.reportPin.remove(); STATE.reportPin = null; }
  if (isNum(lat) && isNum(lng)) {
    STATE.reportPin = L.marker([lat, lng]).addTo(STATE.reportMap);
    STATE.reportMap.setView([lat, lng], 15);
  } else {
    STATE.reportMap.setView([41.492, 13.832], 13);
  }
}

// =======================
// CONTENT EDITOR + MAP PICK
// =======================
let PICK_MODE = false;
let EDIT_MODE = null; // "places" | "reviews"
let EDIT_ID = null;

function ensureEditorMap() {
  if (STATE.editorMap) return;
  if (!window.L) {
    alert("Leaflet non caricato. Controlla i link Leaflet in admin.html");
    return;
  }
  const el = $("mapEd");
  if (!el) return;

  STATE.editorMap = L.map("mapEd");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.editorMap);
  STATE.editorMap.setView([41.492, 13.832], 13);

  STATE.editorMap.on("click", (e) => {
    if (!PICK_MODE) return;
    const { lat, lng } = e.latlng;
    if ($("edLat")) $("edLat").value = lat.toFixed(6);
    if ($("edLng")) $("edLng").value = lng.toFixed(6);
    renderEditorPin(lat, lng);
    if ($("edStatus")) $("edStatus").textContent = "Coordinate impostate dalla mappa ✅";
  });
}

function renderEditorPin(lat, lng) {
  if (!STATE.editorMap) return;
  if (STATE.editorPin) { STATE.editorPin.remove(); STATE.editorPin = null; }
  if (isNum(lat) && isNum(lng)) {
    STATE.editorPin = L.marker([lat, lng]).addTo(STATE.editorMap);
    STATE.editorMap.setView([lat, lng], 15);
  } else {
    STATE.editorMap.setView([41.492, 13.832], 13);
  }
}

function togglePickOnMap() {
  PICK_MODE = !PICK_MODE;
  if ($("btnPickOnMap")) $("btnPickOnMap").textContent = PICK_MODE ? "✅ Click sulla mappa..." : "📍 Seleziona su mappa";
  if ($("edStatus")) $("edStatus").textContent = PICK_MODE ? "Modalità selezione: clicca un punto sulla mappa." : "";
}

function openEditor(mode, id) {
  EDIT_MODE = mode;
  EDIT_ID = id;

  $("editor")?.classList.remove("hidden");

  ensureEditorMap();
  invalidateMap(STATE.editorMap);

  const isReview = mode === "reviews";
  $("edRatingWrap")?.classList.toggle("hidden", !isReview);
  if ($("edTitle")) $("edTitle").textContent = isReview ? "Editor • Recensione" : "Editor • Posto";

  const item = id
    ? (isReview ? STATE.reviews.find(x => x.id === id) : STATE.places.find(x => x.id === id))
    : null;

  if (isReview) {
    $("edName").value = item?.title || "";
    $("edCat").value  = item?.place || "";
    $("edDesc").value = item?.text || "";
    $("edLat").value  = isNum(item?.lat) ? item.lat : "";
    $("edLng").value  = isNum(item?.lng) ? item.lng : "";
    $("edRating").value = item?.rating ?? 5;
  } else {
    $("edName").value = item?.name || "";
    $("edCat").value  = item?.category || "";
    $("edDesc").value = item?.description || "";
    $("edLat").value  = isNum(item?.lat) ? item.lat : "";
    $("edLng").value  = isNum(item?.lng) ? item.lng : "";
  }

  const lat = Number($("edLat").value);
  const lng = Number($("edLng").value);
  renderEditorPin(Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null);

  if ($("edStatus")) $("edStatus").textContent = id ? "Modifica elemento esistente." : "Nuovo elemento.";
}

function closeEditor() {
  $("editor")?.classList.add("hidden");
  PICK_MODE = false;
  if ($("btnPickOnMap")) $("btnPickOnMap").textContent = "📍 Seleziona su mappa";
  if ($("edStatus")) $("edStatus").textContent = "";
  EDIT_MODE = null;
  EDIT_ID = null;
}

function saveEditorItem() {
  if (!EDIT_MODE) return;

  const isReview = EDIT_MODE === "reviews";
  const lat = ($("edLat").value) ? Number($("edLat").value) : null;
  const lng = ($("edLng").value) ? Number($("edLng").value) : null;

  if (isReview) {
    const obj = {
      id: EDIT_ID || uid(),
      title: ($("edName").value || "").trim(),
      place: ($("edCat").value || "").trim(),
      rating: Math.max(1, Math.min(5, Number(($("edRating").value || 5)))),
      text: ($("edDesc").value || "").trim(),
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
  // Carica una volta sola se ho le credenziali salvate
  if (STATE.contentLoadedOnce) return;
  const token = ($("ghToken")?.value || STATE.ghToken || "").trim();
  const repo  = ($("ghRepo")?.value  || STATE.ghRepo  || "").trim();
  if (!token || !repo) return;

  // non bloccare se sono già presenti dati in memoria
  if (STATE.places.length || STATE.reviews.length) {
    STATE.contentLoadedOnce = true;
    return;
  }

  await loadContentFromGithub();
  STATE.contentLoadedOnce = true;
}

async function loadContentFromGithub() {
  STATE.ghToken = ($("ghToken")?.value || "").trim();
  STATE.ghRepo  = ($("ghRepo")?.value  || "").trim();
  save(LS.GH_TOKEN, STATE.ghToken);
  save(LS.GH_REPO, STATE.ghRepo);

  if (!STATE.ghToken || !STATE.ghRepo) {
    setGhStatus("Inserisci GitHub Token e Repo.");
    return;
  }

  setGhStatus("Carico file da GitHub...");
  try {
    const placesFile = await ghGetFile("data/places.json");
    STATE.placesSha = placesFile.sha;
    STATE.places = JSON.parse(decodeURIComponent(escape(atob(placesFile.content))));

    const reviewsFile = await ghGetFile("data/reviews.json");
    STATE.reviewsSha = reviewsFile.sha;
    STATE.reviews = JSON.parse(decodeURIComponent(escape(atob(reviewsFile.content))));

    setGhStatus(`OK ✅ Posti: ${STATE.places.length} • Recensioni: ${STATE.reviews.length}`);

    // render immediato
    renderPlacesAdmin();
    renderReviewsAdmin();
  } catch (e) {
    console.warn(e);
    setGhStatus(`Errore caricamento: ${e.message}`);
  }
}

function renderPlacesAdmin() {
  const root = $("placesList");
  if (!root) return;
  root.innerHTML = "";

  if (!STATE.places.length) {
    root.innerHTML = `<p class="muted">Nessun posto. (Premi “Carica da GitHub” oppure aggiungi e poi “Pubblica”)</p>`;
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
    root.innerHTML = `<p class="muted">Nessuna recensione. (Premi “Carica da GitHub” oppure aggiungi e poi “Pubblica”)</p>`;
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
  STATE.ghToken = ($("ghToken")?.value || "").trim();
  STATE.ghRepo  = ($("ghRepo")?.value  || "").trim();
  save(LS.GH_TOKEN, STATE.ghToken);
  save(LS.GH_REPO, STATE.ghRepo);

  if (!STATE.ghToken || !STATE.ghRepo) {
    setGhStatus("Inserisci Token e Repo.");
    return;
  }
  if (!STATE.placesSha || !STATE.reviewsSha) {
    setGhStatus("Prima fai: Carica da GitHub.");
    return;
  }

  setGhStatus("Pubblico su GitHub...");
  try {
    const placesStr  = JSON.stringify(STATE.places, null, 2);
    const reviewsStr = JSON.stringify(STATE.reviews, null, 2);

    const p = await ghPutFile("data/places.json", placesStr, STATE.placesSha, `Update places ${nowISO()}`);
    const r = await ghPutFile("data/reviews.json", reviewsStr, STATE.reviewsSha, `Update reviews ${nowISO()}`);

    STATE.placesSha  = p.content.sha;
    STATE.reviewsSha = r.content.sha;

    setGhStatus("Pubblicato ✅ (attendi GitHub Pages 30–60 sec)");
  } catch (e) {
    console.warn(e);
    setGhStatus(`Errore publish: ${e.message}`);
  }
}

// =======================
// BOOT
// =======================
document.addEventListener("DOMContentLoaded", async () => {
  setupTopTabs();
  bootSettings();
  wireCoreButtons();
  loadReports().catch(() => {});

  // se esistono credenziali GitHub salvate, prova a caricare una volta
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
