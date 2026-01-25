const $ = (id) => document.getElementById(id);

const LS = {
  ADMIN_KEY: "ch_adminKey",
  API_BASE: "ch_apiBase",
  GH_TOKEN: "ch_ghToken",
  GH_REPO: "ch_ghRepo"
};

const STATE = {
  apiBase: "",
  adminKey: "",
  ghToken: "",
  ghRepo: "",

  reports: [],
  selected: null,

  // gestione contenuti GitHub
  places: [],
  reviews: [],
  placesSha: null,
  reviewsSha: null,

  map: null,
  pin: null
};

// =============== UTIL ===============
function load(key, fallback=""){
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, val){
  try { localStorage.setItem(key, val); } catch {}
}
function del(key){
  try { localStorage.removeItem(key); } catch {}
}
function escapeHTML(s){
  return (s||"").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function isNum(n){ return typeof n === "number" && Number.isFinite(n); }
function oneLine(s, max=120){
  const t = (s||"").toString().replace(/\s+/g," ").trim();
  return t.length>max ? t.slice(0,max-1)+"…" : t;
}
function nowISO(){ return new Date().toISOString(); }
function uid(){ return crypto.randomUUID(); }

function headersAdmin(){
  return {
    "X-Admin-Key": STATE.adminKey
  };
}

// =============== BOOT: carica impostazioni ===============
function bootSettings(){
  STATE.apiBase = load(LS.API_BASE, $("apiBase")?.value || "");
  STATE.adminKey = load(LS.ADMIN_KEY, "");
  STATE.ghToken = load(LS.GH_TOKEN, "");
  STATE.ghRepo = load(LS.GH_REPO, "");

  $("apiBase").value = STATE.apiBase || $("apiBase").value;
  $("adminKey").value = STATE.adminKey;
  $("connStatus").textContent = "";

  // area GitHub semplice (aggiungo io i campi se non esistono)
  ensureGithubBox();
  $("#ghToken").value = STATE.ghToken;
  $("#ghRepo").value = STATE.ghRepo;
}

// =============== UI: aggiungiamo box GitHub + gestione contenuti ===============
function ensureGithubBox(){
  // se già creato, stop
  if(document.getElementById("ghBox")) return;

  const connCard = document.querySelector(".container .card");
  if(!connCard) return;

  const box = document.createElement("div");
  box.id = "ghBox";
  box.innerHTML = `
    <hr>
    <h3>Contenuti (GitHub)</h3>
    <p class="muted mini">Qui puoi aggiornare <b>Posti</b> e <b>Recensioni</b> pubblicati nella webapp. Il token resta solo nel browser.</p>

    <label class="field">
      <span>GitHub Token (Contents: Read/Write)</span>
      <input id="ghToken" type="password" placeholder="ghp_..." />
    </label>

    <label class="field">
      <span>Repo (owner/repo)</span>
      <input id="ghRepo" type="text" placeholder="vocidicassinoprotonme-hash/cassino-hub" />
    </label>

    <div class="row">
      <button id="btnLoadContent" class="btn secondary">Carica Posti/Recensioni</button>
      <button id="btnOpenManager" class="btn">Gestisci</button>
    </div>

    <p id="ghStatus" class="muted mini"></p>

    <div id="manager" class="hidden" style="margin-top:12px">
      <div class="row space">
        <h3>Gestione Contenuti</h3>
        <div class="row">
          <button id="tabPlaces" class="btn secondary">Posti</button>
          <button id="tabReviews" class="btn secondary">Recensioni</button>
        </div>
      </div>

      <div id="mgrPlaces" class="card" style="margin-top:10px">
        <div class="row space">
          <h4>Posti</h4>
          <button id="btnAddPlace" class="btn">+ Aggiungi</button>
        </div>
        <div id="placesList" class="list"></div>
      </div>

      <div id="mgrReviews" class="card hidden" style="margin-top:10px">
        <div class="row space">
          <h4>Recensioni</h4>
          <button id="btnAddReview" class="btn">+ Aggiungi</button>
        </div>
        <div id="reviewsList" class="list"></div>
      </div>

      <div id="editor" class="card hidden" style="margin-top:10px">
        <div class="row space">
          <h4 id="edTitle">Editor</h4>
          <button id="btnCloseEditor" class="btn danger">Chiudi</button>
        </div>

        <div class="grid2">
          <label class="field">
            <span>Nome / Titolo</span>
            <input id="edName" type="text" />
          </label>

          <label class="field">
            <span>Categoria / Luogo</span>
            <input id="edCat" type="text" placeholder="es. cultura / ristorante" />
          </label>
        </div>

        <label class="field">
          <span>Descrizione / Testo</span>
          <textarea id="edDesc" rows="4"></textarea>
        </label>

        <div class="grid2">
          <label class="field">
            <span>Lat</span>
            <input id="edLat" type="number" step="0.000001" />
          </label>
          <label class="field">
            <span>Lng</span>
            <input id="edLng" type="number" step="0.000001" />
          </label>
        </div>

        <div id="edRatingWrap" class="hidden">
          <label class="field">
            <span>Rating (1-5)</span>
            <input id="edRating" type="number" min="1" max="5" step="1" />
          </label>
        </div>

        <div class="row">
          <button id="btnPickOnMap" class="btn secondary">📍 Seleziona su mappa</button>
          <button id="btnSaveItem" class="btn">💾 Salva</button>
          <button id="btnDeleteItem" class="btn danger">Elimina</button>
          <button id="btnPublish" class="btn">🚀 Pubblica su GitHub</button>
        </div>

        <p id="edStatus" class="muted mini"></p>

        <hr>
        <h3>Mappa</h3>
        <div id="map" class="map"></div>
        <p class="muted mini">Clicca sulla mappa per impostare Lat/Lng quando la modalità “Seleziona su mappa” è attiva.</p>
      </div>
    </div>
  `;

  connCard.appendChild(box);

  // bind pulsanti GitHub/manager
  $("#btnLoadContent").addEventListener("click", loadContentFromGithub);
  $("#btnOpenManager").addEventListener("click", () => {
    $("#manager").classList.toggle("hidden");
  });

  $("#tabPlaces").addEventListener("click", () => showManager("places"));
  $("#tabReviews").addEventListener("click", () => showManager("reviews"));

  $("#btnAddPlace").addEventListener("click", () => openEditor("places", null));
  $("#btnAddReview").addEventListener("click", () => openEditor("reviews", null));

  $("#btnCloseEditor").addEventListener("click", closeEditor);
  $("#btnPickOnMap").addEventListener("click", togglePickOnMap);
  $("#btnSaveItem").addEventListener("click", saveEditorItem);
  $("#btnDeleteItem").addEventListener("click", deleteEditorItem);
  $("#btnPublish").addEventListener("click", publishToGithub);
}

function showManager(which){
  $("#mgrPlaces").classList.toggle("hidden", which !== "places");
  $("#mgrReviews").classList.toggle("hidden", which !== "reviews");
}

// =============== SALVATAGGIO chiavi (admin worker) ===============
$("btnSaveKey").addEventListener("click", ()=>{
  STATE.apiBase = $("apiBase").value.trim();
  STATE.adminKey = $("adminKey").value.trim();
  save(LS.API_BASE, STATE.apiBase);
  save(LS.ADMIN_KEY, STATE.adminKey);
  $("connStatus").textContent = "Salvato ✅";
});

$("btnClearKey").addEventListener("click", ()=>{
  del(LS.ADMIN_KEY);
  $("adminKey").value = "";
  STATE.adminKey = "";
  $("connStatus").textContent = "Rimosso ✅";
});

$("btnRefresh").addEventListener("click", loadReports);
$("btnExport").addEventListener("click", exportReports);

// =============== REPORTS: list + dettaglio ===============
async function loadReports(){
  const base = ($("apiBase").value || "").trim();
  const key  = ($("adminKey").value || "").trim();
  STATE.apiBase = base;
  STATE.adminKey = key;
  save(LS.API_BASE, base);
  save(LS.ADMIN_KEY, key);

  if(!base || !key){
    $("connStatus").textContent = "Inserisci Worker base URL e Admin Key.";
    return;
  }

  $("connStatus").textContent = "Carico...";
  try{
    const res = await fetch(`${base}/list`, { headers: headersAdmin() });
    if(!res.ok){
      $("connStatus").textContent = `Errore /list: ${res.status}`;
      return;
    }
    const data = await res.json();
    STATE.reports = data.rows || [];
    $("connStatus").textContent = `OK ✅ ${STATE.reports.length} segnalazioni`;
    renderReportList();
  } catch(e){
    console.warn(e);
    $("connStatus").textContent = "Errore rete.";
  }
}

function renderReportList(){
  const root = $("list");
  root.innerHTML = "";

  const q = ($("q")?.value || "").toLowerCase().trim();

  const items = STATE.reports.filter(r=>{
    const t = `${r.title||""} ${r.description||""}`.toLowerCase();
    return !q || t.includes(q);
  });

  if(!items.length){
    root.innerHTML = `<p class="muted">Nessuna segnalazione.</p>`;
    return;
  }

  for(const r of items){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="badges">
        <span class="badge">${new Date(r.createdAt).toLocaleString("it-IT")}</span>
        <span class="badge">${escapeHTML(r.status || "new")}</span>
        ${r.photoKey ? `<span class="badge">📷</span>` : ``}
        ${isNum(r.lat) && isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(oneLine(r.title, 60))}</h4>
      <p class="muted">${escapeHTML(oneLine(r.description, 90))}</p>
    `;
    el.addEventListener("click", ()=> selectReport(r.id));
    root.appendChild(el);
  }
}

$("q")?.addEventListener("input", renderReportList);

function selectReport(id){
  const r = STATE.reports.find(x=> x.id === id);
  if(!r) return;
  STATE.selected = r;

  $("detailEmpty").classList.add("hidden");
  $("detail").classList.remove("hidden");

  $("selMeta").textContent = `${new Date(r.createdAt).toLocaleString("it-IT")} • ${r.id}`;

  $("dTitle").textContent = r.title || "";
  $("dDesc").textContent  = r.description || "";

  if(r.photoUrl){
    $("dPhotoWrap").classList.remove("hidden");
    $("dPhoto").src = `${STATE.apiBase}/photo?key=${encodeURIComponent(r.photoKey)}&ak=${encodeURIComponent(STATE.adminKey)}`;
  } else {
    $("dPhotoWrap").classList.add("hidden");
    $("dPhoto").removeAttribute("src");
  }

  if(isNum(r.lat) && isNum(r.lng)){
    $("dCoords").textContent = `Lat ${r.lat.toFixed(6)} • Lng ${r.lng.toFixed(6)}${r.accuracy ? ` • ±${Math.round(r.accuracy)}m` : ""}`;
  } else {
    $("dCoords").textContent = "Nessuna coordinata.";
  }

  $("dStatus").value = r.status || "new";
  $("dTags").value = r.tags || "";
  $("dNote").value = r.adminNote || "";
  $("dReply").value = r.adminReply || "";

  $("saveStatus").textContent = "";

  ensureMap();
  renderMapPin(r.lat, r.lng);
}

$("btnSave").addEventListener("click", async ()=>{
  if(!STATE.selected) return;
  const base = STATE.apiBase;
  const key  = STATE.adminKey;

  const payload = {
    id: STATE.selected.id,
    status: $("dStatus").value,
    tags: $("dTags").value,
    adminNote: $("dNote").value,
    adminReply: $("dReply").value
  };

  $("saveStatus").textContent = "Salvo...";
  try{
    const res = await fetch(`${base}/admin/update`, {
      method: "POST",
      headers: { "Content-Type":"application/json", ...headersAdmin() },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(()=>null);
    if(!res.ok || !data?.ok){
      $("saveStatus").textContent = `Errore: ${res.status}`;
      console.log("update error", data);
      return;
    }

    $("saveStatus").textContent = "Salvato ✅";

    // aggiorna in memoria
    Object.assign(STATE.selected, {
      status: data.status,
      tags: data.tags,
      adminNote: data.adminNote,
      adminReply: data.adminReply,
      updatedAt: data.updatedAt
    });

    renderReportList();
  } catch(e){
    console.warn(e);
    $("saveStatus").textContent = "Errore rete.";
  }
});

function exportReports(){
  const blob = new Blob([JSON.stringify(STATE.reports, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "reports-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// =============== MAP (admin) ===============
let PICK_MODE = false;

function ensureMap(){
  if(STATE.map) return;
  STATE.map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(STATE.map);
  STATE.map.setView([41.492, 13.832], 13);

  STATE.map.on("click", (e)=>{
    if(!PICK_MODE) return;
    const { lat, lng } = e.latlng;
    $("#edLat").value = lat.toFixed(6);
    $("#edLng").value = lng.toFixed(6);
    renderMapPin(lat, lng);
    $("#edStatus").textContent = "Coordinate impostate dalla mappa ✅";
  });
}

function renderMapPin(lat, lng){
  if(!STATE.map) return;
  if(STATE.pin){ STATE.pin.remove(); STATE.pin = null; }

  if(isNum(lat) && isNum(lng)){
    STATE.pin = L.marker([lat, lng]).addTo(STATE.map);
    STATE.map.setView([lat, lng], 15);
  } else {
    STATE.map.setView([41.492, 13.832], 13);
  }
}

function togglePickOnMap(){
  PICK_MODE = !PICK_MODE;
  $("#btnPickOnMap").textContent = PICK_MODE ? "✅ Click sulla mappa..." : "📍 Seleziona su mappa";
  $("#edStatus").textContent = PICK_MODE ? "Modalità selezione: clicca un punto sulla mappa." : "";
}

// =============== GITHUB: load + publish ===============
function ghHeaders(){
  return {
    "Authorization": `Bearer ${STATE.ghToken}`,
    "Accept": "application/vnd.github+json"
  };
}

async function ghGetFile(path){
  const [owner, repo] = STATE.ghRepo.split("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if(!res.ok) throw new Error(`GitHub GET ${path} ${res.status}`);
  return await res.json();
}

async function ghPutFile(path, contentStr, sha, message){
  const [owner, repo] = STATE.ghRepo.split("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(contentStr))),
    sha
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(()=>null);
  if(!res.ok) throw new Error(`GitHub PUT ${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function loadContentFromGithub(){
  STATE.ghToken = $("#ghToken").value.trim();
  STATE.ghRepo = $("#ghRepo").value.trim();
  save(LS.GH_TOKEN, STATE.ghToken);
  save(LS.GH_REPO, STATE.ghRepo);

  if(!STATE.ghToken || !STATE.ghRepo){
    $("#ghStatus").textContent = "Inserisci GitHub Token e Repo.";
    return;
  }

  $("#ghStatus").textContent = "Carico file da GitHub...";
  try{
    // places
    const placesFile = await ghGetFile("data/places.json");
    STATE.placesSha = placesFile.sha;
    STATE.places = JSON.parse(decodeURIComponent(escape(atob(placesFile.content))));

    // reviews
    const reviewsFile = await ghGetFile("data/reviews.json");
    STATE.reviewsSha = reviewsFile.sha;
    STATE.reviews = JSON.parse(decodeURIComponent(escape(atob(reviewsFile.content))));

    $("#ghStatus").textContent = `OK ✅ Posti: ${STATE.places.length} • Recensioni: ${STATE.reviews.length}`;
    renderPlacesAdmin();
    renderReviewsAdmin();
  } catch(e){
    console.warn(e);
    $("#ghStatus").textContent = "Errore caricamento: controlla token/repo/percorso file.";
  }
}

function renderPlacesAdmin(){
  const root = $("#placesList");
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
      <p class="muted">${escapeHTML(oneLine(p.description, 110))}</p>
    `;
    el.addEventListener("click", ()=> openEditor("places", p.id));
    root.appendChild(el);
  }
}

function renderReviewsAdmin(){
  const root = $("#reviewsList");
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
        ${r.place ? `<span class="badge">${escapeHTML(oneLine(r.place, 28))}</span>` : ``}
        ${isNum(r.lat)&&isNum(r.lng) ? `<span class="badge">📍</span>` : ``}
      </div>
      <h4>${escapeHTML(r.title || "")}</h4>
      <p class="muted">${escapeHTML(oneLine(r.text, 110))}</p>
    `;
    el.addEventListener("click", ()=> openEditor("reviews", r.id));
    root.appendChild(el);
  }
}

// =============== EDITOR posti/recensioni ===============
let EDIT_MODE = null; // "places" | "reviews"
let EDIT_ID = null;

function openEditor(mode, id){
  EDIT_MODE = mode;
  EDIT_ID = id;

  $("#editor").classList.remove("hidden");
  ensureMap();

  const isReview = mode === "reviews";
  $("#edRatingWrap").classList.toggle("hidden", !isReview);
  $("#edTitle").textContent = isReview ? "Editor • Recensione" : "Editor • Posto";

  const item = id ? (isReview ? STATE.reviews.find(x=>x.id===id) : STATE.places.find(x=>x.id===id)) : null;

  if(isReview){
    $("#edName").value = item?.title || "";
    $("#edCat").value  = item?.place || "";
    $("#edDesc").value = item?.text || "";
    $("#edLat").value  = (isNum(item?.lat) ? item.lat : "");
    $("#edLng").value  = (isNum(item?.lng) ? item.lng : "");
    $("#edRating").value = item?.rating ?? 5;
  } else {
    $("#edName").value = item?.name || "";
    $("#edCat").value  = item?.category || "";
    $("#edDesc").value = item?.description || "";
    $("#edLat").value  = (isNum(item?.lat) ? item.lat : "");
    $("#edLng").value  = (isNum(item?.lng) ? item.lng : "");
  }

  const lat = Number($("#edLat").value);
  const lng = Number($("#edLng").value);
  renderMapPin(Number.isFinite(lat)?lat:null, Number.isFinite(lng)?lng:null);

  $("#edStatus").textContent = id ? "Modifica elemento esistente." : "Nuovo elemento.";
}

function closeEditor(){
  $("#editor").classList.add("hidden");
  PICK_MODE = false;
  $("#btnPickOnMap").textContent = "📍 Seleziona su mappa";
  $("#edStatus").textContent = "";
  EDIT_MODE = null;
  EDIT_ID = null;
}

function saveEditorItem(){
  if(!EDIT_MODE) return;

  const isReview = EDIT_MODE === "reviews";

  const lat = $("#edLat").value ? Number($("#edLat").value) : null;
  const lng = $("#edLng").value ? Number($("#edLng").value) : null;

  if(isReview){
    const obj = {
      id: EDIT_ID || uid(),
      title: $("#edName").value.trim(),
      place: $("#edCat").value.trim(),
      rating: Math.max(1, Math.min(5, Number($("#edRating").value || 5))),
      text: $("#edDesc").value.trim(),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    };
    if(!obj.title || !obj.text){
      $("#edStatus").textContent = "Titolo e testo sono obbligatori.";
      return;
    }

    if(EDIT_ID){
      const idx = STATE.reviews.findIndex(x=>x.id===EDIT_ID);
      if(idx>=0) STATE.reviews[idx]=obj;
    } else {
      STATE.reviews.unshift(obj);
      EDIT_ID = obj.id;
    }
    $("#edStatus").textContent = "Salvato in memoria ✅ (ora Pubblica su GitHub)";
    renderReviewsAdmin();

  } else {
    const obj = {
      id: EDIT_ID || uid(),
      name: $("#edName").value.trim(),
      category: $("#edCat").value.trim() || "posto",
      description: $("#edDesc").value.trim(),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    };
    if(!obj.name || !obj.description){
      $("#edStatus").textContent = "Nome e descrizione sono obbligatori.";
      return;
    }

    if(EDIT_ID){
      const idx = STATE.places.findIndex(x=>x.id===EDIT_ID);
      if(idx>=0) STATE.places[idx]=obj;
    } else {
      STATE.places.unshift(obj);
      EDIT_ID = obj.id;
    }
    $("#edStatus").textContent = "Salvato in memoria ✅ (ora Pubblica su GitHub)";
    renderPlacesAdmin();
  }
}

function deleteEditorItem(){
  if(!EDIT_MODE || !EDIT_ID) return;
  const isReview = EDIT_MODE === "reviews";

  if(!confirm("Eliminare questo elemento?")) return;

  if(isReview){
    STATE.reviews = STATE.reviews.filter(x=>x.id!==EDIT_ID);
    renderReviewsAdmin();
  } else {
    STATE.places = STATE.places.filter(x=>x.id!==EDIT_ID);
    renderPlacesAdmin();
  }

  closeEditor();
  $("#ghStatus").textContent = "Eliminato in memoria ✅ (ora Pubblica su GitHub)";
}

async function publishToGithub(){
  if(!STATE.ghToken || !STATE.ghRepo){
    $("#ghStatus").textContent = "Inserisci Token e Repo.";
    return;
  }
  if(!STATE.placesSha || !STATE.reviewsSha){
    $("#ghStatus").textContent = "Prima fai: Carica Posti/Recensioni.";
    return;
  }

  $("#ghStatus").textContent = "Pubblico su GitHub...";
  try{
    const placesStr = JSON.stringify(STATE.places, null, 2);
    const reviewsStr = JSON.stringify(STATE.reviews, null, 2);

    const p = await ghPutFile("data/places.json", placesStr, STATE.placesSha, `Update places ${nowISO()}`);
    const r = await ghPutFile("data/reviews.json", reviewsStr, STATE.reviewsSha, `Update reviews ${nowISO()}`);

    STATE.placesSha = p.content.sha;
    STATE.reviewsSha = r.content.sha;

    $("#ghStatus").textContent = "Pubblicato ✅ (attendi GitHub Pages 30–60 sec)";
  } catch(e){
    console.warn(e);
    $("#ghStatus").textContent = "Errore publish: controlla permessi token/repo.";
  }
}

// =============== START ===============
bootSettings();
loadReports().catch(()=>{});
