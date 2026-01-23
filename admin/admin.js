
const $ = (id) => document.getElementById(id);

const LS_KEY = "ch_admin_key";
const LS_API = "ch_api_base";

const STATE = {
  rows: [],
  selectedId: null,
  map: null,
  marker: null,
};

function load() {
  const k = localStorage.getItem(LS_KEY) || "";
  const a = localStorage.getItem(LS_API) || $("apiBase").value;
  $("adminKey").value = k;
  $("apiBase").value = a;
}

function save() {
  localStorage.setItem(LS_KEY, $("adminKey").value.trim());
  localStorage.setItem(LS_API, $("apiBase").value.trim().replace(/\/$/, ""));
}

function clear() {
  localStorage.removeItem(LS_KEY);
  $("adminKey").value = "";
}

function apiBase() {
  return $("apiBase").value.trim().replace(/\/$/, "");
}

function adminKey() {
  return $("adminKey").value.trim();
}

function headers() {
  return { "X-Admin-Key": adminKey() };
}

function setConn(msg) {
  $("connStatus").textContent = msg || "";
}

function escapeHTML(s){
  return (s || "").toString().replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

// ===== Fetch list =====
async function refresh() {
  setConn("Carico…");
  $("btnRefresh").disabled = true;

  try {
    if (!adminKey()) {
      setConn("Inserisci la Admin Key e premi Salva.");
      return;
    }

    const res = await fetch(`${apiBase()}/list`, { headers: headers() });
    if (!res.ok) {
      setConn(`Errore: ${res.status} (${await res.text().catch(()=> "")})`);
      return;
    }
    const data = await res.json();
    STATE.rows = data.rows || [];
    renderList();
    setConn(`OK • ${STATE.rows.length} segnalazioni`);
  } catch (e) {
    console.warn(e);
    setConn("Errore rete o CORS.");
  } finally {
    $("btnRefresh").disabled = false;
  }
}

function renderList() {
  const q = ($("q").value || "").trim().toLowerCase();
  const root = $("list");
  root.innerHTML = "";

  const rows = STATE.rows.filter(r => {
    if (!q) return true;
    const t = `${r.title || ""} ${r.description || ""}`.toLowerCase();
    return t.includes(q);
  });

  if (rows.length === 0) {
    root.innerHTML = `<p class="muted">Nessun risultato.</p>`;
    return;
  }

  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "item" + (r.id === STATE.selectedId ? " active" : "");
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${escapeHTML(r.status || "new")}</span>
        ${r.tags ? `<span class="badge">${escapeHTML(r.tags)}</span>` : ""}
        <span class="badge">${new Date(r.createdAt).toLocaleString("it-IT")}</span>
      </div>
      <h4>${escapeHTML(r.title)}</h4>
      <p class="muted">${escapeHTML((r.description || "").slice(0, 120))}${(r.description||"").length>120 ? "…" : ""}</p>
    `;
    el.addEventListener("click", () => select(r.id));
    root.appendChild(el);
  }
}

function select(id) {
  STATE.selectedId = id;
  renderList();

  const r = STATE.rows.find(x => x.id === id);
  if (!r) return;

  $("detailEmpty").classList.add("hidden");
  $("detail").classList.remove("hidden");

  $("selMeta").textContent = `ID: ${r.id} • Aggiornato: ${r.updatedAt || "—"}`;

  $("dTitle").textContent = r.title || "";
  $("dDesc").textContent = r.description || "";

  // Foto
  if (r.photoUrl) {
    $("dPhotoWrap").classList.remove("hidden");
    $("dPhoto").src = r.photoUrl; // /photo protetto ma passa header? QUI no.
    // Soluzione: carichiamo la foto via fetch con header e la mettiamo come blob URL
    loadProtectedImage(r.photoUrl);
  } else {
    $("dPhotoWrap").classList.add("hidden");
    $("dPhoto").src = "";
  }

  // Campi edit
  $("dStatus").value = r.status || "new";
  $("dTags").value = r.tags || "";
  $("dNote").value = r.adminNote || "";
  $("dReply").value = r.adminReply || "";

  // Coordinate
  const hasCoords = (r.lat !== null && r.lat !== undefined && r.lng !== null && r.lng !== undefined);
  $("dCoords").textContent = hasCoords
    ? `Lat ${Number(r.lat).toFixed(6)} • Lng ${Number(r.lng).toFixed(6)}${r.accuracy ? ` • ±${Math.round(r.accuracy)}m` : ""}`
    : "Nessuna coordinata GPS.";

  renderMap(hasCoords ? [r.lat, r.lng] : [41.492, 13.832], hasCoords);
}

async function loadProtectedImage(url) {
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error("img");
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    $("dPhoto").src = objUrl;
  } catch {
    $("dPhotoWrap").classList.add("hidden");
    $("dPhoto").src = "";
  }
}

// ===== Map =====
function renderMap(center, showMarker) {
  if (!STATE.map) {
    STATE.map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.map);
  }

  STATE.map.setView(center, showMarker ? 16 : 13);

  if (STATE.marker) {
    STATE.marker.remove();
    STATE.marker = null;
  }
  if (showMarker) {
    STATE.marker = L.marker(center).addTo(STATE.map);
  }
  setTimeout(() => STATE.map.invalidateSize(), 50);
}

// ===== Save update =====
async function saveUpdate() {
  const id = STATE.selectedId;
  if (!id) return;

  $("btnSave").disabled = true;
  $("saveStatus").textContent = "Salvo…";

  try {
    const payload = {
      id,
      status: $("dStatus").value,
      tags: $("dTags").value.trim(),
      adminNote: $("dNote").value.trim(),
      adminReply: $("dReply").value.trim(),
    };

    const res = await fetch(`${apiBase()}/admin/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      $("saveStatus").textContent = `Errore: ${res.status}`;
      return;
    }

    // aggiorna local state
    const r = STATE.rows.find(x => x.id === id);
    if (r) {
      r.status = data.status;
      r.tags = data.tags;
      r.adminNote = data.adminNote;
      r.adminReply = data.adminReply;
      r.updatedAt = data.updatedAt;
    }

    $("saveStatus").textContent = "Salvato ✅";
    $("selMeta").textContent = `ID: ${id} • Aggiornato: ${data.updatedAt}`;
    renderList();
  } catch (e) {
    console.warn(e);
    $("saveStatus").textContent = "Errore rete.";
  } finally {
    $("btnSave").disabled = false;
  }
}

// ===== Export =====
function exportJSON() {
  const blob = new Blob([JSON.stringify(STATE.rows, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "segnalazioni_admin.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== Events =====
$("btnSaveKey").addEventListener("click", () => {
  save();
  setConn("Salvato. Premi Aggiorna.");
});

$("btnClearKey").addEventListener("click", () => {
  clear();
  setConn("Rimosso.");
});

$("btnRefresh").addEventListener("click", refresh);
$("btnExport").addEventListener("click", exportJSON);
$("q").addEventListener("input", renderList);
$("btnSave").addEventListener("click", saveUpdate);

load();
setConn("Inserisci Admin Key → Salva → Aggiorna");
