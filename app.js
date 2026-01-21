const $ = (id) => document.getElementById(id);

const STATE = {
  reports: loadJSON("ch_reports", []),
  reviews: [],
  places: [],
  geo: null, // {lat,lng,acc}
  endpoint: "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev/submit",
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

// REPORT: salva locale (solo testo + coordinate, e mini preview base64 opzionale)
$("btnSaveLocal").addEventListener("click", async ()=>{
  const item = await buildReportItemForLocal();
  if(!item) return;
  STATE.reports.unshift(item);
  saveJSON("ch_reports", STATE.reports);
  clearReportForm();
  renderReports();
  alert("Salvata sul telefono ✅");
});

// REPORT: invia al Worker (FormData + file)
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

  // UX: disabilita bottone durante invio
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
      alert("Errore invio ❌ (controlla Worker/R2/D1). Salvo in locale.");
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

  // (opzionale) preview base64 per vedere la foto nella lista locale
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
    photoPreview // SOLO preview locale
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
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// MAPPA
function renderMap(){
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

renderReports();
switchView("report");
