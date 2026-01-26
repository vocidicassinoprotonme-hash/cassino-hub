/* Cassino Hub - app.js (root) */

const $ = (id) => document.getElementById(id);

const LS = {
  API_BASE: "ch_apiBase_public",
  LOCAL_REPORTS: "ch_localReports_v1",
};

const DEFAULT_API_BASE = "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev";

const STATE = {
  apiBase: "",
  localReports: [],

  // segnalazioni
  pickedPhoto: null,
  pickedLat: null,
  pickedLng: null,

  // mappe
  mainMap: null,
  pickMap: null,
  pickMarker: null,
  pickLatLng: null,

  // shared pick for modals
  activePickTarget: null, // "report" | "review" | "place"

  // review modal
  review: {
    photo: null,
    lat: null,
    lng: null,
    rating: 5,
  },

  // place modal
  place: {
    photo: null,
    lat: null,
    lng: null,
  },

  places: [],
  reviews: [],
};

function load(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

function escapeHTML(s) {
  return (s || "").toString().replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function isNum(n) { return typeof n === "number" && Number.isFinite(n); }

function setText(id, t) { const el = $(id); if (el) el.textContent = t; }

function getApiBase() {
  const stored = load(LS.API_BASE, "");
  return (stored || DEFAULT_API_BASE).replace(/\/$/, "");
}

function switchTab(view) {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(`.tab[data-view="${view}"]`).forEach(x => x.classList.add("active"));

  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.remove("hidden");

  if (view === "map") {
    ensureMainMap();
    renderAllPinsOnMainMap();
  }
}

/* =========================
   TAB NAV
========================= */
function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.view));
  });
}

/* =========================
   FOTO: segnalazioni
========================= */
function setupPhoto() {
  $("btnPickGallery")?.addEventListener("click", () => $("rPhotoGallery")?.click());
  $("btnPickCamera")?.addEventListener("click", () => $("rPhotoCamera")?.click());

  const onFile = (file) => {
    if (!file) return;
    STATE.pickedPhoto = file;
    if ($("photoName")) $("photoName").textContent = `${file.name || "foto"} • ${(file.size / 1024).toFixed(0)} KB`;
    const url = URL.createObjectURL(file);
    if ($("photoPreview")) $("photoPreview").src = url;
    $("photoPreviewWrap")?.classList.remove("hidden");
  };

  $("rPhotoGallery")?.addEventListener("change", (e) => onFile(e.target.files?.[0]));
  $("rPhotoCamera")?.addEventListener("change", (e) => onFile(e.target.files?.[0]));
}

/* =========================
   GEO: SEGNAZIONI
========================= */
function setGeoStatus(msg) { if ($("geoStatus")) $("geoStatus").textContent = msg; }

function setupGeo() {
  $("btnGeo")?.addEventListener("click", () => {
    if (!navigator.geolocation) return setGeoStatus("Geolocalizzazione non supportata.");
    setGeoStatus("Rilevo GPS...");
    navigator.geolocation.getCurrentPosition((pos) => {
      STATE.pickedLat = pos.coords.latitude;
      STATE.pickedLng = pos.coords.longitude;
      if ($("rLat")) $("rLat").value = STATE.pickedLat.toFixed(6);
      if ($("rLng")) $("rLng").value = STATE.pickedLng.toFixed(6);
      setGeoStatus(`OK ✅ ±${Math.round(pos.coords.accuracy)}m`);
    }, () => setGeoStatus("Permesso negato o errore GPS."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  $("btnPickOnMap")?.addEventListener("click", () => openPickModal("report"));
  $("btnPickCancel")?.addEventListener("click", closePickModal);

  $("btnPickUse")?.addEventListener("click", () => {
    if (!STATE.pickLatLng) return alert("Tocca un punto sulla mappa prima di confermare.");

    const { lat, lng } = STATE.pickLatLng;

    if (STATE.activePickTarget === "report") {
      STATE.pickedLat = lat; STATE.pickedLng = lng;
      if ($("rLat")) $("rLat").value = lat.toFixed(6);
      if ($("rLng")) $("rLng").value = lng.toFixed(6);
      setGeoStatus("Selezionato su mappa ✅");
    }

    if (STATE.activePickTarget === "review") {
      STATE.review.lat = lat; STATE.review.lng = lng;
      if ($("revLat")) $("revLat").value = lat.toFixed(6);
      if ($("revLng")) $("revLng").value = lng.toFixed(6);
      setText("revGeoStatus", "Selezionato su mappa ✅");
    }

    if (STATE.activePickTarget === "place") {
      STATE.place.lat = lat; STATE.place.lng = lng;
      if ($("plLat")) $("plLat").value = lat.toFixed(6);
      if ($("plLng")) $("plLng").value = lng.toFixed(6);
      setText("plGeoStatus", "Selezionato su mappa ✅");
    }

    closePickModal();
  });
}

function openPickModal(target) {
  STATE.activePickTarget = target;
  $("mapPickModal")?.classList.remove("hidden");
  ensurePickMap();

  // centro
  const def = [41.492, 13.832];
  let lat = def[0], lng = def[1], z = 13;

  if (target === "report" && isNum(STATE.pickedLat) && isNum(STATE.pickedLng)) { lat = STATE.pickedLat; lng = STATE.pickedLng; z = 15; }
  if (target === "review" && isNum(STATE.review.lat) && isNum(STATE.review.lng)) { lat = STATE.review.lat; lng = STATE.review.lng; z = 15; }
  if (target === "place" && isNum(STATE.place.lat) && isNum(STATE.place.lng)) { lat = STATE.place.lat; lng = STATE.place.lng; z = 15; }

  STATE.pickMap.setView([lat, lng], z);
  if (z === 15) {
    setPickMarker([lat, lng]);
    STATE.pickLatLng = { lat, lng };
    const hint = $("pickHint");
    if (hint) hint.textContent = `Scelto: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}

function closePickModal() { $("mapPickModal")?.classList.add("hidden"); }

function ensurePickMap() {
  if (STATE.pickMap) return;
  if (!window.L) return alert("Leaflet non caricato.");

  STATE.pickMap = L.map("mapPick");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.pickMap);

  STATE.pickMap.on("click", (e) => {
    const { lat, lng } = e.latlng;
    STATE.pickLatLng = { lat, lng };
    setPickMarker([lat, lng]);
    const hint = $("pickHint");
    if (hint) hint.textContent = `Scelto: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  });
}

function setPickMarker(latlng) {
  if (!STATE.pickMap) return;
  if (STATE.pickMarker) { STATE.pickMarker.remove(); STATE.pickMarker = null; }
  STATE.pickMarker = L.marker(latlng).addTo(STATE.pickMap);
}

/* =========================
   REPORTS: local + send
========================= */
function loadLocalReports() {
  try { STATE.localReports = JSON.parse(load(LS.LOCAL_REPORTS, "[]")) || []; }
  catch { STATE.localReports = []; }
}
function saveLocalReports() { save(LS.LOCAL_REPORTS, JSON.stringify(STATE.localReports)); }

function renderLocalReports() {
  const root = $("reportList");
  if (!root) return;
  root.innerHTML = "";

  if (!STATE.localReports.length) {
    root.innerHTML = `<p class="muted">Nessuna segnalazione salvata.</p>`;
    return;
  }

  for (const r of STATE.localReports) {
    const el = document.createElement("div");
    el.className = "item clickable";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(new Date(r.createdAt).toLocaleString("it-IT"))}</span>
        ${r.photoName ? `<span class="badge">📷</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(r.description || "")}</p>
    `;
    el.addEventListener("click", () => openDetail({
      type: "report",
      title: r.title,
      badges: ["🚨 Segnalazione"],
      text: r.description,
      photoUrl: null,
      lat: r.lat,
      lng: r.lng
    }));
    root.appendChild(el);
  }
}

function setupReportButtons() {
  $("btnSaveLocal")?.addEventListener("click", () => {
    const report = buildReportPayload();
    if (!report.title || !report.description) return alert("Inserisci Titolo e Descrizione.");
    STATE.localReports.unshift({ ...report, photoName: STATE.pickedPhoto?.name || null });
    saveLocalReports();
    renderLocalReports();
    alert("Salvata sul telefono ✅");
  });

  $("btnSend")?.addEventListener("click", sendReport);

  $("btnExport")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(STATE.localReports, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cassino-hub-segnalazioni-locali.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("btnClear")?.addEventListener("click", () => {
    if (!confirm("Svuotare l'elenco locale?")) return;
    STATE.localReports = [];
    saveLocalReports();
    renderLocalReports();
  });
}

function buildReportPayload() {
  const title = ($("rTitle")?.value || "").trim();
  const description = ($("rDesc")?.value || "").trim();
  const lat = isNum(STATE.pickedLat) ? STATE.pickedLat : null;
  const lng = isNum(STATE.pickedLng) ? STATE.pickedLng : null;

  return {
    id: (crypto?.randomUUID?.() || (`id_${Date.now()}_${Math.random().toString(16).slice(2)}`)),
    title,
    description,
    lat, lng,
    createdAt: new Date().toISOString()
  };
}

async function sendReport() {
  const base = getApiBase();
  STATE.apiBase = base;

  const title = ($("rTitle")?.value || "").trim();
  const description = ($("rDesc")?.value || "").trim();
  if (!title || !description) return alert("Inserisci Titolo e Descrizione.");

  const payload = buildReportPayload();

  const btn = $("btnSend");
  if (btn) { btn.disabled = true; btn.textContent = "Invio..."; }

  try {
    const fd = new FormData();
    fd.append("id", payload.id);
    fd.append("title", payload.title);

    // ✅ IMPORTANTISSIMO: Worker legge desc (e accetta anche description)
    fd.append("desc", payload.description);
    fd.append("description", payload.description);

    if (isNum(payload.lat)) fd.append("lat", String(payload.lat));
    if (isNum(payload.lng)) fd.append("lng", String(payload.lng));
    fd.append("createdAt", payload.createdAt);
    if (STATE.pickedPhoto) fd.append("photo", STATE.pickedPhoto);

    const res = await fetch(`${base}/submit`, { method: "POST", body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.ok === false)) throw new Error("Submit failed");

    STATE.localReports.unshift({ ...payload, photoName: STATE.pickedPhoto?.name || null });
    saveLocalReports();
    renderLocalReports();

    alert("Inviata ✅ (notifica Telegram dal Worker)");

    // reset
    if ($("rTitle")) $("rTitle").value = "";
    if ($("rDesc")) $("rDesc").value = "";
    STATE.pickedPhoto = null;
    $("photoPreviewWrap")?.classList.add("hidden");
    if ($("photoPreview")) $("photoPreview").removeAttribute("src");
    if ($("photoName")) $("photoName").textContent = "";
    STATE.pickedLat = null; STATE.pickedLng = null;
    if ($("rLat")) $("rLat").value = "";
    if ($("rLng")) $("rLng").value = "";
    setGeoStatus("Non rilevata");

    // refresh map pins
    renderAllPinsOnMainMap();

  } catch (e) {
    console.warn(e);
    STATE.localReports.unshift({ ...payload, photoName: STATE.pickedPhoto?.name || null });
    saveLocalReports();
    renderLocalReports();
    alert("Invio non riuscito. Ho salvato in locale ✅");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Invia"; }
  }
}

/* =========================
   REVIEWS + PLACES: LOAD FROM WORKER (public)
========================= */
async function loadDataFromWorker() {
  const base = getApiBase();
  STATE.apiBase = base;

  try {
    const [rev, pl] = await Promise.all([
      fetch(`${base}/public/reviews?limit=400`, { cache: "no-store" }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/public/places?limit=400`, { cache: "no-store" }).then(r => r.ok ? r.json() : null),
    ]);

    STATE.reviews = Array.isArray(rev?.rows) ? rev.rows : (Array.isArray(rev?.results) ? rev.results : (Array.isArray(rev?.ok ? rev : null) ? rev : (Array.isArray(rev?.rows) ? rev.rows : (Array.isArray(rev?.rows) ? rev.rows : (Array.isArray(rev?.rows) ? rev.rows : (Array.isArray(rev?.rows) ? rev.rows : [])) ))));
    if (!Array.isArray(STATE.reviews)) STATE.reviews = Array.isArray(rev?.rows) ? rev.rows : (Array.isArray(rev?.ok ? rev.rows : null) ? rev.rows : []);

    // sicurezza: lo schema del worker è {ok:true, rows:[...]}
    STATE.reviews = Array.isArray(rev?.rows) ? rev.rows : [];
    STATE.places  = Array.isArray(pl?.rows) ? pl.rows : [];

  } catch (e) {
    console.warn("loadDataFromWorker failed", e);
    STATE.reviews = [];
    STATE.places = [];
  }

  renderReviews();
  renderPlaces();
  renderAllPinsOnMainMap();
}

function renderPlaces() {
  const root = $("placesList");
  if (!root) return;
  root.innerHTML = "";

  if (!STATE.places.length) {
    root.innerHTML = `<p class="muted">Nessun posto approvato.</p>`;
    return;
  }

  for (const p of STATE.places) {
    const el = document.createElement("div");
    el.className = "item clickable";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">📍 ${escapeHTML(p.category || "posto")}</span>
        ${isNum(p.lat) && isNum(p.lng) ? `<span class="badge">🗺️</span>` : ``}
        ${p.photoUrl ? `<span class="badge">🖼️</span>` : ``}
      </div>
      <div class="row space" style="gap:12px; align-items:flex-start">
        <div style="flex:1">
          <h4>${escapeHTML(p.name || "")}</h4>
          <p class="muted">${escapeHTML((p.description || "").slice(0, 160))}${(p.description || "").length > 160 ? "…" : ""}</p>
        </div>
        ${p.photoUrl ? `<img class="thumb" src="${escapeHTML(p.photoUrl)}" alt="">` : ``}
      </div>
    `;

    el.addEventListener("click", () => openDetail({
      type: "place",
      title: p.name || "Posto",
      badges: [`📍 ${p.category || "posto"}`],
      text: p.description || "",
      photoUrl: p.photoUrl || null,
      lat: p.lat, lng: p.lng
    }));

    root.appendChild(el);
  }
}

function renderReviews() {
  const root = $("reviewsList");
  if (!root) return;
  root.innerHTML = "";

  if (!STATE.reviews.length) {
    root.innerHTML = `<p class="muted">Nessuna recensione approvata.</p>`;
    return;
  }

  for (const r of STATE.reviews) {
    const rating = Math.max(1, Math.min(5, Number(r.rating || 5)));
    const stars = "⭐".repeat(rating);

    const el = document.createElement("div");
    el.className = "item clickable";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${stars}</span>
        ${r.place ? `<span class="badge">🏷️ ${escapeHTML(r.place)}</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">🗺️</span>` : ``}
        ${r.photoUrl ? `<span class="badge">🖼️</span>` : ``}
      </div>
      <div class="row space" style="gap:12px; align-items:flex-start">
        <div style="flex:1">
          <h4>${escapeHTML(r.title || "Recensione")}</h4>
          <p class="muted">${escapeHTML((r.text || "").slice(0, 160))}${(r.text || "").length > 160 ? "…" : ""}</p>
        </div>
        ${r.photoUrl ? `<img class="thumb" src="${escapeHTML(r.photoUrl)}" alt="">` : ``}
      </div>
    `;

    el.addEventListener("click", () => openDetail({
      type: "review",
      title: r.title || "Recensione",
      badges: [stars, r.place ? `🏷️ ${r.place}` : "⭐ Recensione"],
      text: r.text || "",
      photoUrl: r.photoUrl || null,
      lat: r.lat, lng: r.lng
    }));

    root.appendChild(el);
  }
}

/* =========================
   DETAILS MODAL
========================= */
function openDetail({ title, badges, text, photoUrl, lat, lng }) {
  setText("dTitle", title || "Dettaglio");
  const b = $("dBadges");
  if (b) b.innerHTML = (badges || []).map(x => `<span class="badge">${escapeHTML(x)}</span>`).join(" ");

  const img = $("dImg");
  if (img) {
    if (photoUrl) {
      img.src = photoUrl;
      img.classList.remove("hidden");
    } else {
      img.classList.add("hidden");
      img.removeAttribute("src");
    }
  }

  const t = $("dText");
  if (t) t.textContent = text || "";

  const gps = $("dGps");
  if (gps) {
    if (isNum(lat) && isNum(lng)) {
      gps.textContent = `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } else {
      gps.textContent = "📍 Nessuna posizione";
    }
  }

  $("detailModal")?.classList.remove("hidden");
}

function setupDetailModal() {
  $("btnCloseDetailModal")?.addEventListener("click", () => $("detailModal")?.classList.add("hidden"));
}

/* =========================
   REVIEW MODAL (submit to worker)
========================= */
function setupReviewModal() {
  $("btnAddReview")?.addEventListener("click", () => {
    resetReviewModal();
    $("reviewModal")?.classList.remove("hidden");
  });
  $("btnCloseReviewModal")?.addEventListener("click", () => $("reviewModal")?.classList.add("hidden"));

  // stars
  const starsWrap = $("revStars");
  starsWrap?.querySelectorAll(".star").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = Number(btn.dataset.v || 5);
      STATE.review.rating = Math.max(1, Math.min(5, v));
      starsWrap.dataset.value = String(STATE.review.rating);
      setText("revStarsHint", `${STATE.review.rating} stelle`);
      paintStars();
    });
  });

  function paintStars() {
    const v = STATE.review.rating;
    starsWrap?.querySelectorAll(".star").forEach(b => {
      const bv = Number(b.dataset.v || 0);
      b.classList.toggle("on", bv <= v);
    });
  }
  paintStars();

  // photo
  $("btnRevPick")?.addEventListener("click", () => $("revPhoto")?.click());
  $("revPhoto")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    STATE.review.photo = file;
    setText("revPhotoName", `${file.name || "foto"} • ${(file.size / 1024).toFixed(0)} KB`);
    const url = URL.createObjectURL(file);
    if ($("revPhotoPrev")) $("revPhotoPrev").src = url;
    $("revPhotoWrap")?.classList.remove("hidden");
  });

  // gps
  $("btnRevGeo")?.addEventListener("click", () => {
    if (!navigator.geolocation) return setText("revGeoStatus", "Geolocalizzazione non supportata.");
    setText("revGeoStatus", "Rilevo GPS...");
    navigator.geolocation.getCurrentPosition((pos) => {
      STATE.review.lat = pos.coords.latitude;
      STATE.review.lng = pos.coords.longitude;
      if ($("revLat")) $("revLat").value = STATE.review.lat.toFixed(6);
      if ($("revLng")) $("revLng").value = STATE.review.lng.toFixed(6);
      setText("revGeoStatus", `OK ✅ ±${Math.round(pos.coords.accuracy)}m`);
    }, () => setText("revGeoStatus", "Permesso negato o errore GPS."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  $("btnRevPickMap")?.addEventListener("click", () => openPickModal("review"));

  // submit
  $("btnSendReview")?.addEventListener("click", sendReview);
}

function resetReviewModal() {
  if ($("revTitle")) $("revTitle").value = "";
  if ($("revPlace")) $("revPlace").value = "";
  if ($("revText")) $("revText").value = "";
  STATE.review.photo = null;
  STATE.review.lat = null;
  STATE.review.lng = null;
  STATE.review.rating = 5;
  const starsWrap = $("revStars");
  if (starsWrap) starsWrap.dataset.value = "5";
  setText("revStarsHint", "5 stelle");
  starsWrap?.querySelectorAll(".star").forEach(b => b.classList.add("on"));

  $("revPhotoWrap")?.classList.add("hidden");
  if ($("revPhotoPrev")) $("revPhotoPrev").removeAttribute("src");
  setText("revPhotoName", "");
  if ($("revLat")) $("revLat").value = "";
  if ($("revLng")) $("revLng").value = "";
  setText("revGeoStatus", "Non rilevata");
  if ($("revPhoto")) $("revPhoto").value = "";
}

async function sendReview() {
  const base = getApiBase();

  const title = ($("revTitle")?.value || "").trim();
  const place = ($("revPlace")?.value || "").trim();
  const text  = ($("revText")?.value || "").trim();
  const rating = STATE.review.rating || 5;

  if (!title || !text) return alert("Inserisci Titolo e Testo.");

  const btn = $("btnSendReview");
  if (btn) { btn.disabled = true; btn.textContent = "Invio..."; }

  try {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("place", place);
    fd.append("text", text);
    fd.append("rating", String(rating));
    if (isNum(STATE.review.lat)) fd.append("lat", String(STATE.review.lat));
    if (isNum(STATE.review.lng)) fd.append("lng", String(STATE.review.lng));
    if (STATE.review.photo) fd.append("photo", STATE.review.photo);

    const res = await fetch(`${base}/review/submit`, { method: "POST", body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) throw new Error("review submit failed");

    alert("Recensione inviata ✅ (in attesa di approvazione)");
    $("reviewModal")?.classList.add("hidden");
    resetReviewModal();

    // Dopo approvazione comparirà: intanto ricarichiamo per aggiornare
    await loadDataFromWorker();

  } catch (e) {
    console.warn(e);
    alert("Invio recensione non riuscito ❌");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Invia (in approvazione)"; }
  }
}

/* =========================
   PLACE MODAL (submit to worker)
========================= */
function setupPlaceModal() {
  $("btnAddPlace")?.addEventListener("click", () => {
    resetPlaceModal();
    $("placeModal")?.classList.remove("hidden");
  });
  $("btnClosePlaceModal")?.addEventListener("click", () => $("placeModal")?.classList.add("hidden"));

  $("btnPlPick")?.addEventListener("click", () => $("plPhoto")?.click());
  $("plPhoto")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    STATE.place.photo = file;
    setText("plPhotoName", `${file.name || "immagine"} • ${(file.size / 1024).toFixed(0)} KB`);
    const url = URL.createObjectURL(file);
    if ($("plPhotoPrev")) $("plPhotoPrev").src = url;
    $("plPhotoWrap")?.classList.remove("hidden");
  });

  $("btnPlGeo")?.addEventListener("click", () => {
    if (!navigator.geolocation) return setText("plGeoStatus", "Geolocalizzazione non supportata.");
    setText("plGeoStatus", "Rilevo GPS...");
    navigator.geolocation.getCurrentPosition((pos) => {
      STATE.place.lat = pos.coords.latitude;
      STATE.place.lng = pos.coords.longitude;
      if ($("plLat")) $("plLat").value = STATE.place.lat.toFixed(6);
      if ($("plLng")) $("plLng").value = STATE.place.lng.toFixed(6);
      setText("plGeoStatus", `OK ✅ ±${Math.round(pos.coords.accuracy)}m`);
    }, () => setText("plGeoStatus", "Permesso negato o errore GPS."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  $("btnPlPickMap")?.addEventListener("click", () => openPickModal("place"));

  $("btnSendPlace")?.addEventListener("click", sendPlace);
}

function resetPlaceModal() {
  if ($("plName")) $("plName").value = "";
  if ($("plCategory")) $("plCategory").value = "";
  if ($("plDesc")) $("plDesc").value = "";
  STATE.place.photo = null;
  STATE.place.lat = null;
  STATE.place.lng = null;

  $("plPhotoWrap")?.classList.add("hidden");
  if ($("plPhotoPrev")) $("plPhotoPrev").removeAttribute("src");
  setText("plPhotoName", "");
  if ($("plLat")) $("plLat").value = "";
  if ($("plLng")) $("plLng").value = "";
  setText("plGeoStatus", "Non rilevata");
  if ($("plPhoto")) $("plPhoto").value = "";
}

async function sendPlace() {
  const base = getApiBase();

  const name = ($("plName")?.value || "").trim();
  const category = ($("plCategory")?.value || "").trim();
  const description = ($("plDesc")?.value || "").trim();

  if (!name || !description) return alert("Inserisci Nome e Descrizione.");

  const btn = $("btnSendPlace");
  if (btn) { btn.disabled = true; btn.textContent = "Invio..."; }

  try {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("category", category || "posto");
    fd.append("description", description);
    if (isNum(STATE.place.lat)) fd.append("lat", String(STATE.place.lat));
    if (isNum(STATE.place.lng)) fd.append("lng", String(STATE.place.lng));
    if (STATE.place.photo) fd.append("photo", STATE.place.photo);

    const res = await fetch(`${base}/place/submit`, { method: "POST", body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) throw new Error("place submit failed");

    alert("Posto inviato ✅ (in attesa di approvazione)");
    $("placeModal")?.classList.add("hidden");
    resetPlaceModal();

    await loadDataFromWorker();

  } catch (e) {
    console.warn(e);
    alert("Invio posto non riuscito ❌");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Invia (in approvazione)"; }
  }
}

/* =========================
   MAIN MAP
========================= */
function ensureMainMap() {
  if (STATE.mainMap) return;
  const el = $("map");
  if (!el || !window.L) return;

  STATE.mainMap = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.mainMap);
  STATE.mainMap.setView([41.492, 13.832], 13);
}

function makePinIcon(kind) {
  const cls = kind === "place" ? "pin pin-place"
            : kind === "review" ? "pin pin-review"
            : "pin pin-report";
  const txt = kind === "place" ? "📍" : kind === "review" ? "⭐" : "🚨";

  return L.divIcon({
    className: cls,
    html: `<div class="pinInner">${txt}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -26]
  });
}

function popupHtml({ title, subtitle, text, photoUrl }) {
  const img = photoUrl ? `<img src="${escapeHTML(photoUrl)}" style="width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12);margin:6px 0 8px">` : "";
  return `
    <div style="min-width:220px;max-width:280px">
      <b>${escapeHTML(title || "")}</b><br>
      ${subtitle ? `<span class="muted small">${escapeHTML(subtitle)}</span><br>` : ``}
      ${img}
      <div class="muted" style="margin-top:4px">${escapeHTML((text || "").slice(0, 180))}${(text || "").length > 180 ? "…" : ""}</div>
    </div>
  `;
}

function renderAllPinsOnMainMap() {
  if (!STATE.mainMap) return;

  // pulizia marker
  STATE.mainMap.eachLayer(layer => {
    if (layer instanceof L.Marker) STATE.mainMap.removeLayer(layer);
  });

  // posti
  for (const p of STATE.places) {
    if (isNum(p.lat) && isNum(p.lng)) {
      const m = L.marker([p.lat, p.lng], { icon: makePinIcon("place") })
        .addTo(STATE.mainMap)
        .bindPopup(popupHtml({
          title: p.name,
          subtitle: p.category || "posto",
          text: p.description,
          photoUrl: p.photoUrl
        }));
      m.on("click", () => {});
    }
  }

  // recensioni
  for (const r of STATE.reviews) {
    if (isNum(r.lat) && isNum(r.lng)) {
      const rating = Math.max(1, Math.min(5, Number(r.rating || 5)));
      const stars = "⭐".repeat(rating);
      const m = L.marker([r.lat, r.lng], { icon: makePinIcon("review") })
        .addTo(STATE.mainMap)
        .bindPopup(popupHtml({
          title: r.title || "Recensione",
          subtitle: r.place ? `${stars} • ${r.place}` : stars,
          text: r.text,
          photoUrl: r.photoUrl
        }));
      m.on("dblclick", () => openDetail({
        title: r.title,
        badges: [stars, r.place ? `🏷️ ${r.place}` : "⭐ Recensione"],
        text: r.text,
        photoUrl: r.photoUrl,
        lat: r.lat, lng: r.lng
      }));
    }
  }

  // segnalazioni locali (solo quelle dell’utente)
  for (const s of STATE.localReports) {
    if (isNum(s.lat) && isNum(s.lng)) {
      L.marker([s.lat, s.lng], { icon: makePinIcon("report") })
        .addTo(STATE.mainMap)
        .bindPopup(popupHtml({
          title: s.title || "Segnalazione",
          subtitle: "Segnalazione (locale)",
          text: s.description || "",
          photoUrl: null
        }));
    }
  }
}

/* =========================
   BOOT
========================= */
function boot() {
  const base = getApiBase();
  STATE.apiBase = base;
  save(LS.API_BASE, base);

  setupTabs();
  setupPhoto();
  setupGeo();

  loadLocalReports();
  renderLocalReports();
  setupReportButtons();

  setupDetailModal();
  setupReviewModal();
  setupPlaceModal();

  setGeoStatus("Non rilevata");

  // carica places/reviews approvati dal worker
  loadDataFromWorker().catch(() => {});
}

boot();
