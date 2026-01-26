/* Cassino Hub - app.js (root) */

const $ = (id) => document.getElementById(id);

const LS = {
  API_BASE: "ch_apiBase_public",
  LOCAL_REPORTS: "ch_localReports_v1",
  ADMIN_MODE: "ch_adminMode"
};

// ✅ Imposta qui il tuo Worker base (quello che invia su Telegram)
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

  places: [],
  reviews: []
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

function setGeoStatus(msg){ if ($("geoStatus")) $("geoStatus").textContent = msg; }

function getApiBase(){
  const stored = load(LS.API_BASE, "");
  return (stored || DEFAULT_API_BASE).replace(/\/$/, "");
}

/* =========================
   TAB NAV
========================= */
function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");

      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
      const el = document.getElementById(`view-${view}`);
      if(el) el.classList.remove("hidden");

      if(view === "map") {
        ensureMainMap();
        renderAllPinsOnMainMap();
      }
    });
  });
}

/* =========================
   FOTO: gallery / camera
========================= */
function setupPhoto(){
  $("btnPickGallery")?.addEventListener("click", ()=>{
    $("rPhotoGallery")?.click();
  });

  $("btnPickCamera")?.addEventListener("click", ()=>{
    $("rPhotoCamera")?.click();
  });

  const onFile = (file)=>{
    if(!file) return;
    STATE.pickedPhoto = file;
    if ($("photoName")) $("photoName").textContent = `${file.name || "foto"} • ${(file.size/1024).toFixed(0)} KB`;
    const url = URL.createObjectURL(file);
    if ($("photoPreview")) $("photoPreview").src = url;
    $("photoPreviewWrap")?.classList.remove("hidden");
  };

  $("rPhotoGallery")?.addEventListener("change", (e)=>{
    const file = e.target.files?.[0];
    onFile(file);
  });

  $("rPhotoCamera")?.addEventListener("change", (e)=>{
    const file = e.target.files?.[0];
    onFile(file);
  });
}

/* =========================
   GEO: GPS + pick su mappa
========================= */
function setupGeo(){
  $("btnGeo")?.addEventListener("click", ()=>{
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
  });

  $("btnPickOnMap")?.addEventListener("click", ()=>{
    openPickModal();
  });

  $("btnPickCancel")?.addEventListener("click", closePickModal);

  $("btnPickUse")?.addEventListener("click", ()=>{
    if(!STATE.pickLatLng){
      alert("Tocca un punto sulla mappa prima di confermare.");
      return;
    }
    const { lat, lng } = STATE.pickLatLng;
    STATE.pickedLat = lat;
    STATE.pickedLng = lng;
    if ($("rLat")) $("rLat").value = lat.toFixed(6);
    if ($("rLng")) $("rLng").value = lng.toFixed(6);
    setGeoStatus("Selezionato su mappa ✅");
    closePickModal();
  });
}

function openPickModal(){
  $("mapPickModal")?.classList.remove("hidden");
  ensurePickMap();
  // centra su Cassino o su coordinate già presenti
  if(isNum(STATE.pickedLat) && isNum(STATE.pickedLng)){
    STATE.pickMap.setView([STATE.pickedLat, STATE.pickedLng], 15);
    setPickMarker([STATE.pickedLat, STATE.pickedLng]);
    STATE.pickLatLng = { lat: STATE.pickedLat, lng: STATE.pickedLng };
  } else {
    STATE.pickMap.setView([41.492, 13.832], 13);
  }
}

function closePickModal(){
  $("mapPickModal")?.classList.add("hidden");
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
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(new Date(r.createdAt).toLocaleString("it-IT"))}</span>
        ${r.photoName ? `<span class="badge">📷</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(r.description || "")}</p>
    `;
    root.appendChild(el);
  }
}

function setupReportButtons(){
  $("btnSaveLocal")?.addEventListener("click", ()=>{
    const report = buildReportPayload({ includePhotoBase64:true });
    if(!report.title || !report.description){
      alert("Inserisci Titolo e Descrizione.");
      return;
    }
    STATE.localReports.unshift(report);
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

function buildReportPayload({ includePhotoBase64=false } = {}){
  const title = ($("rTitle")?.value || "").trim();
  const description = ($("rDesc")?.value || "").trim();
  const lat = isNum(STATE.pickedLat) ? STATE.pickedLat : null;
  const lng = isNum(STATE.pickedLng) ? STATE.pickedLng : null;

  const base = {
    id: uid(),
    title,
    description,
    lat, lng,
    createdAt: new Date().toISOString()
  };

  if(includePhotoBase64 && STATE.pickedPhoto){
    // ATTENZIONE: base64 può pesare. Va bene per test/locale.
    base.photoName = STATE.pickedPhoto.name || "foto.jpg";
  }
  return base;
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

  // UI
  const btn = $("btnSend");
  if(btn){ btn.disabled = true; btn.textContent = "Invio..."; }

  try{
    // ✅ Primo tentativo: multipart/form-data (gestisce foto facilmente)
    const fd = new FormData();
    fd.append("id", payload.id);
    fd.append("title", payload.title);
    fd.append("description", payload.description);
    if(isNum(payload.lat)) fd.append("lat", String(payload.lat));
    if(isNum(payload.lng)) fd.append("lng", String(payload.lng));
    fd.append("createdAt", payload.createdAt);
    if(STATE.pickedPhoto) fd.append("photo", STATE.pickedPhoto);

    const res = await fetch(`${base}/submit`, { method:"POST", body: fd });
    const data = await res.json().catch(()=>null);

    if(!res.ok || (data && data.ok === false)){
      // fallback: JSON (se il Worker non accetta multipart)
      const res2 = await fetch(`${base}/submit`, {
        method:"POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          ...payload,
          // niente file qui: se serve foto con JSON va gestita nel Worker
          photo: null
        })
      });
      const data2 = await res2.json().catch(()=>null);
      if(!res2.ok || (data2 && data2.ok === false)){
        throw new Error(`Submit failed: ${res.status}/${res2.status}`);
      }
    }

    // Success ✅
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
   PLACES + REVIEWS (lettura semplice da /data)
========================= */
async function loadDataFiles(){
  try{
    const p = await fetch("./data/places.json", { cache:"no-store" }).then(r=>r.ok?r.json():[]);
    const r = await fetch("./data/reviews.json", { cache:"no-store" }).then(r=>r.ok?r.json():[]);
    STATE.places = Array.isArray(p) ? p : [];
    STATE.reviews = Array.isArray(r) ? r : [];
  } catch(e){
    console.warn("load data failed", e);
    STATE.places = [];
    STATE.reviews = [];
  }
  renderPlaces();
  renderReviews();
}

function renderPlaces(){
  const root = $("placesList");
  if(!root) return;
  root.innerHTML = "";
  if(!STATE.places.length){
    root.innerHTML = `<p class="muted">Nessun posto.</p>`;
    return;
  }
  for(const p of STATE.places){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(p.category || "posto")}</span>
        ${isNum(p.lat)&&isNum(p.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(p.name || "")}</h4>
      <p class="muted">${escapeHTML(p.description || "")}</p>
    `;
    root.appendChild(el);
  }
}

function renderReviews(){
  const root = $("reviewsList");
  if(!root) return;
  root.innerHTML = "";
  if(!STATE.reviews.length){
    root.innerHTML = `<p class="muted">Nessuna recensione.</p>`;
    return;
  }
  for(const r of STATE.reviews){
    const stars = "⭐".repeat(Math.max(0, Math.min(5, Number(r.rating || 0))));
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${stars || "recensione"}</span>
        ${r.place ? `<span class="badge">${escapeHTML(r.place)}</span>` : ``}
        ${isNum(r.lat)&&isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(r.text || "")}</p>
    `;
    root.appendChild(el);
  }
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

function renderAllPinsOnMainMap(){
  if(!STATE.mainMap) return;

  // pulizia layer marker
  STATE.mainMap.eachLayer(layer=>{
    // lascia tileLayer
    if(layer instanceof L.Marker) STATE.mainMap.removeLayer(layer);
  });

  // posti
  for(const p of STATE.places){
    if(isNum(p.lat) && isNum(p.lng)){
      L.marker([p.lat, p.lng]).addTo(STATE.mainMap).bindPopup(`<b>${escapeHTML(p.name||"")}</b><br>${escapeHTML(p.category||"")}`);
    }
  }
  // recensioni
  for(const r of STATE.reviews){
    if(isNum(r.lat) && isNum(r.lng)){
      L.marker([r.lat, r.lng]).addTo(STATE.mainMap).bindPopup(`<b>${escapeHTML(r.title||"")}</b><br>${escapeHTML(r.place||"")}`);
    }
  }
  // segnalazioni locali
  for(const s of STATE.localReports){
    if(isNum(s.lat) && isNum(s.lng)){
      L.marker([s.lat, s.lng]).addTo(STATE.mainMap).bindPopup(`<b>${escapeHTML(s.title||"")}</b><br>${escapeHTML(s.description||"")}`);
    }
  }
}

/* =========================
   BOOT
========================= */
function boot(){
  // api base in storage (se vuoi cambiarlo in futuro)
  const base = getApiBase();
  STATE.apiBase = base;
  save(LS.API_BASE, base);

  setupTabs();
  setupPhoto();
  setupGeo();

  loadLocalReports();
  renderLocalReports();
  setupReportButtons();

  loadDataFiles().catch(()=>{});
  setGeoStatus("Non rilevata");
}

boot();
