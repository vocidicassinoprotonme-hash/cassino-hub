const $ = (id) => document.getElementById(id);

// =====================
// STATE
// =====================
const STATE = {
  reports: loadJSON("ch_reports", []),
  reviews: [],
  places: [],
  geo: null, // {lat,lng,acc}
  endpoint: "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev/submit",
  map: null,
  markers: [],

  // map picker
  pickMap: null,
  pickMarker: null,
  pickedLatLng: null
};

// Foto selezionata (galleria o camera)
let SELECTED_PHOTO_FILE = null;

// =====================
// Storage
// =====================
function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

// =====================
// Helpers
// =====================
function on(id, event, handler){
  const el = $(id);
  if(!el) return false;
  el.addEventListener(event, handler);
  return true;
}

function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

// =====================
// Navigation
// =====================
function switchView(view){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const panel = $(`view-${view}`);
  if(panel) panel.classList.remove("hidden");
  if(view === "map") setTimeout(renderMap, 50);
}

function initTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=> switchView(btn.dataset.view));
  });
}

// =====================
// PHOTO (Gallery + Camera)
// =====================
function initPhoto(){
  on("btnPickGallery","click", ()=> $("rPhotoGallery")?.click());
  on("btnPickCamera","click", ()=> $("rPhotoCamera")?.click());
  on("rPhotoGallery","change", onPhotoChosen);
  on("rPhotoCamera","change", onPhotoChosen);
}

function onPhotoChosen(e){
  const file = e.target.files?.[0];
  if(!file) return;

  SELECTED_PHOTO_FILE = file;

  // reset other input
  if(e.target.id === "rPhotoGallery" && $("rPhotoCamera")) $("rPhotoCamera").value = "";
  if(e.target.id === "rPhotoCamera" && $("rPhotoGallery")) $("rPhotoGallery").value = "";

  if ($("photoPreviewWrap")) {
    $("photoPreviewWrap").classList.remove("hidden");
    if($("photoName")) $("photoName").textContent = `${file.name} • ${(file.size/1024).toFixed(0)} KB`;
    if($("photoPreview")) $("photoPreview").src = URL.createObjectURL(file);
  }
}

function clearPhotoSelection(){
  SELECTED_PHOTO_FILE = null;
  if($("rPhotoGallery")) $("rPhotoGallery").value = "";
  if($("rPhotoCamera")) $("rPhotoCamera").value = "";
  if($("photoPreviewWrap")) $("photoPreviewWrap").classList.add("hidden");
  if($("photoName")) $("photoName").textContent = "";
  if($("photoPreview")) $("photoPreview").src = "";
}

// =====================
// GEO (GPS)
// =====================
function initGeo(){
  on("btnGeo","click", ()=>{
    if(!$("geoStatus")) return;
    $("geoStatus").textContent = "Rilevo...";
    if(!navigator.geolocation){
      $("geoStatus").textContent = "Non supportato";
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos)=>{
        const {latitude, longitude, accuracy} = pos.coords;
        STATE.geo = { lat: latitude, lng: longitude, acc: accuracy };
        if($("rLat")) $("rLat").value = latitude.toFixed(6);
        if($("rLng")) $("rLng").value = longitude.toFixed(6);
        $("geoStatus").textContent = `OK ±${Math.round(accuracy)}m`;
      },
      (err)=>{
        $("geoStatus").textContent = "Non disponibile";
        console.warn(err);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

// =====================
// MAP PICKER (select point on map)
// =====================
function initMapPicker(){
  on("btnPickOnMap","click", openPickMap);
  on("btnPickCancel","click", closePickMap);
  on("btnPickUse","click", usePickedPoint);

  // click on backdrop closes modal
  document.addEventListener("click", (e)=>{
    if(e.target && e.target.id === "mapPickModal") closePickMap();
  });
}

function openPickMap(){
  if(!$("mapPickModal") || !$("mapPick")){
    alert("Manca il modal mappa (mapPickModal/mapPick). Controlla index.html.");
    return;
  }

  $("mapPickModal").classList.remove("hidden");

  if(!STATE.pickMap){
    STATE.pickMap = L.map("mapPick");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.pickMap);

    STATE.pickMap.on("click", (e)=>{
      STATE.pickedLatLng = e.latlng;

      if(!STATE.pickMarker) STATE.pickMarker = L.marker(e.latlng).addTo(STATE.pickMap);
      else STATE.pickMarker.setLatLng(e.latlng);

      if($("pickHint")) $("pickHint").textContent = `Scelto: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    });
  }

  const lat = $("rLat")?.value ? Number($("rLat").value) : 41.492;
  const lng = $("rLng")?.value ? Number($("rLng").value) : 13.832;
  STATE.pickMap.setView([lat, lng], 13);

  if(STATE.pickedLatLng){
    if(!STATE.pickMarker) STATE.pickMarker = L.marker(STATE.pickedLatLng).addTo(STATE.pickMap);
    else STATE.pickMarker.setLatLng(STATE.pickedLatLng);

    if($("pickHint")) $("pickHint").textContent = `Scelto: ${STATE.pickedLatLng.lat.toFixed(6)}, ${STATE.pickedLatLng.lng.toFixed(6)}`;
  } else {
    if($("pickHint")) $("pickHint").textContent = "Tocca la mappa per scegliere";
  }

  setTimeout(()=> STATE.pickMap.invalidateSize(), 180);
}

function closePickMap(){
  $("mapPickModal")?.classList.add("hidden");
}

function usePickedPoint(){
  if(!STATE.pickedLatLng){
    alert("Tocca un punto sulla mappa prima di confermare.");
    return;
  }
  if($("rLat")) $("rLat").value = STATE.pickedLatLng.lat.toFixed(6);
  if($("rLng")) $("rLng").value = STATE.pickedLatLng.lng.toFixed(6);

  if($("geoStatus")) $("geoStatus").textContent = "Selezionata da mappa ✅";
  STATE.geo = { lat: STATE.pickedLatLng.lat, lng: STATE.pickedLatLng.lng, acc: null };
  closePickMap();
}

// =====================
// REPORT: local save + send
// =====================
function initReports(){
  on("btnSaveLocal","click", async ()=>{
    const item = await buildReportItemForLocal();
    if(!item) return;
    STATE.reports.unshift(item);
    saveJSON("ch_reports", STATE.reports);
    clearReportForm();
    renderReports();
    alert("Salvata sul telefono ✅");
  });

  on("btnSend","click", async ()=>{
    if(!STATE.endpoint){
      alert("Invio non configurato.");
      return;
    }

    const title = $("rTitle")?.value?.trim() || "";
    const desc  = $("rDesc")?.value?.trim() || "";
    if(!title || !desc){
      alert("Inserisci almeno Titolo e Descrizione.");
      return;
    }

    const lat = $("rLat")?.value ? $("rLat").value : "";
    const lng = $("rLng")?.value ? $("rLng").value : "";
    const acc = STATE.geo?.acc ? String(Math.round(STATE.geo.acc)) : "";

    const fd = new FormData();
    fd.append("title", title);
    fd.append("desc", desc);
    fd.append("lat", lat);
    fd.append("lng", lng);
    fd.append("acc", acc);

    const file = SELECTED_PHOTO_FILE;
    if(file) fd.append("photo", file, file.name);

    const btn = $("btnSend");
    if(btn){
      btn.disabled = true;
      btn.textContent = "Invio...";
    }

    try{
      const res = await fetch(STATE.endpoint, { method:"POST", body: fd });
      const data = await res.json().catch(()=>null);

      if(res.ok && data?.ok){
        alert("Inviata ✅");
        clearReportForm();
      } else {
        console.log("Errore invio:", res.status, data);
        alert("Errore invio ❌. Salvo in locale.");
        const localItem = await buildReportItemForLocal();
        if(localItem){
          STATE.reports.unshift(localItem);
          saveJSON("ch_reports", STATE.reports);
          renderReports();
        }
      }
    } catch(e){
      console.warn(e);
      alert("Errore rete ❌. Salvo in locale.");
      const localItem = await buildReportItemForLocal();
      if(localItem){
        STATE.reports.unshift(localItem);
        saveJSON("ch_reports", STATE.reports);
        renderReports();
      }
    } finally {
      if(btn){
        btn.disabled = false;
        btn.textContent = "Invia";
      }
    }
  });

  on("btnExport","click", ()=>{
    const blob = new Blob([JSON.stringify(STATE.reports, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "segnalazioni.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  on("btnClear","click", ()=>{
    if(!confirm("Vuoi eliminare tutte le segnalazioni locali?")) return;
    STATE.reports = [];
    saveJSON("ch_reports", STATE.reports);
    renderReports();
  });
}

async function buildReportItemForLocal(){
  const title = $("rTitle")?.value?.trim() || "";
  const desc  = $("rDesc")?.value?.trim() || "";
  if(!title || !desc){
    alert("Inserisci almeno Titolo e Descrizione.");
    return null;
  }

  const lat = $("rLat")?.value ? Number($("rLat").value) : null;
  const lng = $("rLng")?.value ? Number($("rLng").value) : null;
  const acc = STATE.geo?.acc ? Math.round(STATE.geo.acc) : null;

  let photoPreview = null;
  const file = SELECTED_PHOTO_FILE;
  if(file){
    photoPreview = await fileToDataURL(file);
  }

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title,
    desc,
    location: (lat !== null && lng !== null) ? { lat, lng, acc } : null,
    photoPreview
  };
}

function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function clearReportForm(){
  if($("rTitle")) $("rTitle").value = "";
  if($("rDesc")) $("rDesc").value = "";
  if($("rLat")) $("rLat").value = "";
  if($("rLng")) $("rLng").value = "";
  if($("geoStatus")) $("geoStatus").textContent = "Non rilevata";
  STATE.geo = null;
  STATE.pickedLatLng = null;
  clearPhotoSelection();
}

function renderReports(){
  const root = $("reportList");
  if(!root) return;

  root.innerHTML = "";
  if(STATE.reports.length === 0){
    root.innerHTML = `<p class="muted">Nessuna segnalazione salvata.</p>`;
    return;
  }

  for(const r of STATE.reports){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${new Date(r.createdAt).toLocaleString("it-IT")}</span>
        ${r.location ? `<span class="badge">GPS</span>` : `<span class="badge">No GPS</span>`}
        ${r.photoPreview ? `<span class="badge">Foto</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title)}</h4>
      <p class="muted">${escapeHTML(r.desc)}</p>
      ${r.photoPreview ? `<img src="${r.photoPreview}" alt="" style="width:100%;border-radius:14px;border:1px solid var(--line);margin-top:8px">` : ``}
      ${r.location ? `<p class="muted small">Lat ${r.location.lat.toFixed(6)} • Lng ${r.location.lng.toFixed(6)}${r.location.acc ? ` • ±${r.location.acc}m` : ""}</p>` : ``}
    `;
    root.appendChild(el);
  }
}

// =====================
// MAP (main map tab)
// =====================
function renderMap(){
  if(!window.L || !$("map")) return;

  if(!STATE.map){
    STATE.map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.map);
  }

  STATE.markers.forEach(m=> m.remove());
  STATE.markers = [];

  const center = [41.492, 13.832];
  STATE.map.setView(center, 13);

  for(const r of STATE.reports){
    if(!r.location) continue;
    const m = L.marker([r.location.lat, r.location.lng]).addTo(STATE.map);
    m.bindPopup(`<b>Segnalazione</b><br>${escapeHTML(r.title)}`);
    STATE.markers.push(m);
  }
}

// =====================
// INIT (after DOM ready)
// =====================
document.addEventListener("DOMContentLoaded", ()=>{
  initTabs();
  initPhoto();
  initGeo();
  initMapPicker();
  initReports();

  renderReports();
  switchView("report");
});
