const $ = (id) => document.getElementById(id);

const STATE = {
  reports: loadJSON("ch_reports", []),
  reviews: [],
  places: [],
  geo: null, // {lat,lng,acc}
  endpoint: "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev/submit",
  map: null,
  markers: [],
  loaded: { places: false, reviews: false }
};

function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

function switchView(view){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  if(view === "map") setTimeout(renderMap, 50);
}

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=> switchView(btn.dataset.view));
});

// =====================
// GEO
// =====================
$("btnGeo").addEventListener("click", ()=>{
  $("geoStatus").textContent = "Rilevo...";
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const {latitude, longitude, accuracy} = pos.coords;
      STATE.geo = { lat: latitude, lng: longitude, acc: accuracy };
      $("rLat").value = latitude.toFixed(6);
      $("rLng").value = longitude.toFixed(6);
      $("geoStatus").textContent = `OK ±${Math.round(accuracy)}m`;
    },
    (err)=>{
      $("geoStatus").textContent = "Non disponibile";
      console.warn(err);
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

// =====================
// REPORT: salva locale
// =====================
$("btnSaveLocal").addEventListener("click", async ()=>{
  const item = await buildReportItemForLocal();
  if(!item) return;
  STATE.reports.unshift(item);
  saveJSON("ch_reports", STATE.reports);
  clearReportForm();
  renderReports();
  alert("Salvata sul telefono ✅");
});

// =====================
// REPORT: invia al Worker
// =====================
$("btnSend").addEventListener("click", async ()=>{
  if(!STATE.endpoint){
    alert("Invio non configurato.");
    return;
  }

  const title = $("rTitle").value.trim();
  const desc  = $("rDesc").value.trim();
  if(!title || !desc){
    alert("Inserisci almeno Titolo e Descrizione.");
    return;
  }

  const lat = $("rLat").value ? $("rLat").value : "";
  const lng = $("rLng").value ? $("rLng").value : "";
  const acc = STATE.geo?.acc ? String(Math.round(STATE.geo.acc)) : "";

  const fd = new FormData();
  fd.append("title", title);
  fd.append("desc", desc);
  fd.append("lat", lat);
  fd.append("lng", lng);
  fd.append("acc", acc);

  const file = $("rPhoto").files?.[0];
  if(file) fd.append("photo", file, file.name);

  $("btnSend").disabled = true;
  $("btnSend").textContent = "Invio...";

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
    $("btnSend").disabled = false;
    $("btnSend").textContent = "Invia";
  }
});

// ====== LOCAL ITEM (per lista locale) ======
async function buildReportItemForLocal(){
  const title = $("rTitle").value.trim();
  const desc  = $("rDesc").value.trim();
  if(!title || !desc){
    alert("Inserisci almeno Titolo e Descrizione.");
    return null;
  }

  const lat = $("rLat").value ? Number($("rLat").value) : null;
  const lng = $("rLng").value ? Number($("rLng").value) : null;
  const acc = STATE.geo?.acc ? Math.round(STATE.geo.acc) : null;

  let photoPreview = null;
  const file = $("rPhoto").files?.[0];
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
  $("rTitle").value = "";
  $("rDesc").value = "";
  $("rPhoto").value = "";
  $("rLat").value = "";
  $("rLng").value = "";
  $("geoStatus").textContent = "Non rilevata";
  STATE.geo = null;
}

// LISTA REPORT
$("btnExport").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(STATE.reports, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "segnalazioni.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("btnClear").addEventListener("click", ()=>{
  if(!confirm("Vuoi eliminare tutte le segnalazioni locali?")) return;
  STATE.reports = [];
  saveJSON("ch_reports", STATE.reports);
  renderReports();
});

function renderReports(){
  const root = $("reportList");
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

function escapeHTML(s){
  return (s || "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// =====================
// DATA: places + reviews
// =====================
async function fetchJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if(!res.ok) throw new Error(`Fetch ${path} failed: ${res.status}`);
  return await res.json();
}

async function loadRemoteData(){
  // Nascondiamo i pulsanti “+ Aggiungi” nella webapp pubblica (si gestisce da admin)
  const a = $("btnAddReview"); if(a) a.style.display = "none";
  const b = $("btnAddPlace");  if(b) b.style.display = "none";

  try{
    STATE.places = await fetchJSON("./data/places.json");
    STATE.loaded.places = true;
  } catch(e){
    console.warn("places.json non caricato:", e);
    STATE.places = [];
  }

  try{
    STATE.reviews = await fetchJSON("./data/reviews.json");
    STATE.loaded.reviews = true;
  } catch(e){
    console.warn("reviews.json non caricato:", e);
    STATE.reviews = [];
  }

  renderPlaces();
  renderReviews();
}

function renderPlaces(){
  const root = $("placesList");
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
        ${isNum(p.lat) && isNum(p.lng) ? `<span class="badge">📍 mappa</span>` : ``}
      </div>
      <h4>${escapeHTML(p.name || "")}</h4>
      <p class="muted">${escapeHTML(p.description || "")}</p>
    `;
    el.addEventListener("click", ()=>{
      const info = `${p.name}\n\n${p.description || ""}\n\n${(isNum(p.lat)&&isNum(p.lng)) ? `📍 ${p.lat}, ${p.lng}` : ""}`;
      alert(info.trim());
      if(isNum(p.lat) && isNum(p.lng)){
        switchView("map");
        setTimeout(()=>{
          STATE.map?.setView([p.lat, p.lng], 15);
        }, 150);
      }
    });
    root.appendChild(el);
  }
}

function renderReviews(){
  const root = $("reviewsList");
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
        ${stars ? `<span class="badge">${stars}</span>` : `<span class="badge">recensione</span>`}
        ${escapeHTML(r.place || "") ? `<span class="badge">${escapeHTML(r.place)}</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍 mappa</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(r.text || "")}</p>
    `;
    el.addEventListener("click", ()=>{
      const info = `${r.title}\n${r.place ? "📌 " + r.place : ""}\n${stars ? stars : ""}\n\n${r.text || ""}\n\n${(isNum(r.lat)&&isNum(r.lng)) ? `📍 ${r.lat}, ${r.lng}` : ""}`;
      alert(info.trim());
      if(isNum(r.lat) && isNum(r.lng)){
        switchView("map");
        setTimeout(()=>{
          STATE.map?.setView([r.lat, r.lng], 15);
        }, 150);
      }
    });
    root.appendChild(el);
  }
}

function isNum(n){
  return typeof n === "number" && Number.isFinite(n);
}

// =====================
// MAPPA
// =====================
function renderMap(){
  if(!STATE.map){
    STATE.map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.map);
  }
  STATE.markers.forEach(m=> m.remove());
  STATE.markers = [];

  const center = [41.492, 13.832];
  STATE.map.setView(center, 13);

  // Segnalazioni locali
  for(const r of STATE.reports){
    if(!r.location) continue;
    const m = L.marker([r.location.lat, r.location.lng]).addTo(STATE.map);
    m.bindPopup(`<b>Segnalazione</b><br>${escapeHTML(r.title)}`);
    STATE.markers.push(m);
  }

  // Posti
  for(const p of STATE.places || []){
    if(!isNum(p.lat) || !isNum(p.lng)) continue;
    const m = L.marker([p.lat, p.lng]).addTo(STATE.map);
    m.bindPopup(`<b>Posto</b><br>${escapeHTML(p.name || "")}`);
    STATE.markers.push(m);
  }

  // Recensioni
  for(const r of STATE.reviews || []){
    if(!isNum(r.lat) || !isNum(r.lng)) continue;
    const title = r.place ? `${r.place}` : (r.title || "Recensione");
    const m = L.marker([r.lat, r.lng]).addTo(STATE.map);
    m.bindPopup(`<b>Recensione</b><br>${escapeHTML(title)}`);
    STATE.markers.push(m);
  }
}

// =====================
// BOOT
// =====================
renderReports();
loadRemoteData();     // <-- nuovo
switchView("report");
