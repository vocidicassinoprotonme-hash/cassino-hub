const $ = (id) => document.getElementById(id);

const STATE = {
  reports: loadJSON("ch_reports", []),
  reviews: [],
  places: [],
  geo: null,
  endpoint: "", // <-- QUI metterai l’URL se usi opzione (2)
  map: null,
  markers: []
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

// GEO
$("btnGeo").addEventListener("click", ()=>{
  $("geoStatus").textContent = "Rilevo...";
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const {latitude, longitude} = pos.coords;
      STATE.geo = { lat: latitude, lng: longitude, acc: pos.coords.accuracy };
      $("rLat").value = latitude.toFixed(6);
      $("rLng").value = longitude.toFixed(6);
      $("geoStatus").textContent = `OK ±${Math.round(pos.coords.accuracy)}m`;
    },
    (err)=>{
      $("geoStatus").textContent = "Non disponibile";
      console.warn(err);
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

// REPORT: salva locale
$("btnSaveLocal").addEventListener("click", async ()=>{
  const item = await buildReportItem();
  if(!item) return;
  STATE.reports.unshift(item);
  saveJSON("ch_reports", STATE.reports);
  clearReportForm();
  renderReports();
  alert("Salvata sul telefono ✅");
});

// REPORT: invia
$("btnSend").addEventListener("click", async ()=>{
  if(!STATE.endpoint){
    alert("Invio non configurato: serve un endpoint (Cloudflare/Netlify/Formspree).");
    return;
  }
  const item = await buildReportItem();
  if(!item) return;

  const res = await fetch(STATE.endpoint, {
    method:"POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(item)
  });

  if(res.ok){
    alert("Inviata ✅");
  } else {
    alert("Errore invio. Salvo in locale.");
    STATE.reports.unshift(item);
    saveJSON("ch_reports", STATE.reports);
    renderReports();
  }
});

async function buildReportItem(){
  const title = $("rTitle").value.trim();
  const desc  = $("rDesc").value.trim();
  if(!title || !desc){
    alert("Inserisci almeno Titolo e Descrizione.");
    return null;
  }

  const lat = $("rLat").value ? Number($("rLat").value) : null;
  const lng = $("rLng").value ? Number($("rLng").value) : null;

  let photoDataUrl = null;
  const file = $("rPhoto").files?.[0];
  if(file){
    photoDataUrl = await fileToDataURL(file); // base64 (ok per MVP; per produzione meglio upload file)
  }

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title, desc,
    location: (lat && lng) ? { lat, lng } : null,
    photoDataUrl
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
        ${r.photoDataUrl ? `<span class="badge">Foto</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title)}</h4>
      <p class="muted">${escapeHTML(r.desc)}</p>
      ${r.photoDataUrl ? `<img src="${r.photoDataUrl}" alt="" style="width:100%;border-radius:14px;border:1px solid var(--line);margin-top:8px">` : ``}
      ${r.location ? `<p class="muted small">Lat ${r.location.lat.toFixed(6)} • Lng ${r.location.lng.toFixed(6)}</p>` : ``}
    `;
    root.appendChild(el);
  }
}

function escapeHTML(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// MAPPA
function renderMap(){
  if(!STATE.map){
    STATE.map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.map);
  }
  // pulizia marker
  STATE.markers.forEach(m=> m.remove());
  STATE.markers = [];

  // centro: Cassino
  const center = [41.492, 13.832];
  STATE.map.setView(center, 13);

  // segnalazioni locali con GPS
  for(const r of STATE.reports){
    if(!r.location) continue;
    const m = L.marker([r.location.lat, r.location.lng]).addTo(STATE.map);
    m.bindPopup(`<b>Segnalazione</b><br>${escapeHTML(r.title)}`);
    STATE.markers.push(m);
  }
}

renderReports();
switchView("report");
