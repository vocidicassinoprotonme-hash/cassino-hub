/* Cassino Hub - app.js (root) */

const $ = (id) => document.getElementById(id);

const LS = {
  API_BASE: "ch_apiBase_public",
  LOCAL_REPORTS: "ch_localReports_v1",
  ADMIN_MODE: "ch_adminMode"
};

// ✅ Worker base (quello che invia su Telegram)
const DEFAULT_API_BASE = "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev";

// Stato
const STATE = {
  apiBase: "",
  localReports: [],
  pickedPhoto: null, // File
  pickedLat: null,
  pickedLng: null,

  // mappe
  mainMap: null,
  pickMap: null,
  pickMarker: null,
  pickLatLng: null,

  // dati (da Worker: solo APPROVATI)
  places: [],
  reviews: [],

  // modal
  modalEl: null
};

function load(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}
function del(key) {
  try { localStorage.removeItem(key); } catch {}
}

function uid() {
  return (crypto?.randomUUID?.() || (`id_${Date.now()}_${Math.random().toString(16).slice(2)}`));
}

function escapeHTML(s){
  return (s||"").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function isNum(n){ return typeof n === "number" && Number.isFinite(n); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function setGeoStatus(msg){ if ($("geoStatus")) $("geoStatus").textContent = msg; }

function getApiBase(){
  const stored = load(LS.API_BASE, "");
  return (stored || DEFAULT_API_BASE).replace(/\/$/, "");
}

function catColor(category = "") {
  const c = (category || "").toString().trim().toLowerCase();
  // colori base per categorie (puoi cambiarli quando vuoi)
  if (c.includes("ristor") || c.includes("food") || c.includes("mang")) return "#ffb703";
  if (c.includes("bar") || c.includes("caff")) return "#fb8500";
  if (c.includes("nego") || c.includes("shop") || c.includes("acquist")) return "#8ecae6";
  if (c.includes("cultura") || c.includes("muse") || c.includes("storia")) return "#219ebc";
  if (c.includes("natura") || c.includes("parco") || c.includes("outdoor")) return "#2a9d8f";
  if (c.includes("evento")) return "#8338ec";
  return "#90a4ae";
}

function typeColor(type = "") {
  // tipo diverso: place vs review vs report
  if (type === "review") return "#ff4d6d";
  if (type === "place") return "#4cc9f0";
  return "#adb5bd";
}

function starString(n) {
  const r = clamp(Number(n || 0), 0, 5);
  return "⭐".repeat(r);
}

/* =========================
   TAB NAV
========================= */
function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");

      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
      const el = document.getElementById(`view-${view}`);
      if(el) el.classList.remove("hidden");

      if(view === "map") {
        ensureMainMap();
        await refreshApprovedData(); // carica reviews/places approvati
        renderAllPinsOnMainMap();
      }

      if(view === "reviews") {
        await refreshApprovedData();
        renderReviews();
      }

      if(view === "places") {
        await refreshApprovedData();
        renderPlaces();
      }
    });
  });
}

/* =========================
   FOTO: gallery / camera (SEGNALAZIONI)
========================= */
function setupPhoto(){
  $("btnPickGallery")?.addEventListener("click", ()=> $("rPhotoGallery")?.click());
  $("btnPickCamera")?.addEventListener("click", ()=> $("rPhotoCamera")?.click());

  const onFile = (file)=>{
    if(!file) return;
    STATE.pickedPhoto = file;
    if ($("photoName")) $("photoName").textContent = `${file.name || "foto"} • ${(file.size/1024).toFixed(0)} KB`;
    const url = URL.createObjectURL(file);
    if ($("photoPreview")) $("photoPreview").src = url;
    $("photoPreviewWrap")?.classList.remove("hidden");
  };

  $("rPhotoGallery")?.addEventListener("change", (e)=> onFile(e.target.files?.[0]));
  $("rPhotoCamera")?.addEventListener("change", (e)=> onFile(e.target.files?.[0]));
}

/* =========================
   GEO: GPS + pick su mappa
========================= */
function setupGeo(){
  $("btnGeo")?.addEventListener("click", ()=> getGpsForReport());

  $("btnPickOnMap")?.addEventListener("click", ()=> openPickModal({ onPick: (lat,lng)=> {
    STATE.pickedLat = lat;
    STATE.pickedLng = lng;
    if ($("rLat")) $("rLat").value = lat.toFixed(6);
    if ($("rLng")) $("rLng").value = lng.toFixed(6);
    setGeoStatus("Selezionato su mappa ✅");
  }}));

  $("btnPickCancel")?.addEventListener("click", closePickModal);

  $("btnPickUse")?.addEventListener("click", ()=>{
    if(!STATE.pickLatLng){
      alert("Tocca un punto sulla mappa prima di confermare.");
      return;
    }
    const { lat, lng } = STATE.pickLatLng;
    // callback gestita in openPickModal
    if (STATE.__pickCb) STATE.__pickCb(lat, lng);
    closePickModal();
  });
}

function getGpsForReport(){
  if(!navigator.geolocation){
    setGeoStatus("Geolocalizzazione non supportata.");
    return;
  }
  setGeoStatus("Rilevo GPS...");
  navigator.geolocation.getCurrentPosition((pos)=>{
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    STATE.pickedLat = lat;
    STATE.pickedLng = lng;

    if ($("rLat")) $("rLat").value = lat.toFixed(6);
    if ($("rLng")) $("rLng").value = lng.toFixed(6);
    setGeoStatus(`OK ✅ ±${Math.round(pos.coords.accuracy)}m`);

  }, (err)=>{
    console.warn(err);
    setGeoStatus("Permesso negato o errore GPS.");
  }, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
}

function openPickModal({ onPick } = {}){
  STATE.__pickCb = typeof onPick === "function" ? onPick : null;

  $("mapPickModal")?.classList.remove("hidden");
  ensurePickMap();

  if(isNum(STATE.pickedLat) && isNum(STATE.pickedLng)){
    STATE.pickMap.setView([STATE.pickedLat, STATE.pickedLng], 15);
    setPickMarker([STATE.pickedLat, STATE.pickedLng]);
    STATE.pickLatLng = { lat: STATE.pickedLat, lng: STATE.pickedLng };
    const hint = $("pickHint");
    if(hint) hint.textContent = `Scelto: ${STATE.pickedLat.toFixed(6)}, ${STATE.pickedLng.toFixed(6)}`;
  } else {
    STATE.pickMap.setView([41.492, 13.832], 13);
    const hint = $("pickHint");
    if(hint) hint.textContent = "Tocca la mappa per scegliere";
  }
}

function closePickModal(){
  $("mapPickModal")?.classList.add("hidden");
  STATE.__pickCb = null;
}

function ensurePickMap(){
  if(STATE.pickMap) return;
  if(!window.L) { alert("Leaflet non caricato."); return; }

  STATE.pickMap = L.map("mapPick");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.pickMap);

  STATE.pickMap.on("click", (e)=>{
    const { lat, lng } = e.latlng;
    STATE.pickLatLng = { lat, lng };
    setPickMarker([lat, lng]);
    const hint = $("pickHint");
    if(hint) hint.textContent = `Scelto: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  });
}

function setPickMarker(latlng){
  if(!STATE.pickMap) return;
  if(STATE.pickMarker){ STATE.pickMarker.remove(); STATE.pickMarker=null; }
  STATE.pickMarker = L.marker(latlng).addTo(STATE.pickMap);
}

/* =========================
   REPORTS: local + send
========================= */
function loadLocalReports(){
  try{
    STATE.localReports = JSON.parse(load(LS.LOCAL_REPORTS, "[]")) || [];
  } catch {
    STATE.localReports = [];
  }
}

function saveLocalReports(){
  save(LS.LOCAL_REPORTS, JSON.stringify(STATE.localReports));
}

function renderLocalReports(){
  const root = $("reportList");
  if(!root) return;
  root.innerHTML = "";

  if(!STATE.localReports.length){
    root.innerHTML = `<p class="muted">Nessuna segnalazione salvata.</p>`;
    return;
  }

  for(const r of STATE.localReports){
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
    el.addEventListener("click", ()=> openDetailModal({
      type: "report",
      title: r.title,
      subtitle: "Segnalazione locale (salvata sul telefono)",
      description: r.description,
      lat: r.lat, lng: r.lng,
      photoUrl: null
    }));
    root.appendChild(el);
  }
}

function setupReportButtons(){
  $("btnSaveLocal")?.addEventListener("click", ()=>{
    const report = buildReportPayload();
    if(!report.title || !report.description){
      alert("Inserisci Titolo e Descrizione.");
      return;
    }
    STATE.localReports.unshift({
      ...report,
      photoName: STATE.pickedPhoto?.name || null
    });
    saveLocalReports();
    renderLocalReports();
    alert("Salvata sul telefono ✅");
  });

  $("btnSend")?.addEventListener("click", sendReport);

  $("btnExport")?.addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(STATE.localReports, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cassino-hub-segnalazioni-locali.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("btnClear")?.addEventListener("click", ()=>{
    if(!confirm("Svuotare l'elenco locale?")) return;
    STATE.localReports = [];
    saveLocalReports();
    renderLocalReports();
  });
}

function buildReportPayload(){
  const title = ($("rTitle")?.value || "").trim();
  const description = ($("rDesc")?.value || "").trim();
  const lat = isNum(STATE.pickedLat) ? STATE.pickedLat : null;
  const lng = isNum(STATE.pickedLng) ? STATE.pickedLng : null;

  return {
    id: uid(),
    title,
    description,
    lat, lng,
    createdAt: new Date().toISOString()
  };
}

async function sendReport(){
  const base = getApiBase();
  STATE.apiBase = base;

  const title = ($("rTitle")?.value || "").trim();
  const description = ($("rDesc")?.value || "").trim();

  if(!title || !description){
    alert("Inserisci Titolo e Descrizione.");
    return;
  }

  const payload = buildReportPayload();

  const btn = $("btnSend");
  if(btn){ btn.disabled = true; btn.textContent = "Invio..."; }

  try{
    // ✅ multipart/form-data (gestisce foto facilmente)
    const fd = new FormData();
    fd.append("id", payload.id);
    fd.append("title", payload.title);

    // ✅ IMPORTANTISSIMO: il Worker si aspetta "desc"
    fd.append("desc", payload.description);

    if(isNum(payload.lat)) fd.append("lat", String(payload.lat));
    if(isNum(payload.lng)) fd.append("lng", String(payload.lng));
    fd.append("createdAt", payload.createdAt);
    if(STATE.pickedPhoto) fd.append("photo", STATE.pickedPhoto);

    const res = await fetch(`${base}/submit`, { method:"POST", body: fd });
    const data = await res.json().catch(()=>null);

    if(!res.ok || (data && data.ok === false)){
      throw new Error(`Submit failed: ${res.status}`);
    }

    STATE.localReports.unshift({
      ...payload,
      photoName: STATE.pickedPhoto?.name || null
    });
    saveLocalReports();
    renderLocalReports();

    alert("Inviata ✅ (notifica Telegram dal Worker)");

    // reset form
    if($("rTitle")) $("rTitle").value = "";
    if($("rDesc")) $("rDesc").value = "";
    STATE.pickedPhoto = null;
    $("photoPreviewWrap")?.classList.add("hidden");
    if($("photoPreview")) $("photoPreview").removeAttribute("src");
    if($("photoName")) $("photoName").textContent = "";
    STATE.pickedLat = null;
    STATE.pickedLng = null;
    if($("rLat")) $("rLat").value = "";
    if($("rLng")) $("rLng").value = "";
    setGeoStatus("Non rilevata");

  } catch(e){
    console.warn(e);
    // Salvataggio locale di sicurezza
    STATE.localReports.unshift({
      ...payload,
      photoName: STATE.pickedPhoto?.name || null
    });
    saveLocalReports();
    renderLocalReports();
    alert("Invio non riuscito. Ho salvato in locale ✅");
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = "Invia"; }
  }
}

/* =========================
   REVIEWS + PLACES (da Worker APPROVATI)
========================= */
async function refreshApprovedData(){
  const base = getApiBase();
  STATE.apiBase = base;

  // carichiamo SOLO approvati
  try{
    const [placesRes, reviewsRes] = await Promise.all([
      fetch(`${base}/places`, { cache:"no-store" }),
      fetch(`${base}/reviews`, { cache:"no-store" })
    ]);

    const placesJson = placesRes.ok ? await placesRes.json().catch(()=>null) : null;
    const reviewsJson = reviewsRes.ok ? await reviewsRes.json().catch(()=>null) : null;

    STATE.places = Array.isArray(placesJson?.rows) ? placesJson.rows : [];
    STATE.reviews = Array.isArray(reviewsJson?.rows) ? reviewsJson.rows : [];
  } catch(e){
    console.warn("refreshApprovedData failed", e);
    STATE.places = [];
    STATE.reviews = [];
  }
}

/* =========================
   REVIEWS UI
========================= */
function setupReviewButtons(){
  $("btnAddReview")?.addEventListener("click", ()=> openReviewFormModal());
}

function renderReviews(){
  const root = $("reviewsList");
  if(!root) return;
  root.innerHTML = "";

  if(!STATE.reviews.length){
    root.innerHTML = `<p class="muted">Nessuna recensione approvata al momento.</p>`;
    return;
  }

  for(const r of STATE.reviews){
    const el = document.createElement("div");
    el.className = "item clickable";
    const stars = starString(r.rating);
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${stars || "recensione"}</span>
        ${r.category ? `<span class="badge">${escapeHTML(r.category)}</span>` : ``}
        ${r.placeName ? `<span class="badge">${escapeHTML(r.placeName)}</span>` : ``}
        ${(isNum(r.lat)&&isNum(r.lng)) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || r.placeName || "Recensione")}</h4>
      <p class="muted">${escapeHTML((r.description || "").slice(0, 140))}${(r.description||"").length>140?"…":""}</p>
    `;
    el.addEventListener("click", ()=> openDetailModal({
      type: "review",
      title: r.title || r.placeName || "Recensione",
      subtitle: `${starString(r.rating)} • ${r.placeName || ""}`.trim(),
      description: r.description || "",
      category: r.category || "",
      lat: r.lat, lng: r.lng,
      photoUrl: r.photoUrl || null
    }));
    root.appendChild(el);
  }
}

function openReviewFormModal(){
  const html = `
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:18px;font-weight:800;">⭐ Aggiungi recensione</div>
        <div class="muted small">Verrà inviata all’Admin. Comparirà solo dopo approvazione.</div>
      </div>
      <button class="btn secondary" id="mClose">Chiudi</button>
    </div>

    <div style="height:10px"></div>

    <label class="field">
      <span>Nome locale / attività</span>
      <input id="mReviewPlace" type="text" placeholder="Es. Bar Roma / Negozio / Altro" maxlength="80">
    </label>

    <label class="field">
      <span>Titolo recensione</span>
      <input id="mReviewTitle" type="text" placeholder="Es. Locale consigliato" maxlength="80">
    </label>

    <label class="field">
      <span>Testo</span>
      <textarea id="mReviewDesc" rows="5" placeholder="Scrivi la tua esperienza..."></textarea>
    </label>

    <div class="grid2">
      <div class="field">
        <span>Stelle</span>
        <div id="mStarsRow" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
        <div class="muted small" id="mStarsHint">Seleziona da 1 a 5</div>
      </div>

      <label class="field">
        <span>Categoria</span>
        <input id="mReviewCat" type="text" placeholder="Es. ristorante, bar, negozio, cultura...">
      </label>
    </div>

    <div class="grid2">
      <div class="field">
        <span>Foto (opzionale)</span>
        <div class="row">
          <button class="btn secondary" type="button" id="mPickPhoto">📷 Seleziona foto</button>
          <span class="muted small" id="mPhotoName"></span>
        </div>
        <input id="mPhotoInput" type="file" accept="image/*" style="display:none" />
        <img id="mPhotoPrev" class="hidden" alt="" style="width:100%;border-radius:14px;border:1px solid var(--line);margin-top:8px">
      </div>

      <div class="field">
        <span>Posizione (opzionale)</span>
        <div class="row">
          <button class="btn" type="button" id="mGps">Rileva GPS</button>
          <button class="btn secondary" type="button" id="mPickMap">🗺️ Seleziona su mappa</button>
        </div>
        <div class="row">
          <span class="muted" id="mGeoHint">Non rilevata</span>
        </div>
        <div class="row">
          <input id="mLat" type="text" placeholder="Lat" readonly />
          <input id="mLng" type="text" placeholder="Lng" readonly />
        </div>
      </div>
    </div>

    <div class="row" style="justify-content:flex-end;">
      <button class="btn" type="button" id="mSend">Invia recensione</button>
    </div>
  `;

  openModal(html);

  let pickedFile = null;
  let pickedLat = null;
  let pickedLng = null;
  let rating = 0;

  // stelle
  const starsRow = $("mStarsRow");
  const hint = $("mStarsHint");
  const drawStars = ()=>{
    if(!starsRow) return;
    starsRow.innerHTML = "";
    for(let i=1;i<=5;i++){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn secondary";
      b.textContent = (i<=rating) ? "⭐" : "☆";
      b.addEventListener("click", ()=>{
        rating = i;
        if(hint) hint.textContent = `Selezionate: ${rating}/5`;
        drawStars();
      });
      starsRow.appendChild(b);
    }
  };
  drawStars();

  $("mClose")?.addEventListener("click", closeModal);

  $("mPickPhoto")?.addEventListener("click", ()=> $("mPhotoInput")?.click());
  $("mPhotoInput")?.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    pickedFile = f;
    if($("mPhotoName")) $("mPhotoName").textContent = `${f.name || "foto"} • ${(f.size/1024).toFixed(0)} KB`;
    const url = URL.createObjectURL(f);
    const img = $("mPhotoPrev");
    if(img){
      img.src = url;
      img.classList.remove("hidden");
    }
  });

  $("mGps")?.addEventListener("click", ()=>{
    if(!navigator.geolocation){
      if($("mGeoHint")) $("mGeoHint").textContent = "GPS non supportato";
      return;
    }
    if($("mGeoHint")) $("mGeoHint").textContent = "Rilevo GPS...";
    navigator.geolocation.getCurrentPosition((pos)=>{
      pickedLat = pos.coords.latitude;
      pickedLng = pos.coords.longitude;
      if($("mLat")) $("mLat").value = pickedLat.toFixed(6);
      if($("mLng")) $("mLng").value = pickedLng.toFixed(6);
      if($("mGeoHint")) $("mGeoHint").textContent = `OK ✅ ±${Math.round(pos.coords.accuracy)}m`;
    }, ()=>{
      if($("mGeoHint")) $("mGeoHint").textContent = "Permesso negato o errore GPS";
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
  });

  $("mPickMap")?.addEventListener("click", ()=>{
    openPickModal({ onPick: (lat,lng)=>{
      pickedLat = lat; pickedLng = lng;
      if($("mLat")) $("mLat").value = lat.toFixed(6);
      if($("mLng")) $("mLng").value = lng.toFixed(6);
      if($("mGeoHint")) $("mGeoHint").textContent = "Selezionato su mappa ✅";
    }});
  });

  $("mSend")?.addEventListener("click", async ()=>{
    const base = getApiBase();
    const placeName = ($("mReviewPlace")?.value || "").trim();
    const title = ($("mReviewTitle")?.value || "").trim();
    const desc = ($("mReviewDesc")?.value || "").trim();
    const category = ($("mReviewCat")?.value || "").trim();

    if(!placeName || !desc || !rating){
      alert("Inserisci Nome locale, Testo e seleziona le Stelle (1–5).");
      return;
    }

    const btn = $("mSend");
    if(btn){ btn.disabled = true; btn.textContent = "Invio..."; }

    try{
      const fd = new FormData();
      fd.append("name", placeName);
      if(title) fd.append("title", title);
      fd.append("desc", desc);
      fd.append("rating", String(rating));
      if(category) fd.append("category", category);
      if(isNum(pickedLat)) fd.append("lat", String(pickedLat));
      if(isNum(pickedLng)) fd.append("lng", String(pickedLng));
      if(pickedFile) fd.append("photo", pickedFile);

      const res = await fetch(`${base}/review/submit`, { method:"POST", body: fd });
      const data = await res.json().catch(()=>null);
      if(!res.ok || data?.ok === false) throw new Error("review submit failed");

      alert("Recensione inviata ✅ (in attesa di approvazione)");
      closeModal();

      // ricarico (probabilmente non apparirà subito perché pending)
      await refreshApprovedData();
      renderReviews();
      if(STATE.mainMap) renderAllPinsOnMainMap();
    } catch(e){
      console.warn(e);
      alert("Invio recensione non riuscito. Riprova.");
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = "Invia recensione"; }
    }
  });
}

/* =========================
   PLACES UI
========================= */
function setupPlaceButtons(){
  $("btnAddPlace")?.addEventListener("click", ()=> openPlaceFormModal());
}

function renderPlaces(){
  const root = $("placesList");
  if(!root) return;
  root.innerHTML = "";

  if(!STATE.places.length){
    root.innerHTML = `<p class="muted">Nessun posto approvato al momento.</p>`;
    return;
  }

  for(const p of STATE.places){
    const el = document.createElement("div");
    el.className = "item clickable";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(p.category || "posto")}</span>
        ${(isNum(p.lat)&&isNum(p.lng)) ? `<span class="badge">📍</span>` : ``}
        ${p.photoUrl ? `<span class="badge">📷</span>` : ``}
      </div>
      <h4>${escapeHTML(p.title || "Posto")}</h4>
      <p class="muted">${escapeHTML((p.description || "").slice(0, 140))}${(p.description||"").length>140?"…":""}</p>
    `;
    el.addEventListener("click", ()=> openDetailModal({
      type: "place",
      title: p.title || "Posto da visitare",
      subtitle: p.category ? `Categoria: ${p.category}` : "",
      description: p.description || "",
      category: p.category || "",
      lat: p.lat, lng: p.lng,
      photoUrl: p.photoUrl || null
    }));
    root.appendChild(el);
  }
}

function openPlaceFormModal(){
  const html = `
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:18px;font-weight:800;">📍 Aggiungi posto da visitare</div>
        <div class="muted small">Verrà inviato all’Admin. Comparirà solo dopo approvazione.</div>
      </div>
      <button class="btn secondary" id="mClose">Chiudi</button>
    </div>

    <div style="height:10px"></div>

    <label class="field">
      <span>Nome / Titolo</span>
      <input id="mPlaceTitle" type="text" placeholder="Es. Abbazia di Montecassino" maxlength="90">
    </label>

    <label class="field">
      <span>Descrizione</span>
      <textarea id="mPlaceDesc" rows="6" placeholder="Spiega perché è interessante, cosa vedere, info utili..."></textarea>
    </label>

    <div class="grid2">
      <label class="field">
        <span>Categoria</span>
        <input id="mPlaceCat" type="text" placeholder="Es. cultura, natura, eventi...">
      </label>

      <div class="field">
        <span>Foto (consigliata)</span>
        <div class="row">
          <button class="btn secondary" type="button" id="mPickPhoto">📷 Seleziona foto</button>
          <span class="muted small" id="mPhotoName"></span>
        </div>
        <input id="mPhotoInput" type="file" accept="image/*" style="display:none" />
        <img id="mPhotoPrev" class="hidden" alt="" style="width:100%;border-radius:14px;border:1px solid var(--line);margin-top:8px">
      </div>
    </div>

    <div class="field">
      <span>Posizione (opzionale)</span>
      <div class="row">
        <button class="btn" type="button" id="mGps">Rileva GPS</button>
        <button class="btn secondary" type="button" id="mPickMap">🗺️ Seleziona su mappa</button>
      </div>
      <div class="row">
        <span class="muted" id="mGeoHint">Non rilevata</span>
      </div>
      <div class="row">
        <input id="mLat" type="text" placeholder="Lat" readonly />
        <input id="mLng" type="text" placeholder="Lng" readonly />
      </div>
    </div>

    <div class="row" style="justify-content:flex-end;">
      <button class="btn" type="button" id="mSend">Invia posto</button>
    </div>
  `;

  openModal(html);

  let pickedFile = null;
  let pickedLat = null;
  let pickedLng = null;

  $("mClose")?.addEventListener("click", closeModal);

  $("mPickPhoto")?.addEventListener("click", ()=> $("mPhotoInput")?.click());
  $("mPhotoInput")?.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    pickedFile = f;
    if($("mPhotoName")) $("mPhotoName").textContent = `${f.name || "foto"} • ${(f.size/1024).toFixed(0)} KB`;
    const url = URL.createObjectURL(f);
    const img = $("mPhotoPrev");
    if(img){
      img.src = url;
      img.classList.remove("hidden");
    }
  });

  $("mGps")?.addEventListener("click", ()=>{
    if(!navigator.geolocation){
      if($("mGeoHint")) $("mGeoHint").textContent = "GPS non supportato";
      return;
    }
    if($("mGeoHint")) $("mGeoHint").textContent = "Rilevo GPS...";
    navigator.geolocation.getCurrentPosition((pos)=>{
      pickedLat = pos.coords.latitude;
      pickedLng = pos.coords.longitude;
      if($("mLat")) $("mLat").value = pickedLat.toFixed(6);
      if($("mLng")) $("mLng").value = pickedLng.toFixed(6);
      if($("mGeoHint")) $("mGeoHint").textContent = `OK ✅ ±${Math.round(pos.coords.accuracy)}m`;
    }, ()=>{
      if($("mGeoHint")) $("mGeoHint").textContent = "Permesso negato o errore GPS";
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
  });

  $("mPickMap")?.addEventListener("click", ()=>{
    openPickModal({ onPick: (lat,lng)=>{
      pickedLat = lat; pickedLng = lng;
      if($("mLat")) $("mLat").value = lat.toFixed(6);
      if($("mLng")) $("mLng").value = lng.toFixed(6);
      if($("mGeoHint")) $("mGeoHint").textContent = "Selezionato su mappa ✅";
    }});
  });

  $("mSend")?.addEventListener("click", async ()=>{
    const base = getApiBase();
    const title = ($("mPlaceTitle")?.value || "").trim();
    const desc = ($("mPlaceDesc")?.value || "").trim();
    const category = ($("mPlaceCat")?.value || "").trim();

    if(!title || !desc){
      alert("Inserisci Nome/Titolo e Descrizione.");
      return;
    }

    const btn = $("mSend");
    if(btn){ btn.disabled = true; btn.textContent = "Invio..."; }

    try{
      const fd = new FormData();
      fd.append("title", title);
      fd.append("desc", desc);
      if(category) fd.append("category", category);
      if(isNum(pickedLat)) fd.append("lat", String(pickedLat));
      if(isNum(pickedLng)) fd.append("lng", String(pickedLng));
      if(pickedFile) fd.append("photo", pickedFile);

      const res = await fetch(`${base}/place/submit`, { method:"POST", body: fd });
      const data = await res.json().catch(()=>null);
      if(!res.ok || data?.ok === false) throw new Error("place submit failed");

      alert("Posto inviato ✅ (in attesa di approvazione)");
      closeModal();

      await refreshApprovedData();
      renderPlaces();
      if(STATE.mainMap) renderAllPinsOnMainMap();
    } catch(e){
      console.warn(e);
      alert("Invio posto non riuscito. Riprova.");
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = "Invia posto"; }
    }
  });
}

/* =========================
   MODAL (riusabile)
========================= */
function openModal(innerHtml){
  closeModal();

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.55)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "14px";
  overlay.style.zIndex = "99999";

  const box = document.createElement("div");
  box.style.background = "rgba(16,24,42,.96)";
  box.style.border = "1px solid var(--line)";
  box.style.borderRadius = "16px";
  box.style.width = "min(980px, 100%)";
  box.style.maxHeight = "86vh";
  box.style.overflow = "auto";
  box.style.padding = "14px";
  box.innerHTML = innerHtml;

  overlay.addEventListener("click", (e)=>{
    if(e.target === overlay) closeModal();
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  STATE.modalEl = overlay;

  // ESC chiude
  window.addEventListener("keydown", onEscClose);
  function onEscClose(ev){
    if(ev.key === "Escape") closeModal();
  }
  STATE.__escHandler = onEscClose;
}

function closeModal(){
  if(STATE.modalEl){
    STATE.modalEl.remove();
    STATE.modalEl = null;
  }
  if(STATE.__escHandler){
    window.removeEventListener("keydown", STATE.__escHandler);
    STATE.__escHandler = null;
  }
}

function openDetailModal(item){
  const img = item.photoUrl ? `
    <img src="${escapeHTML(item.photoUrl)}" alt="" style="width:100%;border-radius:14px;border:1px solid var(--line);margin:10px 0">
  ` : "";

  const coords = (isNum(item.lat) && isNum(item.lng))
    ? `<div class="muted small">📍 ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</div>`
    : `<div class="muted small">📍 Posizione non disponibile</div>`;

  const html = `
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:18px;font-weight:800;">${escapeHTML(item.title || "")}</div>
        ${item.subtitle ? `<div class="muted small">${escapeHTML(item.subtitle)}</div>` : ``}
        ${item.category ? `<div class="muted small">Categoria: ${escapeHTML(item.category)}</div>` : ``}
      </div>
      <button class="btn secondary" id="mClose">Chiudi</button>
    </div>

    ${img}

    <div style="white-space:pre-wrap;line-height:1.35;margin-top:8px;">${escapeHTML(item.description || "")}</div>
    <div style="height:8px"></div>
    ${coords}
    ${(isNum(item.lat)&&isNum(item.lng)) ? `<div class="row" style="justify-content:flex-end;margin-top:10px;">
      <a class="btn secondary" target="_blank" rel="noopener" href="https://maps.google.com/?q=${item.lat.toFixed(6)},${item.lng.toFixed(6)}">🗺 Apri su Google Maps</a>
    </div>` : ``}
  `;
  openModal(html);
  $("mClose")?.addEventListener("click", closeModal);
}

/* =========================
   MAIN MAP (view map)
========================= */
function ensureMainMap(){
  if(STATE.mainMap) return;
  const el = $("map");
  if(!el || !window.L) return;

  STATE.mainMap = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.mainMap);
  STATE.mainMap.setView([41.492, 13.832], 13);
}

function clearMarkers(){
  if(!STATE.mainMap) return;
  STATE.mainMap.eachLayer(layer=>{
    // lascia tileLayer
    if(layer instanceof L.Marker) STATE.mainMap.removeLayer(layer);
    if(layer instanceof L.CircleMarker) STATE.mainMap.removeLayer(layer);
  });
}

function renderAllPinsOnMainMap(){
  if(!STATE.mainMap) return;
  clearMarkers();

  // posti (circleMarker)
  for(const p of STATE.places){
    if(isNum(p.lat) && isNum(p.lng)){
      const color = catColor(p.category);
      const popup = buildPopupHTML({
        title: p.title,
        subtitle: p.category,
        description: p.description,
        photoUrl: p.photoUrl
      });
      L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.85
      }).addTo(STATE.mainMap).bindPopup(popup);
    }
  }

  // recensioni (circleMarker, colore “review” + categoria)
  for(const r of STATE.reviews){
    if(isNum(r.lat) && isNum(r.lng)){
      const color = catColor(r.category) || typeColor("review");
      const popup = buildPopupHTML({
        title: (r.title || "Recensione"),
        subtitle: `${starString(r.rating)} • ${r.placeName || ""}`.trim(),
        description: r.description,
        photoUrl: r.photoUrl
      });
      L.circleMarker([r.lat, r.lng], {
        radius: 8,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.75
      }).addTo(STATE.mainMap).bindPopup(popup);
    }
  }

  // segnalazioni locali (marker classico)
  for(const s of STATE.localReports){
    if(isNum(s.lat) && isNum(s.lng)){
      const popup = buildPopupHTML({
        title: s.title,
        subtitle: "Segnalazione locale",
        description: s.description,
        photoUrl: null
      });
      L.marker([s.lat, s.lng]).addTo(STATE.mainMap).bindPopup(popup);
    }
  }
}

function buildPopupHTML({ title, subtitle, description, photoUrl }){
  const img = photoUrl ? `<img src="${escapeHTML(photoUrl)}" alt="" style="width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.12);margin-top:8px">` : "";
  return `
    <div style="min-width:220px;">
      <div style="font-weight:800;">${escapeHTML(title || "")}</div>
      ${subtitle ? `<div style="opacity:.85;font-size:12px;">${escapeHTML(subtitle)}</div>` : ``}
      ${description ? `<div style="opacity:.92;font-size:12px;margin-top:6px;">${escapeHTML((description||"").slice(0,220))}${(description||"").length>220?"…":""}</div>` : ``}
      ${img}
    </div>
  `;
}

/* =========================
   BOOT
========================= */
async function boot(){
  const base = getApiBase();
  STATE.apiBase = base;
  save(LS.API_BASE, base);

  setupTabs();
  setupPhoto();
  setupGeo();

  loadLocalReports();
  renderLocalReports();
  setupReportButtons();

  setupReviewButtons();
  setupPlaceButtons();

  // primo caricamento (reviews/places approvati)
  await refreshApprovedData();
  renderPlaces();
  renderReviews();

  setGeoStatus("Non rilevata");
}

boot();
