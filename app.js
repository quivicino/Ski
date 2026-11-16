/* Qui-Ski – simulazione per il comprensorio di Pila.
   Legge dati/pila.json (scritto da osm_ski.py, formato di una risposta di Overpass) e mostra piste,
   impianti, stazioni, bar e ristoranti. Se il GPS è lontano da Pila (o non c'è), simula una posizione
   alla stazione di Pila, così l'app si può provare da casa. */
(function () {
  "use strict";

  const VERSIONE = "0.1 · simulazione Pila";
  const DATI = "dati/pila.json";
  const POSIZIONE_FINTA = { lat: 45.6879, lon: 7.3114, nome: "Pila, stazione delle cabinovie" };
  const LONTANO_M = 15000; // oltre questa distanza da Pila si usa la posizione simulata

  const DIFF = {
    novice: { nome: "Verde", lungo: "Campo scuola", colore: "--p-novice" },
    easy: { nome: "Blu", lungo: "Facile", colore: "--p-easy" },
    intermediate: { nome: "Rossa", lungo: "Media", colore: "--p-intermediate" },
    advanced: { nome: "Nera", lungo: "Difficile", colore: "--p-advanced" },
    expert: { nome: "Nera", lungo: "Molto difficile", colore: "--p-advanced" },
    freeride: { nome: "Freeride", lungo: "Fuoripista", colore: "--p-freeride" },
    nd: { nome: "Collegamento", lungo: "Collegamento", colore: "--p-nd" },
  };
  const ORDINE_DIFF = ["novice", "easy", "intermediate", "advanced", "nd"];
  const IMPIANTI = {
    cable_car: "Funivia", gondola: "Cabinovia", mixed_lift: "Impianto misto", chair_lift: "Seggiovia",
    drag_lift: "Skilift", "t-bar": "Skilift ad ancora", "j-bar": "Skilift a gancio", platter: "Skilift a piattello",
    rope_tow: "Manovia", magic_carpet: "Tappeto", zip_line: "Zip line", goods: "Teleferica merci",
  };
  const LOCALI = { restaurant: "Ristorante", bar: "Bar", cafe: "Caffè", fast_food: "Fast food", pub: "Pub" };
  const BATTITURA = { classic: "battuta", "classic+skating": "battuta (anche skating)", skating: "skating", mogul: "a gobbe", backcountry: "non battuta", scooter: "battuta col gatto piccolo" };

  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let mappa, sfondi = {}, sfondo, livelli = {}, evidenza = null, marcaIo = null;
  let piste = [], impianti = [], stazioni = [], locali = [], comprensorio = null;
  let io = null, simulata = false, mosso = false;
  const mostra = { novice: true, easy: true, intermediate: true, advanced: true, nd: true, impianti: true, stazioni: true, locali: true, comprensorio: true };
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
    for (const q of g) best = Math.min(best, distanza(p, q));
    return best;
  }
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`);
  const fmtKm = (m) => (m / 1000).toFixed(1).replace(".", ",");

  /* ---------- dati ---------- */
  function prepara(json) {
    const el = json.elements || [];
    const gruppi = new Map();
    for (const e of el) {
      const t = e.tags || {};
      const g = e.geometry || null;
      if (t["piste:type"] && g) {
        if (t["piste:type"] === "ice_skate") continue;
        let d = t["piste:difficulty"] || "nd";
        if (t["piste:type"] === "connection" || !DIFF[d]) d = "nd";
        const chiave = t.name ? `${t.name}|${d}` : `#${e.id}`;
        if (!gruppi.has(chiave)) {
          gruppi.set(chiave, { tipo: "pista", id: "p" + e.id, nome: t.name || "", ref: t.ref || "", diff: d, tratti: [], tags: t });
        }
        const p = gruppi.get(chiave);
        p.tratti.push(g);
        if (!p.ref && t.ref) p.ref = t.ref;
      } else if (t.aerialway && t.aerialway !== "station" && g) {
        impianti.push({ tipo: "impianto", id: "i" + e.id, nome: t.name || IMPIANTI[t.aerialway] || "Impianto", tags: t, tratti: [g] });
      } else if (t.aerialway === "station") {
        stazioni.push({ tipo: "stazione", id: "s" + e.id, nome: t.name || "Stazione", tags: t, punto: puntoDi(e) });
      } else if (LOCALI[t.amenity] || t.tourism === "alpine_hut") {
        locali.push({ tipo: "locale", id: "l" + e.id, nome: t.name || LOCALI[t.amenity] || "Rifugio", tags: t, punto: puntoDi(e) });
      } else if (t.landuse === "winter_sports" && g) {
        comprensorio = { nome: t.name || "Comprensorio", geometria: g };
      }
    }
    piste = [...gruppi.values()];
    for (const p of piste) {
      p.metri = p.tratti.reduce((s, g) => s + lunghezza(g), 0);
      p.punti = p.tratti.flat();
      if (!p.nome) p.nome = p.diff === "nd" ? "Collegamento" : `Pista ${DIFF[p.diff].nome.toLowerCase()} senza nome`;
    }
    for (const i of impianti) {
      const g = i.tratti[0];
      i.metri = lunghezza(g);
      i.punti = g;
      i.valle = g[0];
      i.monte = g[g.length - 1];
    }
    for (const l of locali) l.punti = [l.punto];
  }
  function puntoDi(e) {
    if (e.type === "node") return { lat: e.lat, lon: e.lon };
    if (e.center) return { lat: e.center.lat, lon: e.center.lon };
    return e.geometry[0];
  }

  /* ---------- mappa ---------- */
  function creaMappa() {
    mappa = L.map("mappa", { zoomControl: false, attributionControl: true }).setView([45.71, 7.31], 13);
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
    mappa.on("click", () => { mappa.closePopup(); togliEvidenza(); });
    mappa.on("zoomend", aggiornaEtichette);
  }
  function cambiaSfondo(n) {
    if (sfondo) mappa.removeLayer(sfondo);
    sfondo = sfondi[n].addTo(mappa);
    sfondo.bringToBack();
    $("mappa").classList.toggle("satellite", n === "satellite");
  }

  const ll = (g) => g.map((p) => [p.lat, p.lon]);

  function disegna() {
    for (const k in livelli) mappa.removeLayer(livelli[k]);
    livelli = {};
    for (const d of ORDINE_DIFF) livelli[d] = L.layerGroup();
    livelli.impianti = L.layerGroup();
    livelli.etichette = L.layerGroup();
    livelli.stazioni = L.layerGroup();
    livelli.locali = L.layerGroup();
    livelli.comprensorio = L.layerGroup();

    if (comprensorio) {
      L.polygon(ll(comprensorio.geometria), { color: css("--blu"), weight: 1.5, dashArray: "5 5", fillOpacity: 0.05, interactive: false })
        .addTo(livelli.comprensorio);
    }
    for (const p of piste) {
      const colore = css(DIFF[p.diff].colore);
      for (const g of p.tratti) {
        // bordo bianco sotto, così le piste si leggono sulla mappa topografica
        L.polyline(ll(g), { color: "#fff", weight: 7, opacity: 0.8, interactive: false }).addTo(livelli[p.diff]);
        const linea = L.polyline(ll(g), { color: colore, weight: 4, dashArray: p.diff === "nd" ? "6 6" : null });
        linea.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(p, ev.latlng); });
        linea.addTo(livelli[p.diff]);
      }
      if (p.ref && p.diff !== "nd") {
        const g = p.tratti[0], q = g[Math.floor(g.length / 2)];
        const m = L.marker([q.lat, q.lon], {
          icon: L.divIcon({ className: "", html: `<span class="num-pista" style="background:${colore}">${esc(p.ref)}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        });
        m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(p, ev.latlng); });
        m.addTo(livelli.etichette);
      }
    }
    for (const i of impianti) {
      const g = ll(i.tratti[0]);
      L.polyline(g, { color: "#fff", weight: 6, opacity: 0.85, interactive: false }).addTo(livelli.impianti);
      const linea = L.polyline(g, { color: css("--impianto"), weight: 3 });
      linea.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(i, ev.latlng); });
      linea.addTo(livelli.impianti);
      // tacche trasversali come sulle cartine degli impianti
      L.polyline(g, { color: css("--impianto"), weight: 9, dashArray: "2 22", interactive: false }).addTo(livelli.impianti);
      const meta = i.tratti[0][Math.floor(i.tratti[0].length / 2)];
      L.marker([meta.lat, meta.lon], {
        icon: L.divIcon({ className: "etichetta-impianto", html: `<span>${esc(i.nome)}</span>`, iconSize: [0, 0] }), interactive: false,
      }).addTo(livelli.etichette);
    }
    for (const s of stazioni) {
      const m = L.marker([s.punto.lat, s.punto.lon], { icon: L.divIcon({ className: "", html: '<span class="mk stazione"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }) });
      m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(s, ev.latlng); });
      m.addTo(livelli.stazioni);
    }
    for (const l of locali) {
      const cls = l.tags.tourism === "alpine_hut" ? "rifugio" : "locale";
      const m = L.marker([l.punto.lat, l.punto.lon], {
        icon: L.divIcon({ className: "", html: `<span class="mk ${cls}">${iconaLocale()}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      });
      m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); scegli(l, ev.latlng); });
      m.addTo(livelli.locali);
    }
    applicaVisibilita();
  }
  const iconaLocale = () => '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 2v8M5 2v5a2 2 0 0 0 4 0V2M7 10v12M16.5 22V2c-2.5 1-3.5 4-3.5 8h3.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function applicaVisibilita() {
    for (const k of [...ORDINE_DIFF, "impianti", "stazioni", "locali", "comprensorio"]) {
      if (mostra[k]) livelli[k].addTo(mappa); else mappa.removeLayer(livelli[k]);
    }
    aggiornaEtichette();
  }
  function aggiornaEtichette() {
    if (!livelli.etichette) return;
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
        L.polyline(ll(g), { color: "#ffc400", weight: 13, opacity: 0.75, interactive: false }).addTo(evidenza);
        L.polyline(ll(g), { color: coloreDi(o), weight: 5, interactive: false }).addTo(evidenza);
      }
    } else {
      L.circleMarker([o.punto.lat, o.punto.lon], { radius: 20, color: "#ffc400", weight: 4, fillOpacity: 0.15, interactive: false }).addTo(evidenza);
    }
    evidenza.addTo(mappa);
  }
  function inquadra(o) {
    if (o.tratti) mappa.fitBounds(L.latLngBounds(o.tratti.flatMap(ll)), { padding: [60, 60], maxZoom: 16 });
    else mappa.setView([o.punto.lat, o.punto.lon], Math.max(mappa.getZoom(), 16));
  }
  function sottotitolo(o) {
    if (o.tipo === "pista") return `${o.diff === "nd" ? "Collegamento" : "Pista " + DIFF[o.diff].nome.toLowerCase()}${o.ref ? " n. " + esc(o.ref) : ""} · ${fmtDist(o.metri)}`;
    if (o.tipo === "impianto") return `${IMPIANTI[o.tags.aerialway] || "Impianto"} · ${fmtDist(o.metri)}`;
    if (o.tipo === "stazione") return "Stazione di impianto";
    return o.tags.tourism === "alpine_hut" ? "Rifugio" : LOCALI[o.tags.amenity] || "Locale";
  }
  function scegli(o, dove) {
    evidenzia(o);
    const html = `<div class="fumetto"><b>${esc(o.nome)}</b><small>${sottotitolo(o)}</small>${o.tipo === "stazione" ? "" : '<span class="apri">Apri la scheda ›</span>'}</div>`;
    const pop = L.popup({ closeButton: false, offset: [0, -6] }).setLatLng(dove || (o.punto ? [o.punto.lat, o.punto.lon] : [o.punti[0].lat, o.punti[0].lon])).setContent(html).openOn(mappa);
    const el = pop.getElement();
    if (el && o.tipo !== "stazione") el.querySelector(".fumetto").addEventListener("click", () => apriScheda(o));
  }

  function riga(dt, dd) { return dd === undefined || dd === null || dd === "" ? "" : `<dt>${dt}</dt><dd>${dd}</dd>`; }
  function apriScheda(o) {
    mappa.closePopup();
    evidenzia(o);
    inquadra(o);
    $("scheda-titolo").textContent = o.nome;
    const t = o.tags, c = $("scheda-contenuto");
    let h = "";
    const dist = io ? fmtDist(piuVicino(io, o.punti)) : "";
    if (o.tipo === "pista") {
      const D = DIFF[o.diff];
      h += `<div class="s-testa"><span class="s-badge" style="background:${coloreDi(o)}">${D.nome}${o.ref ? " " + esc(o.ref) : ""}</span><span class="s-sotto">${D.lungo}</span></div>`;
      h += `<div class="s-griglia"><div class="kpi kpi-blu"><b>${fmtKm(o.metri)} km</b><span>lunghezza</span></div><div class="kpi"><b>${dist || "–"}</b><span>da te${simulata ? " (simulato)" : ""}</span></div></div>`;
      h += `<dl class="s-righe">${riga("Numero", esc(o.ref))}${riga("Battitura", esc(BATTITURA[t["piste:grooming"]] || t["piste:grooming"]))}${riga("Illuminata", t.lit === "yes" ? "sì" : t.lit === "no" ? "no" : "")}${riga("Tratti sulla mappa", o.tratti.length > 1 ? o.tratti.length : "")}</dl>`;
      const vicini = impianti.map((i) => ({ i, d: Math.min(distanza(o.punti[0], i.monte), distanza(o.punti[0], i.valle)) })).sort((a, b) => a.d - b.d).slice(0, 2);
      if (vicini.length) {
        h += `<h3 class="s-titoletto">Impianti vicino alla partenza</h3><ol class="lista">${vicini.map(({ i, d }) => voce(i, d)).join("")}</ol>`;
      }
      h += localiVicini(o);
    } else if (o.tipo === "impianto") {
      const tempo = t["aerialway:duration"] ? `${String(t["aerialway:duration"]).replace(".", ",")} min` : "–";
      h += `<div class="s-testa"><span class="s-badge" style="background:${css("--impianto")}">${IMPIANTI[t.aerialway] || "Impianto"}</span></div>`;
      h += `<div class="s-griglia"><div class="kpi kpi-blu"><b>${fmtDist(o.metri)}</b><span>lunghezza</span></div><div class="kpi"><b>${tempo}</b><span>durata della corsa</span></div>
        <div class="kpi"><b>${t["aerialway:capacity"] ? Number(t["aerialway:capacity"]).toLocaleString("it-IT") : "–"}</b><span>persone all'ora</span></div><div class="kpi"><b>${dist || "–"}</b><span>da te${simulata ? " (simulato)" : ""}</span></div></div>`;
      const posti = t["aerialway:occupancy"];
      h += `<dl class="s-righe">${riga("Posti per veicolo", esc(posti))}${riga("Cupola", t["aerialway:bubble"] === "yes" ? "sì" : t["aerialway:bubble"] === "no" ? "no" : "")}${riga("Sedili riscaldati", t["aerialway:heating"] === "yes" ? "sì" : t["aerialway:heating"] === "no" ? "no" : "")}${riga("Bici", t["aerialway:bicycle"] === "summer" ? "d'estate" : t.bicycle === "yes" ? "sì" : "")}${riga("Note", esc((t.note || "").replace("Costruttore: ", "costruttore ")))}</dl>`;
      const sv = (p) => stazioni.map((s) => ({ s, d: distanza(p, s.punto) })).sort((a, b) => a.d - b.d)[0];
      const a = sv(o.valle), b = sv(o.monte);
      h += `<dl class="s-righe">${riga("Stazione a valle", a && a.d < 300 ? esc(a.s.nome) : "")}${riga("Stazione a monte", b && b.d < 300 ? esc(b.s.nome) : "")}</dl>`;
      const dalMonte = piste.filter((p) => p.diff !== "nd" && piuVicino(o.monte, p.punti) < 150).sort((x, y) => ORDINE_DIFF.indexOf(x.diff) - ORDINE_DIFF.indexOf(y.diff));
      if (dalMonte.length) h += `<h3 class="s-titoletto">Piste dall'arrivo</h3><ol class="lista">${dalMonte.slice(0, 8).map((p) => voce(p)).join("")}</ol>`;
    } else {
      h += `<div class="s-testa"><span class="s-badge" style="background:${css("--locale")}">${esc(sottotitolo(o))}</span></div>`;
      h += `<div class="s-griglia"><div class="kpi"><b>${dist || "–"}</b><span>da te${simulata ? " (simulato)" : ""}</span></div><div class="kpi"><b>${t.ele ? esc(t.ele) + " m" : "–"}</b><span>quota</span></div></div>`;
      h += `<dl class="s-righe">${riga("Orari", esc(t.opening_hours))}${riga("Cucina", esc(t.cuisine))}${riga("Telefono", t.phone ? `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>` : "")}${riga("Sito", t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener">${esc(t.website.replace(/^https?:\/\//, ""))}</a>` : "")}</dl>`;
      const vicine = piste.filter((p) => p.diff !== "nd").map((p) => ({ p, d: piuVicino(o.punto, p.punti) })).filter((x) => x.d < 300).sort((a, b) => a.d - b.d).slice(0, 5);
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
  function localiVicini(o) {
    const v = locali.map((l) => ({ l, d: piuVicino(l.punto, o.punti) })).filter((x) => x.d < 300).sort((a, b) => a.d - b.d);
    return v.length ? `<h3 class="s-titoletto">Bar e ristoranti lungo la pista</h3><ol class="lista">${v.map(({ l, d }) => voce(l, d)).join("")}</ol>` : "";
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
  function elenco() {
    // nell'elenco niente collegamenti e niente pezzetti senza nome (restano sulla mappa)
    let lista = sezione === "piste" ? piste.filter((p) => mostra[p.diff] && p.diff !== "nd" && (p.tags.name || p.metri >= 200)) : sezione === "impianti" ? impianti : locali;
    const q = $("cerca").value.trim().toLowerCase();
    if (q) lista = lista.filter((o) => o.nome.toLowerCase().includes(q) || (o.ref || "").toLowerCase() === q);
    const d = (o) => (io ? piuVicino(io, o.punti) : 0);
    lista = [...lista].sort(ordine === "nome" ? (a, b) => a.nome.localeCompare(b.nome, "it") : (a, b) => d(a) - d(b));
    $("lista").innerHTML = lista.length ? lista.map((o) => voce(o)).join("") : '<li class="vuoto">Niente da mostrare con queste scelte.</li>';
    $("lista").querySelectorAll(".voce").forEach((li) => li.addEventListener("click", () => apriScheda(trova(li.dataset.id))));
  }
  function apriElenco() {
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

  /* ---------- menu Cosa mostrare ---------- */
  function menu() {
    const voceMenu = (k, testo, segno) => `<label class="cat-voce"><input type="checkbox" data-k="${k}" ${mostra[k] ? "checked" : ""}>${segno}<span>${testo}</span></label>`;
    $("cat-piste").innerHTML = ORDINE_DIFF.map((d) => voceMenu(d, d === "nd" ? "Collegamenti" : `${DIFF[d].nome} <small>(${DIFF[d].lungo.toLowerCase()})</small>`, `<span class="riga-colore" style="background:${css(DIFF[d].colore)}"></span>`)).join("");
    $("cat-voci").innerHTML = [
      voceMenu("impianti", "Impianti di risalita", `<span class="riga-colore" style="background:${css("--impianto")}"></span>`),
      voceMenu("stazioni", "Stazioni", '<span class="mk stazione" style="margin:0 6px"></span>'),
      voceMenu("locali", "Bar e ristoranti", `<span class="mk locale" style="width:26px;height:26px">${iconaLocale()}</span>`),
      voceMenu("comprensorio", "Confine del comprensorio", `<span class="riga-colore" style="background:none;border-top:2px dashed ${css("--blu")}"></span>`),
    ].join("");
    document.querySelectorAll("#cat-menu input").forEach((inp) => inp.addEventListener("change", () => {
      mostra[inp.dataset.k] = inp.checked;
      applicaVisibilita();
      testoCategoria();
    }));
  }
  function testoCategoria() {
    const n = ORDINE_DIFF.filter((d) => mostra[d]).length;
    $("categoria-testo").textContent = n === ORDINE_DIFF.length ? "Tutte le piste" : n === 0 ? "Nessuna pista" : `${n} difficoltà`;
  }

  /* ---------- posizione ---------- */
  function mettiIo(p) {
    io = p;
    if (marcaIo) marcaIo.setLatLng([p.lat, p.lon]);
    else marcaIo = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: '<span class="io"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000, interactive: false }).addTo(mappa);
    $("simula").hidden = !simulata;
    $("stato").textContent = simulata ? `Posizione simulata: ${POSIZIONE_FINTA.nome}.` : "Posizione dal GPS.";
  }
  function usaFinta() {
    simulata = true;
    mettiIo(POSIZIONE_FINTA);
  }
  function cercaGps(centra) {
    if (!navigator.geolocation) { usaFinta(); if (centra) mappa.setView([io.lat, io.lon], 15); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (distanza(p, POSIZIONE_FINTA) > LONTANO_M) usaFinta();
      else { simulata = false; mettiIo(p); }
      if (centra) mappa.setView([io.lat, io.lon], 15);
    }, () => { usaFinta(); if (centra) mappa.setView([io.lat, io.lon], 15); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  }
  function piuVicinoA(lista, punto) {
    let best = null, bd = Infinity;
    for (const o of lista) {
      const d = punto ? piuVicino(io, [punto(o)]) : piuVicino(io, o.punti);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /* ---------- avvio ---------- */
  function collega() {
    $("btn-elenco").addEventListener("click", apriElenco);
    $("btn-chiudi").addEventListener("click", chiudiTutto);
    $("btn-chiudi-scheda").addEventListener("click", chiudiTutto);
    $("btn-centra").addEventListener("click", () => cercaGps(true));
    $("btn-comprensorio").addEventListener("click", inquadraTutto);
    $("btn-impianto").addEventListener("click", () => {
      if (!io) usaFinta();
      const i = piuVicinoA(impianti, (o) => o.valle); // si sale dalla stazione a valle
      if (i) { evidenzia(i); inquadra(i); scegli(i, [i.valle.lat, i.valle.lon]); }
    });
    $("btn-locale").addEventListener("click", () => {
      if (!io) usaFinta();
      const l = piuVicinoA(locali);
      if (l) { evidenzia(l); mappa.setView([l.punto.lat, l.punto.lon], 16); scegli(l); }
    });
    $("sfondo").addEventListener("change", (e) => cambiaSfondo(e.target.value));
    document.querySelectorAll(".chip.sezione").forEach((b) => b.addEventListener("click", () => {
      sezione = b.dataset.sezione;
      document.querySelectorAll(".chip.sezione").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      elenco();
    }));
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
      if (!q) return;
      const o = tutti().find((x) => x.tipo !== "stazione" && (x.nome.toLowerCase().includes(q) || (x.ref || "").toLowerCase() === q));
      $("cerca").blur();
      if (o) apriScheda(o); else { sezione = "piste"; apriElenco(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiTutto(); });
  }
  function inquadraTutto() {
    const g = comprensorio ? ll(comprensorio.geometria) : tutti().flatMap((o) => ll(o.punti));
    const b = L.latLngBounds(g);
    for (const p of piste) b.extend(L.latLngBounds(p.tratti.flatMap(ll)));
    for (const i of impianti) b.extend(L.latLngBounds(ll(i.punti)));
    mappa.fitBounds(b, { padding: [20, 20] });
  }

  async function avvia() {
    creaMappa();
    collega();
    $("versione").textContent = "Qui-Ski " + VERSIONE;
    try {
      const r = await fetch(DATI, { cache: "no-cache" });
      const json = await r.json();
      prepara(json);
      const base = json.osm3s && json.osm3s.timestamp_osm_base;
      if (base) $("data-osm").textContent = new Date(base).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      $("stato").textContent = "Non riesco a leggere i dati di Pila.";
      $("stato").classList.add("errore");
      console.error(e);
      return;
    }
    menu();
    testoCategoria();
    disegna();
    mappa.invalidateSize();
    inquadraTutto();
    // se la pagina si apre in una scheda nascosta la mappa parte con dimensione zero: reinquadra quando compare
    const ro = new ResizeObserver(() => {
      const el = $("mappa");
      if (el.clientWidth > 0 && el.clientHeight > 0 && !mosso) { mappa.invalidateSize(); inquadraTutto(); }
    });
    ro.observe($("mappa"));
    mappa.once("dragstart", () => { mosso = true; });
    $("mappa").addEventListener("wheel", () => { mosso = true; }, { once: true, passive: true });
    $("mappa").addEventListener("touchstart", () => { mosso = true; }, { once: true, passive: true });
    $("k-km").textContent = fmtKm(piste.filter((p) => p.diff !== "nd").reduce((s, p) => s + p.metri, 0));
    $("k-imp").textContent = impianti.length;
    $("k-loc").textContent = locali.length;
    cercaGps(false);
  }

  window.QuiSki = { get piste() { return piste; }, get impianti() { return impianti; }, get locali() { return locali; } };
  avvia();
})();
