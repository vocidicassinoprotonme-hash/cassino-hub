const $ = (id) => document.getElementById(id);

const DEFAULT_LIST_URL = "https://cassino-segnalazioni.vocidicassinoproton-me.workers.dev/list";
let MAP = null;
let MARKERS = [];

function escapeHTML(s){
  return String(s || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function setStatus(msg){ $("status").textContent = msg; }

function getAdminKey(){
  return sessionStorage.getItem("ADMIN_KEY") || "";
}
function askAdminKey(){
  let key = getAdminKey();
  if (key) return key;
  key = prompt("Inserisci password Admin:");
  if (!key) return "";
  sessionStorage.setItem("ADMIN_KEY", key.trim());
  return key.trim();
}
function logout(){
  sessionStorage.removeItem("ADMIN_KEY");
  location.reload();
}

function init(){
  $("endpoint").value = localStorage.getItem("admin_list_endpoint") || DEFAULT_LIST_URL;

  $("btnReload").addEventListener("click", loadData);
  $("btnDownload").addEventListener("click", downloadJSON);
  $("btnLogout").addEventListener("click", logout);
  $("q").addEventListener("input", render);
  $("limit").addEventListener("change", loadData);

  initMap();
  loadData();
}

function initMap(){
  MAP = L.map("mapAdmin");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(MAP);
  MAP.setView([41.492, 13.832], 13);
}

let RAW_ROWS = [];
let FILTERED = [];

async function loadData(){
  const key = askAdminKey();
  if(!key){
    setStatus("Password mancante.");
    return;
  }

  const endpoint = $("endpoint").value.trim() || DEFAULT_LIST_URL;
  localStorage.setItem("admin_list_endpoint", endpoint);

  setStatus("Carico…");
  $("list").innerHTML = "";

  const limit = Number($("limit").value);

  try{
    const res = await fetch(endpoint, {
      method:"GET",
      headers: { "X-Admin-Key": key } // ✅ qui passa la password al Worker
    });

    if(res.status === 401){
      setStatus("Password errata o scaduta.");
      sessionStorage.removeItem("ADMIN_KEY");
      return;
    }

    const data = await res.json();
    if(!res.ok || !data?.ok){
      console.log(res.status, data);
      setStatus("Errore caricamento. Controlla endpoint.");
      return;
    }

    RAW_ROWS = Array.isArray(data.rows) ? data.rows : [];
    RAW_ROWS = RAW_ROWS.slice(0, limit);

    // per mostrare le foto, aggiungiamo la chiave come query param "ak"
    RAW_ROWS = RAW_ROWS.map(r => {
      if(!r.photoUrl) return r;
      const u = new URL(r.photoUrl);
      u.searchParams.set("ak", key);
      return { ...r, photoUrl: u.toString() };
    });

    setStatus(`OK: ${RAW_ROWS.length} segnalazioni caricate.`);
    render();
  } catch(e){
    console.warn(e);
    setStatus("Errore rete o endpoint non raggiungibile.");
  }
}

function render(){
  const q = $("q").value.trim().toLowerCase();
  FILTERED = RAW_ROWS.filter(r=>{
    const t = (r.title || "").toLowerCase();
    const d = (r.description || "").toLowerCase();
    return !q || t.includes(q) || d.includes(q);
  });
  renderList();
  renderMap();
}

function renderList(){
  const root = $("list");
  root.innerHTML = "";

  if(FILTERED.length === 0){
    root.innerHTML = `<p class="muted">Nessun risultato.</p>`;
    return;
  }

  for(const r of FILTERED){
    const dt = r.createdAt ? new Date(r.createdAt).toLocaleString("it-IT") : "";
    const hasGPS = (r.lat != null && r.lng != null);

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(dt)}</span>
        <span class="badge">${escapeHTML(r.id || "")}</span>
        ${hasGPS ? `<span class="badge">GPS</span>` : `<span class="badge">No GPS</span>`}
        ${r.photoUrl ? `<span class="badge">Foto</span>` : ``}
      </div>

      <div class="grid">
        <div>
          <h3 style="margin:0 0 6px 0">${escapeHTML(r.title)}</h3>
          <p class="muted" style="margin:0 0 8px 0">${escapeHTML(r.description)}</p>
          ${hasGPS ? `<p class="muted small">Lat ${Number(r.lat).toFixed(6)} • Lng ${Number(r.lng).toFixed(6)}${r.accuracy ? ` • ±${Math.round(r.accuracy)}m` : ""}</p>` : ``}
        </div>

        <div>
          ${r.photoUrl ? `<a href="${r.photoUrl}" target="_blank" rel="noopener"><img class="thumb" src="${r.photoUrl}" alt=""></a>` : ``}
        </div>
      </div>
    `;
    root.appendChild(el);
  }
}

function renderMap(){
  MARKERS.forEach(m => m.remove());
  MARKERS = [];

  for(const r of FILTERED){
    if(r.lat == null || r.lng == null) continue;
    const m = L.marker([r.lat, r.lng]).addTo(MAP);
    m.bindPopup(`<b>Segnalazione</b><br>${escapeHTML(r.title)}<br><span class="muted small">${escapeHTML(r.id || "")}</span>`);
    MARKERS.push(m);
  }

  if(MARKERS.length > 0){
    const group = L.featureGroup(MARKERS);
    MAP.fitBounds(group.getBounds().pad(0.2));
  } else {
    MAP.setView([41.492, 13.832], 13);
  }
}

function downloadJSON(){
  const blob = new Blob([JSON.stringify(FILTERED, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "segnalazioni_admin.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
