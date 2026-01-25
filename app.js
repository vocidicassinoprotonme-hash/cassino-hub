/* app.js — Cassino Hub (main) */

const $ = (id) => document.getElementById(id);

const LS = {
  REPORTS_LOCAL: "ch_reports_local_v1",
  LAST_PHOTO: "ch_last_photo_v1",
  GH_TOKEN: "ch_ghToken",
  GH_REPO: "ch_ghRepo",
  WORKER_BASE: "ch_workerBase" // opzionale (se vuoi usare Worker per invio)
};

// ✅ metti qui il tuo Worker base URL (puoi anche lasciarlo vuoto: in quel caso "Invia" salva solo in locale)
const DEFAULT_WORKER_BASE = "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev";

const STATE = {
  view: "report",

  // segnalazione in composizione
  photoFile: null,
  photoDataUrl: null, // base64 (compress)
  pickLatLng: null,

  // dati
  reportsLocal: [],
  places: [],
  reviews: [],

  // mappe
  mapMain: null,
  mapPick: null,
  mapPickMarker: null,

  // admin
  ghToken: "",
  ghRepo: "",
  workerBase: ""
};

// ---------- UTIL ----------
function safeJSONParse(s, fallback){
  try { return JSON.parse(s); } catch { return fallback; }
}
function saveLS(key, val){
  try { localStorage.setItem(key, val); } catch {}
}
function loadLS(key, fallback=""){
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function delLS(key){
  try { localStorage.removeItem(key); } catch {}
}
function escapeHTML(s){
  return (s||"").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function nowISO(){ return new Date().toISOString(); }
function uid(){
  return (crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
}
function isNum(n){ return typeof n === "number" && Number.isFinite(n); }

// Comprime immagine in JPEG max 1280px
async function fileToCompressedDataURL(file, maxSize=1280, quality=0.82){
  const img = new Image();
  const url = URL.createObjectURL(file);

  await new Promise((res, rej)=>{
    img.onload = res; img.onerror = rej; img.src = url;
  });

  const w = img.width, h = img.height;
  const scale = Math.min(1, maxSize / Math.max(w,h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, cw, ch);

  URL.revokeObjectURL(url);

  return canvas.toDataURL("image/jpeg", quality);
}

// ---------- BOOT ----------
document.addEventListener("DOMContentLoaded", async () => {
  // carica local
  STATE.reportsLocal = safeJSONParse(loadLS(LS.REPORTS_LOCAL, "[]"), []);
  STATE.photoDataUrl = loadLS(LS.LAST_PHOTO, "") || null;

  // admin settings
  STATE.ghToken = loadLS(LS.GH_TOKEN, "");
  STATE.ghRepo  = loadLS(LS.GH_REPO, "");
  STATE.workerBase = loadLS(LS.WORKER_BASE, DEFAULT_WORKER_BASE) || DEFAULT_WORKER_BASE;

  // init UI
  bindTabs();
  bindReportUI();
  bindListsUI();
  bindAdminUI();

  // carica data
  await loadDataFiles();

  // render iniziale
  renderReportsLocal();
  renderPlaces();
  renderReviews();

  // init mappa solo quando vai in tab "map"
  setView("report");
});

function bindTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", () => {
      const v = btn.dataset.view;
      setView(v);
    });
  });
}

function setView(view){
  STATE.view = view;

  // tab active
  document.querySelectorAll(".tab").forEach(b=>{
    b.classList.toggle("active", b.dataset.view === view);
  });

  // sections
  const map = {
    report: "view-report",
    reviews: "view-reviews",
    places: "view-places",
    map: "view-map",
    admin: "view-admin"
  };
  Object.values(map).forEach(id => $(id)?.classList.add("hidden"));
  $(map[view])?.classList.remove("hidden");

  // admin tab visibility
  const adminTab = document.querySelector(".tab.adminOnly");
  if (adminTab) adminTab.classList.toggle("hidden", !STATE.ghToken);

  // init map when open map view
  if(view === "map"){
    ensureMainMap();
    refreshMainMapMarkers();
    setTimeout(()=> STATE.mapMain?.invalidateSize?.(), 100);
  }
}

// ---------- REPORT UI ----------
function bindReportUI(){
  // Gallery / Camera buttons
  $("btnPickGallery")?.addEventListener("click", () => $("rPhotoGallery")?.click());
  $("btnPickCamera")?.addEventListener("click", () => $("rPhotoCamera")?.click());

  // file inputs
  $("rPhotoGallery")?.addEventListener("change", onPickPhoto);
  $("rPhotoCamera")?.addEventListener("change", onPickPhoto);

  // GPS
  $("btnGeo")?.addEventListener("click", detectGPS);

  // Pick on map modal
  $("btnPickOnMap")?.addEventListener("click", openPickModal);
  $("btnPickCancel")?.addEventListener("click", closePickModal);
  $("btnPickUse")?.addEventListener("click", usePickedPoint);

  // Save local / Send
  $("btnSaveLocal")?.addEventListener("click", saveReportLocal);
  $("btnSend")?.addEventListener("click", sendReport);

  // iniziale: se worker base è vuoto, invio fa fallback a local
  updateSendHint();
}

function updateSendHint(){
  // Il tuo HTML ha una nota, qui rendiamo coerente:
  // se workerBase non c'è -> invia salva solo in locale (non disabilito, così non “sembra rotto”)
  // puoi cambiare comportamento se vuoi.
}

async function onPickPhoto(e){
  const file = e.target.files?.[0];
  if(!file) return;

  STATE.photoFile = file;

  try{
    const dataUrl = await fileToCompressedDataURL(file);
    STATE.photoDataUrl = dataUrl;
    saveLS(LS.LAST_PHOTO, dataUrl);
    showPhotoPreview(file.name, dataUrl);
  } catch(err){
    console.warn(err);
    alert("Errore nel caricamento foto.");
  } finally {
    // reset input così puoi selezionare lo stesso file di nuovo
    e.target.value = "";
  }
}

function showPhotoPreview(name, dataUrl){
  $("photoPreviewWrap")?.classList.remove("hidden");
  if ($("photoName")) $("photoName").textContent = name ? `File: ${name}` : "";
  if ($("photoPreview")) $("photoPreview").src = dataUrl;
}

async function detectGPS(){
  if(!("geolocation" in navigator)){
    if ($("geoStatus")) $("geoStatus").textContent = "Geolocalizzazione non supportata.";
    return;
  }
  if ($("geoStatus")) $("geoStatus").textContent = "Rilevo posizione…";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      if ($("rLat")) $("rLat").value = latitude.toFixed(6);
      if ($("rLng")) $("rLng").value = longitude.toFixed(6);
      if ($("geoStatus")) $("geoStatus").textContent = `OK • ±${Math.round(accuracy)}m`;
    },
    (err) => {
      console.warn(err);
      if ($("geoStatus")) $("geoStatus").textContent = "Permesso negato o errore GPS.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

// ---------- MAP PICK MODAL ----------
function openPickModal(){
  const modal = $("mapPickModal");
  if(!modal) return;

  modal.classList.remove("hidden");

  // init leaflet map only once
  ensurePickMap();
  setTimeout(()=> STATE.mapPick?.invalidateSize?.(), 120);
}

function closePickModal(){
  $("mapPickModal")?.classList.add("hidden");
}

function ensurePickMap(){
  if(STATE.mapPick) return;
  if(typeof L === "undefined"){
    alert("Leaflet non caricato. Controlla connessione o blocchi.");
    return;
  }

  STATE.mapPick = L.map("mapPick");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.mapPick);

  // centro Cassino
  STATE.mapPick.setView([41.492, 13.832], 13);

  STATE.mapPick.on("click", (e)=>{
    STATE.pickLatLng = e.latlng;
    if(STATE.mapPickMarker){
      STATE.mapPickMarker.setLatLng(e.latlng);
    } else {
      STATE.mapPickMarker = L.marker(e.latlng).addTo(STATE.mapPick);
    }
    if ($("pickHint")) $("pickHint").textContent = `Selezionato: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
  });
}

function usePickedPoint(){
  if(!STATE.pickLatLng){
    alert("Tocca un punto sulla mappa prima di confermare.");
    return;
  }
  if ($("rLat")) $("rLat").value = STATE.pickLatLng.lat.toFixed(6);
  if ($("rLng")) $("rLng").value = STATE.pickLatLng.lng.toFixed(6);
  if ($("geoStatus")) $("geoStatus").textContent = "Selezionata da mappa ✅";
  closePickModal();
}

// ---------- REPORTS LOCAL ----------
function bindListsUI(){
  $("btnExport")?.addEventListener("click", exportLocalJSON);
  $("btnClear")?.addEventListener("click", clearLocal);
}

function getReportDraft(){
  return {
    id: uid(),
    createdAt: nowISO(),
    title: ($("rTitle")?.value || "").trim(),
    description: ($("rDesc")?.value || "").trim(),
    lat: parseFloat(($("rLat")?.value || "").trim()),
    lng: parseFloat(($("rLng")?.value || "").trim()),
    photoDataUrl: STATE.photoDataUrl || null
  };
}

function validateDraft(d){
  if(!d.title) return "Inserisci un titolo.";
  if(!d.description) return "Inserisci una descrizione.";
  // lat/lng facoltativi
  if(!Number.isFinite(d.lat)) d.lat = null;
  if(!Number.isFinite(d.lng)) d.lng = null;
  return null;
}

function saveReportLocal(){
  const d = getReportDraft();
  const err = validateDraft(d);
  if(err){ alert(err); return; }

  STATE.reportsLocal.unshift(d);
  saveLS(LS.REPORTS_LOCAL, JSON.stringify(STATE.reportsLocal));
  renderReportsLocal();

  // pulisci form (mantengo foto se vuoi: io la resetto)
  clearReportForm(true);

  alert("Salvata sul telefono ✅");
  // se sei in tab map, aggiorna markers
  refreshMainMapMarkers();
}

function clearReportForm(resetPhoto=false){
  if ($("rTitle")) $("rTitle").value = "";
  if ($("rDesc")) $("rDesc").value = "";
  if ($("rLat")) $("rLat").value = "";
  if ($("rLng")) $("rLng").value = "";
  if ($("geoStatus")) $("geoStatus").textContent = "Non rilevata";

  if(resetPhoto){
    STATE.photoFile = null;
    STATE.photoDataUrl = null;
    delLS(LS.LAST_PHOTO);
    $("photoPreviewWrap")?.classList.add("hidden");
    if ($("photoPreview")) $("photoPreview").removeAttribute("src");
    if ($("photoName")) $("photoName").textContent = "";
  }
}

function renderReportsLocal(){
  const root = $("reportList");
  if(!root) return;
  root.innerHTML = "";

  if(!STATE.reportsLocal.length){
    root.innerHTML = `<p class="muted">Nessuna segnalazione salvata.</p>`;
    return;
  }

  for(const r of STATE.reportsLocal){
    const el = document.createElement("div");
    el.className = "item";
    const when = new Date(r.createdAt).toLocaleString("it-IT");
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${when}</span>
        ${r.photoDataUrl ? `<span class="badge">📷</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title)}</h4>
      <p class="muted">${escapeHTML(r.description)}</p>
    `;
    root.appendChild(el);
  }
}

function exportLocalJSON(){
  const blob = new Blob([JSON.stringify(STATE.reportsLocal, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cassino-hub-segnalazioni-locali.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function clearLocal(){
  if(!confirm("Vuoi svuotare l’elenco locale?")) return;
  STATE.reportsLocal = [];
  saveLS(LS.REPORTS_LOCAL, "[]");
  renderReportsLocal();
  refreshMainMapMarkers();
}

// ---------- SEND TO WORKER (opzionale) ----------
async function sendReport(){
  const d = getReportDraft();
  const err = validateDraft(d);
  if(err){ alert(err); return; }

  // se non vuoi inviare online, salva e basta
  const base = (STATE.workerBase || DEFAULT_WORKER_BASE || "").trim();
  if(!base){
    saveReportLocal();
    return;
  }

  // invio: endpoint presunto /submit
  // (se nel tuo Worker hai un path diverso dimmelo e lo adeguo)
  const url = `${base.replace(/\/$/,"")}/submit`;

  // UI feedback
  $("btnSend")?.setAttribute("disabled", "disabled");
  const oldText = $("btnSend")?.textContent;
  if ($("btnSend")) $("btnSend").textContent = "Invio…";

  try{
    const payload = {
      title: d.title,
      description: d.description,
      lat: d.lat,
      lng: d.lng,
      // foto come base64 jpeg (compress). Se vuoi: invio come multipart, ma qui è semplice.
      photoDataUrl: d.photoDataUrl
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(()=>null);

    if(!res.ok || !data?.ok){
      console.warn("send error", res.status, data);
      alert("Invio non riuscito. Ho salvato in locale ✅");
      saveReportLocal();
      return;
    }

    // success
    alert("Inviata ✅");
    clearReportForm(true);
    // opzionale: salva comunque una copia locale
    STATE.reportsLocal.unshift({ ...d, sentOnline: true });
    saveLS(LS.REPORTS_LOCAL, JSON.stringify(STATE.reportsLocal));
    renderReportsLocal();
    refreshMainMapMarkers();

  } catch(e){
    console.warn(e);
    alert("Errore rete. Ho salvato in locale ✅");
    saveReportLocal();
  } finally {
    if ($("btnSend")) $("btnSend").removeAttribute("disabled");
    if ($("btnSend")) $("btnSend").textContent = oldText || "Invia";
  }
}

// ---------- LOAD DATA (places / reviews) ----------
async function loadDataFiles(){
  try{
    const [placesRes, reviewsRes] = await Promise.all([
      fetch("./data/places.json", { cache: "no-store" }),
      fetch("./data/reviews.json", { cache: "no-store" })
    ]);

    if(placesRes.ok) STATE.places = await placesRes.json();
    if(reviewsRes.ok) STATE.reviews = await reviewsRes.json();

  } catch(e){
    console.warn("loadDataFiles", e);
    // non blocco l’app
    STATE.places = STATE.places || [];
    STATE.reviews = STATE.reviews || [];
  }
}

function renderPlaces(){
  const root = $("placesList");
  if(!root) return;
  root.innerHTML = "";

  if(!STATE.places?.length){
    root.innerHTML = `<p class="muted">Nessun posto disponibile.</p>`;
    return;
  }

  for(const p of STATE.places){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(p.category || "posto")}</span>
        ${isNum(p.lat) && isNum(p.lng) ? `<span class="badge">📍</span>` : ``}
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

  if(!STATE.reviews?.length){
    root.innerHTML = `<p class="muted">Nessuna recensione disponibile.</p>`;
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
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(r.text || "")}</p>
    `;
    root.appendChild(el);
  }
}

// ---------- MAIN MAP ----------
function ensureMainMap(){
  if(STATE.mapMain) return;
  if(typeof L === "undefined") return;

  STATE.mapMain = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.mapMain);
  STATE.mapMain.setView([41.492, 13.832], 13);
}

function refreshMainMapMarkers(){
  if(!STATE.mapMain) return;

  // pulisco layer marker (semplice)
  STATE.mapMain.eachLayer(layer=>{
    // lascia tile layer
    if(layer instanceof L.TileLayer) return;
    STATE.mapMain.removeLayer(layer);
  });

  // posti
  for(const p of (STATE.places || [])){
    if(isNum(p.lat) && isNum(p.lng)){
      L.marker([p.lat, p.lng]).addTo(STATE.mapMain)
        .bindPopup(`<b>${escapeHTML(p.name || "")}</b><br>${escapeHTML(p.category || "")}`);
    }
  }

  // recensioni
  for(const r of (STATE.reviews || [])){
    if(isNum(r.lat) && isNum(r.lng)){
      L.circleMarker([r.lat, r.lng], { radius: 6 }).addTo(STATE.mapMain)
        .bindPopup(`<b>${escapeHTML(r.title || "")}</b><br>${escapeHTML(r.place || "")}`);
    }
  }

  // segnalazioni locali
  for(const s of (STATE.reportsLocal || [])){
    if(isNum(s.lat) && isNum(s.lng)){
      L.circleMarker([s.lat, s.lng], { radius: 7 }).addTo(STATE.mapMain)
        .bindPopup(`<b>${escapeHTML(s.title || "")}</b><br>${escapeHTML(s.description || "")}`);
    }
  }
}

// ---------- ADMIN (push /data) ----------
function bindAdminUI(){
  // mostra tab admin solo se token esiste
  const adminTab = document.querySelector(".tab.adminOnly");
  if (adminTab) adminTab.classList.toggle("hidden", !STATE.ghToken);

  // carica valori nei campi
  if ($("ghToken")) $("ghToken").value = STATE.ghToken || "";
  if ($("ghRepo")) $("ghRepo").value = STATE.ghRepo || "";

  $("btnSaveToken")?.addEventListener("click", ()=>{
    STATE.ghToken = ($("ghToken")?.value || "").trim();
    saveLS(LS.GH_TOKEN, STATE.ghToken);
    const adminTab = document.querySelector(".tab.adminOnly");
    if (adminTab) adminTab.classList.toggle("hidden", !STATE.ghToken);
    alert("Token salvato ✅");
  });

  $("btnRemoveToken")?.addEventListener("click", ()=>{
    delLS(LS.GH_TOKEN);
    STATE.ghToken = "";
    if ($("ghToken")) $("ghToken").value = "";
    const adminTab = document.querySelector(".tab.adminOnly");
    if (adminTab) adminTab.classList.add("hidden");
    alert("Token rimosso ✅");
    if(STATE.view === "admin") setView("report");
  });

  $("btnPushData")?.addEventListener("click", pushDataToGithub);
}

function ghHeaders(){
  return {
    "Authorization": `Bearer ${STATE.ghToken}`,
    "Accept": "application/vnd.github+json"
  };
}
async function ghGetFile(path){
  const [owner, repo] = (STATE.ghRepo || "").split("/");
  if(!owner || !repo) throw new Error("Repo non valido");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, { headers: ghHeaders() });
  const data = await res.json().catch(()=>null);
  if(!res.ok) throw new Error(`GET ${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function ghPutFile(path, contentStr, sha, message){
  const [owner, repo] = (STATE.ghRepo || "").split("/");
  if(!owner || !repo) throw new Error("Repo non valido");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(contentStr)))
  };
  if(sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(()=>null);
  if(!res.ok) throw new Error(`PUT ${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function pushDataToGithub(){
  STATE.ghToken = ($("ghToken")?.value || "").trim();
  STATE.ghRepo  = ($("ghRepo")?.value || "").trim();
  saveLS(LS.GH_TOKEN, STATE.ghToken);
  saveLS(LS.GH_REPO, STATE.ghRepo);

  if(!STATE.ghToken || !STATE.ghRepo){
    alert("Inserisci Token e Repo (owner/repo).");
    return;
  }

  try{
    // prendo SHA correnti
    const placesFile = await ghGetFile("data/places.json");
    const reviewsFile = await ghGetFile("data/reviews.json");

    const placesStr = JSON.stringify(STATE.places || [], null, 2);
    const reviewsStr = JSON.stringify(STATE.reviews || [], null, 2);

    await ghPutFile("data/places.json", placesStr, placesFile.sha, `Update places ${nowISO()}`);
    await ghPutFile("data/reviews.json", reviewsStr, reviewsFile.sha, `Update reviews ${nowISO()}`);

    alert("Pubblicato su GitHub ✅ (attendi GitHub Pages ~1 min)");
  } catch(e){
    console.warn(e);
    alert("Errore pubblicazione su GitHub. Controlla permessi token (Contents: Read/Write) e repo.");
  }
}
