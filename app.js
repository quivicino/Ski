/* Qui-Ski – piste, impianti, bar e ristoranti dei comprensori sciistici italiani, da OpenStreetMap.
   Legge dati/indice.json (comprensori e tessere) e le tessere dati/t/<i>_<j>.json della zona che si guarda,
   preparate da strumenti/tessere.py a partire da osm_ski.py.
   Se il GPS non c'è o non è in Italia, simula una posizione alla stazione delle cabinovie di Pila,
   così l'app si può provare da casa. */
(function () {
  "use strict";

  const VERSIONE = "Versione 2";
  const POSIZIONE_FINTA = { lat: 45.6879, lon: 7.3114, nome: "Pila, stazione delle cabinovie" };
  const ITALIA = { s: 35.3, w: 6.5, n: 47.2, e: 18.7 };
  const ZOOM_PISTE = 11;          // sotto questo zoom si vedono solo i comprensori
  const VICINO_KM = 40;           // all'avvio: se c'è un comprensorio entro questa distanza lo si inquadra

  const DIFF = {
    novice: { nome: "Verde", lungo: "Campo scuola", colore: "--p-novice" },
    easy: { nome: "Blu", lungo: "Facile", colore: "--p-easy" },
    intermediate: { nome: "Rossa", lungo: "Media", colore: "--p-intermediate" },
    advanced: { nome: "Nera", lungo: "Difficile", colore: "--p-advanced" },
    expert: { nome: "Nera", lungo: "Molto difficile", colore: "--p-advanced" },
    freeride: { nome: "Freeride", lungo: "Fuoripista", colore: "--p-freeride" },
    fondo: { nome: "Fondo", lungo: "Sci di fondo", colore: "--p-fondo" },
    nd: { nome: "Collegamento", lungo: "Collegamento", colore: "--p-nd" },
  };
  const ORDINE_DIFF = ["novice", "easy", "intermediate", "advanced", "fondo", "nd"];
  const IMPIANTI = {
    cable_car: "Funivia", gondola: "Cabinovia", mixed_lift: "Impianto misto", chair_lift: "Seggiovia",
    drag_lift: "Skilift", "t-bar": "Skilift ad ancora", "j-bar": "Skilift a gancio", platter: "Skilift a piattello",
    rope_tow: "Manovia", magic_carpet: "Tappeto",
  };
  const LOCALI = { restaurant: "Ristorante", bar: "Bar", cafe: "Caffè", fast_food: "Fast food", pub: "Pub" };
  const BATTITURA = { classic: "battuta", "classic+skating": "battuta (classico e skating)", skating: "skating", mogul: "a gobbe", backcountry: "non battuta", scooter: "battuta col gatto piccolo" };

  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let mappa, sfondi = {}, sfondo, livelli = {}, evidenza = null, marcaIo = null, rend;
  let indice = null, lato = 0.2;
  const tessereCaricate = new Map();   // nome -> Promise
  const tessereEsistenti = new Set();
  let piste = [], impianti = [], stazioni = [], locali = [], aree = [];
  const visti = new Set();
  let io = null, simulata = false, mosso = false;
  const mostra = { novice: true, easy: true, intermediate: true, advanced: true, fondo: true, nd: true, impianti: true, stazioni: true, locali: true, comprensorio: true };
  let sezione = "piste", ordine = "distanza";

  /* ---------- geometria ---------- */
  function distanza(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function lunghezza(g) {
    let m = 0;
    for (let i = 1; i < g.length; i++) m += distanza(g[i - 1], g[i]);
    return m;
  }
  function piuVicino(p, g) {
    let best = Infinity;
    for (const q of g) { const d = distanza(p, q); if (d < best) best = d; }
    return best;
  }
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`);
  const fmtKm = (m) => (m / 1000).toFixed(m < 100000 ? 1 : 0).replace(".", ",");
  const pt = (a) => ({ lat: a[0], lon: a[1] });
  const ll = (g) => g.map((p) => [p.lat, p.lon]);
  function riquadro(g) {
    let s = 90, n = -90, w = 180, e = -180;
    for (const p of g) { if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon; }
    return { s, n, w, e };
  }
  const siToccano = (a, b, m) => a.s - m <= b.n && b.s - m <= a.n && a.w - m <= b.e && b.w - m <= a.e;

  /* ---------- mappa ---------- */
  function creaMappa() {
    rend = L.canvas({ padding: 0.5, tolerance: 6 });
    mappa = L.map("mappa", { zoomControl: false, preferCanvas: true, renderer: rend }).setView([45.9, 9.5], 6);
    sfondi.topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, © <a href="https://opentopomap.org">OpenTopoMap</a>',
    });
    sfondi.stradale = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    sfondi.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Immagini © Esri",
    });
    cambiaSfondo("topo");
    mappa.attributionControl.setPrefix("Qui-Ski · " + VERSIONE);
    for (const d of ORDINE_DIFF) livelli[d] = L.layerGroup();
    for (const k of ["impianti", "etichette", "stazioni", "locali", "comprensorio", "comprensori"]) livelli[k] = L.layerGroup();
    mappa.on("click", () => { mappa.closePopup(); togliEvidenza(); });
    mappa.on("moveend", () => { aggiornaZoom(); caricaVista(); });
  }
  function cambiaSfondo(n) {
    if (sfondo) mappa.removeLayer(sfondo);
    sfondo = sfondi[n].addTo(mappa);
    sfondo.bringToBack();
    $("mappa").classList.toggle("satellite", n === "satellite");
  }

  /* ---------- tessere ---------- */
  function nomiTessere(b, margine) {
    const out = [];
    const i0 = Math.floor((b.s - margine) / lato), i1 = Math.floor((b.n + margine) / lato);
    const j0 = Math.floor((b.w - margine) / lato), j1 = Math.floor((b.e + margine) / lato);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return out;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const n = `${i}_${j}`;
      if (tessereEsistenti.has(n)) out.push(n);
    }
    return out;
  }
  function caricaTessera(n) {
    if (!tessereCaricate.has(n)) {
      tessereCaricate.set(n, fetch(`dati/t/${n}.json`).then((r) => r.json()).then(aggiungi).catch((e) => console.error(n, e)));
    }
    return tessereCaricate.get(n);
  }
  function caricaIntorno(b) {
    return Promise.all(nomiTessere(b, lato).map(caricaTessera));
  }
  function caricaVista() {
    if (!indice || mappa.getZoom() < ZOOM_PISTE) return;
    const v = mappa.getBounds();
    caricaIntorno({ s: v.getSouth(), n: v.getNorth(), w: v.getWest(), e: v.getEast() }).then(() => {
      if (!$("pannello").hidden) elenco();
    });
  }

  /* ---------- oggetti ---------- */
  function diffDi(t) {
    if (t["piste:type"] === "nordic") return "fondo";
    if (t["piste:type"] === "connection") return "nd";
    const d = t["piste:difficulty"];
    if (d === "expert" || d === "freeride" || d === "extreme") return "advanced"; // sulla mappa come le nere
    return ORDINE_DIFF.includes(d) ? d : "nd";
  }
  function aggiungi(lista) {
    for (const e of lista) {
      if (visti.has(e.id)) continue;
      visti.add(e.id);
      const t = e.tags || {};
      if (e.k === "P") aggiungiPista(e, t);
      else if (e.k === "I") aggiungiImpianto(e, t);
      else if (e.k === "S") aggiungiStazione(e, t);
      else if (e.k === "L") aggiungiLocale(e, t);
      else if (e.k === "Z") aggiungiArea(e, t);
    }
    aggiornaEtichette();
  }
  function aggiungiPista(e, t) {
    const d = diffDi(t);
    const tratti = (e.g ? [e.g] : e.tr).map((g) => g.map(pt));
    for (const g of tratti) {
      const b = riquadro(g);
      // stesso nome e stessa difficoltà, e vicini (entro ~500 m): è la stessa pista divisa in tratti
      let p = t.name ? piste.find((x) => x.nome === t.name && x.diff === d && siToccano(x.box, b, 0.005)) : null;
      if (!p) {
        p = { tipo: "pista", id: "p" + e.id + "_" + piste.length, nome: t.name || "", haNome: !!t.name, ref: t.ref || "", diff: d, tratti: [], punti: [], metri: 0, tags: t, box: b };
        if (!p.nome) p.nome = d === "nd" ? "Collegamento" : d === "fondo" ? "Pista di fondo senza nome" : `Pista ${DIFF[d].nome.toLowerCase()} senza nome`;
        piste.push(p);
      }
      p.tratti.push(g);
      p.punti.push(...g);
      p.metri += lunghezza(g);
      p.box = { s: Math.min(p.box.s, b.s), n: Math.max(p.box.n, b.n), w: Math.min(p.box.w, b.w), e: Math.max(p.box.e, b.e) };
      if (!p.ref && t.ref) p.ref = t.ref;
      disegnaTratto(p, g);
    }
  }
  function aggiungiImpianto(e, t) {
    const g = e.g.map(pt);
    const i = { tipo: "impianto", id: "i" + e.id, nome: t.name || IMPIANTI[t.aerialway] || "Impianto", tags: t, tratti: [g], punti: g, metri: lunghezza(g), valle: g[0], monte: g[g.length - 1], box: riquadro(g) };
    impianti.push(i);
    const c = ll(g);
    L.polyline(c, { color: "#fff", weight: 6, opacity: 0.85, interactive: false, renderer: rend }).addTo(livelli.impianti);
    const linea = L.polyline(c, { color: css("--impianto"), weight: 3, renderer: rend });
    linea.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(i, ev.latlng); });
    linea.addTo(livelli.impianti);
    L.polyline(c, { color: css("--impianto"), weight: 9, dashArray: "2 22", interactive: false, renderer: rend }).addTo(livelli.impianti);
    const m = g[Math.floor(g.length / 2)];
    L.marker([m.lat, m.lon], { icon: L.divIcon({ className: "etichetta-impianto", html: `<span>${esc(i.nome)}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(livelli.etichette);
  }
  function aggiungiStazione(e, t) {
    const s = { tipo: "stazione", id: "s" + e.id, nome: t.name || "Stazione", tags: t, punto: pt(e.p) };
    s.punti = [s.punto];
    stazioni.push(s);
    const m = L.marker([s.punto.lat, s.punto.lon], { icon: L.divIcon({ className: "", html: '<span class="mk stazione"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }) });
    m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(s, ev.latlng); });
    m.addTo(livelli.stazioni);
  }
  function aggiungiLocale(e, t) {
    const l = { tipo: "locale", id: "l" + e.id, nome: t.name || LOCALI[t.amenity] || "Rifugio", tags: t, punto: pt(e.p) };
    l.punti = [l.punto];
    locali.push(l);
    const cls = t.tourism === "alpine_hut" ? "rifugio" : "locale";
    const m = L.marker([l.punto.lat, l.punto.lon], { icon: L.divIcon({ className: "", html: `<span class="mk ${cls}">${iconaLocale()}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
    m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(l, ev.latlng); });
    m.addTo(livelli.locali);
  }
  function aggiungiArea(e, t) {
    const tratti = (e.g ? [e.g] : e.tr).map((g) => g.map(pt));
    aree.push({ nome: t.name || "", tratti, box: riquadro(tratti.flat()) });
    // confine ben visibile: alone bianco, tratteggio blu scuro spesso e un velo azzurro dentro
    const anelli = tratti.map(ll);
    L.polygon(anelli, { stroke: false, fillColor: css("--confine"), fillOpacity: 0.08, interactive: false, renderer: rend }).addTo(livelli.comprensorio);
    for (const c of anelli) {
      L.polyline(c, { color: "#fff", weight: 7, opacity: 0.9, interactive: false, renderer: rend }).addTo(livelli.comprensorio);
      L.polyline(c, { color: css("--confine"), weight: 3.5, dashArray: "12 7", interactive: false, renderer: rend }).addTo(livelli.comprensorio);
    }
  }
  function disegnaTratto(p, g) {
    const colore = css(DIFF[p.diff].colore), c = ll(g);
    L.polyline(c, { color: "#fff", weight: 7, opacity: 0.8, interactive: false, renderer: rend }).addTo(livelli[p.diff]);
    const linea = L.polyline(c, { color: colore, weight: 4, dashArray: p.diff === "nd" || p.diff === "fondo" ? "6 6" : null, renderer: rend });
    linea.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(p, ev.latlng); });
    linea.addTo(livelli[p.diff]);
    if (p.ref && p.diff !== "nd" && p.tratti.length === 1) {
      const q = g[Math.floor(g.length / 2)];
      const m = L.marker([q.lat, q.lon], { icon: L.divIcon({ className: "", html: `<span class="num-pista" style="background:${colore}">${esc(p.ref)}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) });
      m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(p, ev.latlng); });
      m.addTo(livelli.etichette);
    }
  }
  const iconaLocale = () => '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 2v8M5 2v5a2 2 0 0 0 4 0V2M7 10v12M16.5 22V2c-2.5 1-3.5 4-3.5 8h3.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- comprensori (zoom basso) ---------- */
  function disegnaComprensori() {
    for (const c of indice.comprensori) {
      if (!c.nome && c.km < 3) continue;
      const r = c.km >= 100 ? 11 : c.km >= 30 ? 9 : c.km >= 8 ? 7 : 5;
      const m = L.circleMarker(c.c, { radius: r, color: "#fff", weight: 2, fillColor: css("--blu"), fillOpacity: 0.9, renderer: rend });
      m.bindTooltip(`<b>${esc(c.nome || "Comprensorio senza nome")}</b><br>${c.km ? fmtKm(c.km * 1000) + " km di piste" : ""}${c.imp ? " · " + c.imp + " impianti" : ""}`, { direction: "top" });
      m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); vaiAComprensorio(c); });
      m.addTo(livelli.comprensori);
    }
  }
  function vaiAComprensorio(c) {
    mosso = true;
    mappa.fitBounds([[c.b[0], c.b[1]], [c.b[2], c.b[3]]], { padding: [20, 20], maxZoom: 15 });
  }
  function comprensorioQui(p) {
    if (!indice) return null;
    let best = null, area = Infinity;
    for (const c of indice.comprensori) {
      const [s, w, n, e] = c.b;
      if (p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e) {
        const a = (n - s) * (e - w);
        if (a < area && c.nome) { area = a; best = c; }
      }
    }
    return best;
  }
  function comprensorioVicino(p) {
    let best = null, bd = Infinity;
    for (const c of indice.comprensori) {
      if (c.km < 3) continue;
      const d = distanza(p, pt(c.c));
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { c: best, d: bd } : null;
  }

  function aggiornaZoom() {
    const alto = mappa.getZoom() >= ZOOM_PISTE;
    for (const k of [...ORDINE_DIFF, "impianti", "stazioni", "locali", "comprensorio"]) {
      if (alto && mostra[k]) livelli[k].addTo(mappa); else mappa.removeLayer(livelli[k]);
    }
    if (alto) mappa.removeLayer(livelli.comprensori); else livelli.comprensori.addTo(mappa);
    $("fab-azioni").hidden = false;
    aggiornaEtichette();
  }
  function aggiornaEtichette() {
    if (!mappa) return;
    if (mappa.getZoom() >= 14 && (mostra.impianti || ORDINE_DIFF.some((d) => mostra[d]))) livelli.etichette.addTo(mappa);
    else mappa.removeLayer(livelli.etichette);
  }

  /* ---------- selezione e scheda ---------- */
  function coloreDi(o) {
    if (o.tipo === "pista") return css(DIFF[o.diff].colore);
    if (o.tipo === "locale") return css("--locale");
    return css("--impianto");
  }
  function togliEvidenza() {
    if (evidenza) { mappa.removeLayer(evidenza); evidenza = null; }
  }
  function evidenzia(o) {
    togliEvidenza();
    evidenza = L.layerGroup();
    if (o.tratti) {
      for (const g of o.tratti) {
        L.polyline(ll(g), { color: "#ffc400", weight: 13, opacity: 0.75, interactive: false, renderer: rend }).addTo(evidenza);
        L.polyline(ll(g), { color: coloreDi(o), weight: 5, interactive: false, renderer: rend }).addTo(evidenza);
      }
    } else {
      L.circleMarker([o.punto.lat, o.punto.lon], { radius: 20, color: "#ffc400", weight: 4, fillOpacity: 0.15, interactive: false, renderer: rend }).addTo(evidenza);
    }
    evidenza.addTo(mappa);
  }
  function inquadra(o) {
    mosso = true;
    if (o.tratti) mappa.fitBounds(L.latLngBounds(o.tratti.flatMap(ll)), { padding: [60, 60], maxZoom: 16 });
    else mappa.setView([o.punto.lat, o.punto.lon], Math.max(mappa.getZoom(), 16));
  }
  function sottotitolo(o) {
    if (o.tipo === "pista") {
      const D = DIFF[o.diff];
      const quale = o.diff === "nd" ? "Collegamento" : o.diff === "fondo" ? "Pista di fondo" : "Pista " + D.nome.toLowerCase();
      return `${quale}${o.ref ? " n. " + esc(o.ref) : ""} · ${fmtDist(o.metri)}`;
    }
    if (o.tipo === "impianto") return `${IMPIANTI[o.tags.aerialway] || "Impianto"} · ${fmtDist(o.metri)}`;
    if (o.tipo === "stazione") return "Stazione di impianto";
    return o.tags.tourism === "alpine_hut" ? "Rifugio" : LOCALI[o.tags.amenity] || "Locale";
  }
  function scegli(o, dove) {
    evidenzia(o);
    const html = `<div class="fumetto"><b>${esc(o.nome)}</b><small>${sottotitolo(o)}</small>${o.tipo === "stazione" ? "" : '<span class="apri">Apri la scheda ›</span>'}</div>`;
    const pop = L.popup({ closeButton: false, offset: [0, -6] }).setLatLng(dove || [o.punti[0].lat, o.punti[0].lon]).setContent(html).openOn(mappa);
    const el = pop.getElement();
    if (el && o.tipo !== "stazione") el.querySelector(".fumetto").addEventListener("click", () => apriScheda(o));
  }

  function riga(dt, dd) { return dd === undefined || dd === null || dd === "" ? "" : `<dt>${dt}</dt><dd>${dd}</dd>`; }
  const daTe = () => `da te${simulata ? " (simulato)" : ""}`;
  function apriScheda(o) {
    mappa.closePopup();
    evidenzia(o);
    inquadra(o);
    $("scheda-titolo").textContent = o.nome;
    const t = o.tags, c = $("scheda-contenuto");
    let h = "";
    const dist = io ? fmtDist(piuVicino(io, o.punti)) : "–";
    const zona = comprensorioQui(o.punti[0]);
    if (o.tipo === "pista") {
      const D = DIFF[o.diff];
      h += `<div class="s-testa"><span class="s-badge" style="background:${coloreDi(o)}">${D.nome}${o.ref ? " " + esc(o.ref) : ""}</span><span class="s-sotto">${D.lungo}${zona ? " · " + esc(zona.nome) : ""}</span></div>`;
      h += `<div class="s-griglia"><div class="kpi kpi-blu"><b>${fmtKm(o.metri)} km</b><span>lunghezza</span></div><div class="kpi"><b>${dist}</b><span>${daTe()}</span></div></div>`;
      h += `<dl class="s-righe">${riga("Numero", esc(o.ref))}${riga("Battitura", esc(BATTITURA[t["piste:grooming"]] || t["piste:grooming"]))}${riga("Illuminata", t.lit === "yes" ? "sì" : t.lit === "no" ? "no" : "")}${riga("Gestore", esc(t.operator))}${riga("Tratti sulla mappa", o.tratti.length > 1 ? o.tratti.length : "")}</dl>`;
      const vicini = impianti.map((i) => ({ i, d: Math.min(distanza(o.punti[0], i.monte), distanza(o.punti[0], i.valle)) })).filter((x) => x.d < 2000).sort((a, b) => a.d - b.d).slice(0, 2);
      if (vicini.length) h += `<h3 class="s-titoletto">Impianti vicino alla partenza</h3><ol class="lista">${vicini.map(({ i, d }) => voce(i, d)).join("")}</ol>`;
      const v = locali.map((l) => ({ l, d: piuVicino(l.punto, o.punti) })).filter((x) => x.d < 300).sort((a, b) => a.d - b.d);
      if (v.length) h += `<h3 class="s-titoletto">Bar e ristoranti lungo la pista</h3><ol class="lista">${v.map(({ l, d }) => voce(l, d)).join("")}</ol>`;
    } else if (o.tipo === "impianto") {
      const tempo = t["aerialway:duration"] ? `${String(t["aerialway:duration"]).replace(".", ",")} min` : "–";
      h += `<div class="s-testa"><span class="s-badge" style="background:${css("--impianto")}">${IMPIANTI[t.aerialway] || "Impianto"}</span><span class="s-sotto">${zona ? esc(zona.nome) : ""}</span></div>`;
      h += `<div class="s-griglia"><div class="kpi kpi-blu"><b>${fmtDist(o.metri)}</b><span>lunghezza</span></div><div class="kpi"><b>${tempo}</b><span>durata della corsa</span></div>
        <div class="kpi"><b>${t["aerialway:capacity"] ? Number(t["aerialway:capacity"]).toLocaleString("it-IT") : "–"}</b><span>persone all'ora</span></div><div class="kpi"><b>${dist}</b><span>${daTe()}</span></div></div>`;
      const sn = (k) => (t[k] === "yes" ? "sì" : t[k] === "no" ? "no" : "");
      h += `<dl class="s-righe">${riga("Posti per veicolo", esc(t["aerialway:occupancy"]))}${riga("Cupola", sn("aerialway:bubble"))}${riga("Sedili riscaldati", sn("aerialway:heating"))}${riga("Bici", t["aerialway:bicycle"] === "summer" ? "d'estate" : t.bicycle === "yes" ? "sì" : "")}${riga("Gestore", esc(t.operator))}${riga("Note", esc((t.note || "").replace("Costruttore: ", "costruttore ")))}</dl>`;
      const sv = (p) => stazioni.map((s) => ({ s, d: distanza(p, s.punto) })).sort((a, b) => a.d - b.d)[0];
      const a = sv(o.valle), b = sv(o.monte);
      h += `<dl class="s-righe">${riga("Stazione a valle", a && a.d < 300 ? esc(a.s.nome) : "")}${riga("Stazione a monte", b && b.d < 300 ? esc(b.s.nome) : "")}</dl>`;
      const dalMonte = piste.filter((p) => p.diff !== "nd" && siToccano(p.box, riquadro([o.monte]), 0.002) && piuVicino(o.monte, p.punti) < 150).sort((x, y) => ORDINE_DIFF.indexOf(x.diff) - ORDINE_DIFF.indexOf(y.diff));
      if (dalMonte.length) h += `<h3 class="s-titoletto">Piste dall'arrivo</h3><ol class="lista">${dalMonte.slice(0, 8).map((p) => voce(p)).join("")}</ol>`;
    } else {
      h += `<div class="s-testa"><span class="s-badge" style="background:${css("--locale")}">${esc(sottotitolo(o))}</span><span class="s-sotto">${zona ? esc(zona.nome) : ""}</span></div>`;
      h += `<div class="s-griglia"><div class="kpi"><b>${dist}</b><span>${daTe()}</span></div><div class="kpi"><b>${t.ele ? esc(t.ele) + " m" : "–"}</b><span>quota</span></div></div>`;
      const sito = t.website && /^https?:\/\//.test(t.website) ? t.website : "";
      h += `<dl class="s-righe">${riga("Orari", esc(t.opening_hours))}${riga("Cucina", esc(t.cuisine))}${riga("Telefono", t.phone ? `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>` : "")}${riga("Sito", sito ? `<a href="${esc(sito)}" target="_blank" rel="noopener">${esc(sito.replace(/^https?:\/\//, ""))}</a>` : "")}</dl>`;
      const vicine = piste.filter((p) => p.diff !== "nd" && siToccano(p.box, riquadro([o.punto]), 0.004)).map((p) => ({ p, d: piuVicino(o.punto, p.punti) })).filter((x) => x.d < 300).sort((a, b) => a.d - b.d).slice(0, 5);
      if (vicine.length) h += `<h3 class="s-titoletto">Piste qui vicino</h3><ol class="lista">${vicine.map(({ p, d }) => voce(p, d)).join("")}</ol>`;
      h += `<a class="btn btn-blu" href="https://www.google.com/maps/dir/?api=1&destination=${o.punto.lat},${o.punto.lon}&travelmode=walking" target="_blank" rel="noopener">Portami qui</a>`;
    }
    h += `<button class="btn btn-chiaro" type="button" id="btn-vedi">Vedi sulla mappa</button>`;
    c.innerHTML = h;
    c.scrollTop = 0;
    c.querySelectorAll(".voce").forEach((li) => li.addEventListener("click", () => apriScheda(trova(li.dataset.id))));
    $("btn-vedi").addEventListener("click", chiudiTutto);
    $("pannello").hidden = true;
    $("scheda").hidden = false;
  }
  const tutti = () => [...piste, ...impianti, ...locali, ...stazioni];
  const trova = (id) => tutti().find((o) => o.id === id);

  /* ---------- elenco ---------- */
  function iconaVoce(o) {
    if (o.tipo === "pista") return `<span class="icona" style="background:${coloreDi(o)}">${o.ref ? esc(o.ref) : ""}</span>`;
    if (o.tipo === "impianto") return `<span class="icona" style="background:${css("--impianto")}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 5 22 2" stroke="currentColor" stroke-width="2"/><path d="M12 3.6V9" stroke="currentColor" stroke-width="2"/><rect x="6" y="9" width="12" height="10" rx="3" fill="currentColor"/></svg></span>`;
    return `<span class="icona" style="background:${css("--locale")}">${iconaLocale()}</span>`;
  }
  function voce(o, d) {
    const dd = d !== undefined ? d : io ? piuVicino(io, o.punti) : null;
    return `<li class="voce" data-id="${o.id}">${iconaVoce(o)}<div class="voce-testo"><div class="voce-titolo">${esc(o.nome)}</div><div class="voce-meta">${sottotitolo(o)}</div></div><span class="voce-dist">${dd !== null ? fmtDist(dd) : ""}</span></li>`;
  }
  function voceComprensorio(c) {
    const d = io ? fmtDist(distanza(io, pt(c.c))) : "";
    return `<li class="voce" data-comp="${esc(c.id)}"><span class="icona" style="background:var(--blu)"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 20 9 8l4 6 3-4 6 10Z" fill="currentColor"/></svg></span><div class="voce-testo"><div class="voce-titolo">${esc(c.nome || "Comprensorio senza nome")}</div><div class="voce-meta">${c.km ? fmtKm(c.km * 1000) + " km di piste" : "piste non mappate"}${c.imp ? " · " + c.imp + " impianti" : ""}</div></div><span class="voce-dist">${d}</span></li>`;
  }
  function nellaVista() {
    const v = mappa.getBounds();
    const b = { s: v.getSouth(), n: v.getNorth(), w: v.getWest(), e: v.getEast() };
    return (o) => o.punti.some((p) => p.lat >= b.s && p.lat <= b.n && p.lon >= b.w && p.lon <= b.e);
  }
  function elenco() {
    const q = $("cerca").value.trim().toLowerCase();
    const centro = io || pt([mappa.getCenter().lat, mappa.getCenter().lng]);
    const zona = comprensorioQui(pt([mappa.getCenter().lat, mappa.getCenter().lng]));
    $("pannello-titolo").textContent = zona ? zona.nome : mappa.getZoom() >= ZOOM_PISTE ? "Zona della mappa" : "Qui-Ski";
    const dentro = nellaVista();
    const vediPiste = mappa.getZoom() >= ZOOM_PISTE;
    const pv = vediPiste ? piste.filter((p) => p.diff !== "nd" && p.diff !== "fondo" && dentro(p)) : [];
    $("k-km").textContent = vediPiste ? fmtKm(pv.reduce((s, p) => s + p.metri, 0)) : "–";
    $("k-imp").textContent = vediPiste ? impianti.filter(dentro).length : "–";
    $("k-loc").textContent = vediPiste ? locali.filter(dentro).length : "–";
    let html;
    if (sezione === "comprensori") {
      let lista = indice.comprensori.filter((c) => c.nome);
      if (q) lista = lista.filter((c) => c.nome.toLowerCase().includes(q));
      lista = [...lista].sort(ordine === "nome" ? (a, b) => a.nome.localeCompare(b.nome, "it") : (a, b) => distanza(centro, pt(a.c)) - distanza(centro, pt(b.c)));
      html = lista.slice(0, 200).map(voceComprensorio).join("");
    } else if (!vediPiste) {
      html = '<li class="vuoto">Avvicinati a un comprensorio sulla mappa, o scegline uno in <b>Comprensori</b>.</li>';
    } else {
      // nell'elenco niente collegamenti e niente pezzetti senza nome (restano sulla mappa)
      let lista = sezione === "piste" ? piste.filter((p) => mostra[p.diff] && p.diff !== "nd" && (p.haNome || p.metri >= 200)) : sezione === "impianti" ? impianti : locali;
      lista = lista.filter(dentro);
      if (q) lista = lista.filter((o) => o.nome.toLowerCase().includes(q) || (o.ref || "").toLowerCase() === q);
      const d = (o) => piuVicino(centro, o.punti);
      lista = [...lista].sort(ordine === "nome" ? (a, b) => a.nome.localeCompare(b.nome, "it") : (a, b) => d(a) - d(b));
      html = lista.slice(0, 300).map((o) => voce(o)).join("");
    }
    $("lista").innerHTML = html || '<li class="vuoto">Niente da mostrare con queste scelte.</li>';
    $("lista").querySelectorAll(".voce").forEach((li) => li.addEventListener("click", () => {
      if (li.dataset.comp) { chiudiTutto(); vaiAComprensorio(indice.comprensori.find((c) => c.id === li.dataset.comp)); }
      else apriScheda(trova(li.dataset.id));
    }));
  }
  function apriElenco() {
    if (mappa.getZoom() < ZOOM_PISTE && sezione !== "comprensori") scegliSezione("comprensori");
    elenco();
    $("scheda").hidden = true;
    $("pannello").hidden = false;
    $("btn-elenco").setAttribute("aria-expanded", "true");
  }
  function chiudiTutto() {
    $("pannello").hidden = true;
    $("scheda").hidden = true;
    $("btn-elenco").setAttribute("aria-expanded", "false");
  }
  function scegliSezione(s) {
    sezione = s;
    document.querySelectorAll(".chip.sezione").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.sezione === s)));
  }

  /* ---------- menu Cosa mostrare ---------- */
  function menu() {
    const voceMenu = (k, testo, segno) => `<label class="cat-voce"><input type="checkbox" data-k="${k}" ${mostra[k] ? "checked" : ""}>${segno}<span>${testo}</span></label>`;
    $("cat-piste").innerHTML = ORDINE_DIFF.map((d) => voceMenu(d, d === "nd" ? "Collegamenti" : d === "fondo" ? "Sci di fondo" : `${DIFF[d].nome} <small>(${DIFF[d].lungo.toLowerCase()})</small>`, `<span class="riga-colore" style="background:${css(DIFF[d].colore)}"></span>`)).join("");
    $("cat-voci").innerHTML = [
      voceMenu("impianti", "Impianti di risalita", `<span class="riga-colore" style="background:${css("--impianto")}"></span>`),
      voceMenu("stazioni", "Stazioni", '<span class="mk stazione" style="margin:0 6px"></span>'),
      voceMenu("locali", "Bar e ristoranti", `<span class="mk locale" style="width:26px;height:26px">${iconaLocale()}</span>`),
      voceMenu("comprensorio", "Confine del comprensorio", `<span class="riga-colore" style="background:none;height:0;border-top:4px dashed ${css("--confine")}"></span>`),
    ].join("");
    document.querySelectorAll("#cat-menu input").forEach((inp) => inp.addEventListener("change", () => {
      mostra[inp.dataset.k] = inp.checked;
      aggiornaZoom();
      testoCategoria();
    }));
  }
  function testoCategoria() {
    const n = ORDINE_DIFF.filter((d) => mostra[d]).length;
    $("categoria-testo").textContent = n === ORDINE_DIFF.length ? "Tutte le piste" : n === 0 ? "Nessuna pista" : `${n} tipi di piste`;
  }

  /* ---------- posizione ---------- */
  function mettiIo(p) {
    io = p;
    if (simulata && cerchio) { mappa.removeLayer(cerchio); cerchio = null; }
    if (marcaIo) marcaIo.setLatLng([p.lat, p.lon]);
    else marcaIo = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: '<span class="io"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000, interactive: false }).addTo(mappa);
    $("simula").hidden = true; // niente riquadro "Simulazione" sulla mappa (lo dice solo la riga di stato nell'elenco)
    $("stato").textContent = simulata ? `Posizione simulata: ${POSIZIONE_FINTA.nome}.` : `Posizione dal GPS${p.acc ? ` (precisione ${Math.round(p.acc)} m)` : ""}.`;
  }
  function inItalia(p) { return p.lat >= ITALIA.s && p.lat <= ITALIA.n && p.lon >= ITALIA.w && p.lon <= ITALIA.e; }
  /* GPS: watchPosition resta acceso e sposta il punto azzurro a ogni nuova posizione.
     Finché non arriva una posizione vera (o se è fuori Italia, o se il GPS è negato) si usa quella simulata. */
  let gpsAttivo = false, primaVera = null, cerchio = null;
  const attesaVera = [];
  function avviaGps() {
    if (gpsAttivo || !navigator.geolocation) return;
    gpsAttivo = true;
    navigator.geolocation.watchPosition((pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      if (!inItalia(p)) { if (!io) usaFinta("sei fuori Italia"); return; }
      const primaVolta = simulata || !io;
      simulata = false;
      mettiIo(p);
      if (cerchio) cerchio.setLatLng([p.lat, p.lon]).setRadius(p.acc || 0);
      else cerchio = L.circle([p.lat, p.lon], { radius: p.acc || 0, color: "#2f7cf6", weight: 1, fillOpacity: 0.08, interactive: false, renderer: rend }).addTo(mappa);
      if (primaVolta) {
        primaVera = p;
        // la prima posizione vera arriva dopo la simulata: se non hai ancora mosso la mappa, inquadra dove sei
        if (indice && !mosso) inquadraIntorno(p);
        while (attesaVera.length) attesaVera.shift()(p);
      }
    }, (err) => {
      const perche = err.code === 1 ? "il permesso per la posizione è negato" : err.code === 3 ? "il GPS non risponde" : "posizione non disponibile";
      if (!io || simulata) usaFinta(perche);
      if (err.code === 1) gpsAttivo = false;
      while (attesaVera.length) attesaVera.shift()(null);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
  function usaFinta(perche) {
    simulata = true;
    mettiIo(POSIZIONE_FINTA);
    if (perche) $("simula-testo").textContent = `sei a Pila (${perche})`;
  }
  // aspetta la prima posizione vera fino a "ms"; intanto, se non c'è niente, usa quella simulata
  function posizione(ms = 6000) {
    avviaGps();
    if (io && !simulata) return Promise.resolve(io);
    return new Promise((ok) => {
      const t = setTimeout(() => { if (!io) usaFinta(navigator.geolocation ? "il GPS non ha ancora risposto" : "il telefono non dà la posizione"); ok(io); }, ms);
      attesaVera.push(() => { clearTimeout(t); if (!io) usaFinta(); ok(io); });
    });
  }
  function inquadraIntorno(p) {
    const v = comprensorioVicino(p);
    if (v && v.d < VICINO_KM * 1000) {
      const c = v.c;
      mappa.fitBounds(L.latLngBounds([[c.b[0], c.b[1]], [c.b[2], c.b[3]]]).extend([p.lat, p.lon]), { padding: [30, 30], maxZoom: 15 });
    } else {
      mappa.setView([p.lat, p.lon], 9);
    }
  }
  async function piuVicinoA(lista, punto) {
    if (!io) await posizione();
    await caricaIntorno({ s: io.lat - 0.15, n: io.lat + 0.15, w: io.lon - 0.2, e: io.lon + 0.2 });
    let best = null, bd = Infinity;
    for (const o of lista()) {
      const d = distanza(io, punto(o));
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /* ---------- avvio ---------- */
  function collega() {
    $("btn-elenco").addEventListener("click", apriElenco);
    $("btn-chiudi").addEventListener("click", chiudiTutto);
    $("btn-chiudi-scheda").addEventListener("click", chiudiTutto);
    $("btn-centra").addEventListener("click", async () => {
      await posizione();
      mosso = true;
      mappa.setView([io.lat, io.lon], Math.max(mappa.getZoom(), 14));
    });
    $("btn-comprensorio").addEventListener("click", () => {
      const c = comprensorioQui(pt([mappa.getCenter().lat, mappa.getCenter().lng])) || (io && comprensorioVicino(io) || {}).c;
      if (c) vaiAComprensorio(c);
    });
    $("btn-impianto").addEventListener("click", async () => {
      const i = await piuVicinoA(() => impianti, (o) => o.valle); // si sale dalla stazione a valle
      if (i) { inquadra(i); scegli(i, [i.valle.lat, i.valle.lon]); }
    });
    $("btn-locale").addEventListener("click", async () => {
      const l = await piuVicinoA(() => locali, (o) => o.punto);
      if (l) { mosso = true; mappa.setView([l.punto.lat, l.punto.lon], 16); evidenzia(l); scegli(l); }
    });
    $("sfondo").addEventListener("change", (e) => cambiaSfondo(e.target.value));
    document.querySelectorAll(".chip.sezione").forEach((b) => b.addEventListener("click", () => { scegliSezione(b.dataset.sezione); elenco(); }));
    document.querySelectorAll(".chip.ordine").forEach((b) => b.addEventListener("click", () => {
      ordine = b.dataset.ordine;
      document.querySelectorAll(".chip.ordine").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      elenco();
    }));
    const cat = $("categoria"), cm = $("cat-menu");
    const apri = (s) => { cm.hidden = !s; cat.setAttribute("aria-expanded", String(s)); };
    cat.addEventListener("click", (e) => { e.stopPropagation(); apri(cm.hidden); });
    $("cat-ok").addEventListener("click", () => apri(false));
    document.addEventListener("click", (e) => { if (!cm.hidden && !cm.contains(e.target) && e.target !== cat) apri(false); });
    $("form-cerca").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("cerca").value.trim().toLowerCase();
      $("cerca").blur();
      if (!q) return;
      // prima i comprensori (il nome che corrisponde meglio), poi piste e impianti già caricati
      const comp = indice.comprensori.filter((c) => c.nome && c.nome.toLowerCase().includes(q))
        .sort((a, b) => (a.nome.toLowerCase().startsWith(q) ? 0 : 1) - (b.nome.toLowerCase().startsWith(q) ? 0 : 1) || b.km - a.km)[0];
      const o = tutti().find((x) => x.tipo !== "stazione" && (x.nome.toLowerCase().includes(q) || (x.ref || "").toLowerCase() === q));
      if (comp) { $("cerca").value = ""; vaiAComprensorio(comp); }
      else if (o) apriScheda(o);
      else { scegliSezione("comprensori"); apriElenco(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiTutto(); });
  }

  async function avvia() {
    creaMappa();
    collega();
    $("versione").textContent = "Qui-Ski · " + VERSIONE;
    try {
      indice = await (await fetch("dati/indice.json", { cache: "no-cache" })).json();
    } catch (e) {
      $("stato").textContent = "Non riesco a leggere i dati.";
      $("stato").classList.add("errore");
      console.error(e);
      return;
    }
    lato = indice.lato;
    indice.tessere.forEach((n) => tessereEsistenti.add(n));
    if (indice.osm) $("data-osm").textContent = new Date(indice.osm).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
    menu();
    testoCategoria();
    disegnaComprensori();
    aggiornaZoom();
    const p = await posizione();
    // se la pagina si apre in una scheda nascosta la mappa parte con dimensione zero: reinquadra quando compare
    const inizio = () => { mappa.invalidateSize(); if (!mosso) inquadraIntorno(p); };
    inizio();
    new ResizeObserver(() => { const el = $("mappa"); if (el.clientWidth > 0 && el.clientHeight > 0) inizio(); }).observe($("mappa"));
    mappa.once("dragstart", () => { mosso = true; });
    $("mappa").addEventListener("wheel", () => { mosso = true; }, { once: true, passive: true });
    $("mappa").addEventListener("touchstart", () => { mosso = true; }, { once: true, passive: true });
  }

  window.QuiSki = { get piste() { return piste; }, get impianti() { return impianti; }, get locali() { return locali; }, get indice() { return indice; } };
  avvia();
})();
