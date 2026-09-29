/* TassieWalks – dog-friendly walks map
 * Data: data/walks.csv + data/route.csv (editable).
 * Map engine: Google Maps JS API when a key is set in js/config.js,
 * otherwise Leaflet + OpenStreetMap.
 */
(() => {
  "use strict";

  const CFG = Object.assign({
    GOOGLE_MAPS_API_KEY: "",
    GOOGLE_MAP_ID: "DEMO_MAP_ID",
    WALKS_CSV: "data/walks.csv",
    ROUTE_CSV: "data/route.csv",
    LIVE_DIRECTIONS: true,
  }, window.TASSIE_CONFIG || {});

  const RULES = {
    "Off lead": { color: "#2e8b57", glyph: "✓", label: "Off lead" },
    "Dog park": { color: "#7b4fb3", glyph: "P", label: "Dog park" },
    "Pub": { color: "#9a5b13", glyph: "🍺", label: "Historic pub" },
    "Lake": { color: "#12869c", glyph: "≈", label: "Lake" },
    "On lead":  { color: "#2f6fb5", glyph: "L", label: "On lead" },
    "Check":    { color: "#d0891a", glyph: "?", label: "Check signage" },
    "No dogs":  { color: "#c0392b", glyph: "✕", label: "No dogs" },
  };
  const TAS_CENTER = { lat: -41.75, lng: 146.6 };

  const state = {
    walks: [], route: [],
    rawWalks: null, walksFields: null, rawRoute: null, routeFields: null,
    bases: [], amenFilter: new Set(), baseFilter: new Set(), ruleFilter: new Set(), originFilter: new Set(), maxDist: Infinity, q: "",
    me: null, selected: null, engine: null, handles: new Map(),
    liveLegs: null, showRoute: true,
  };

  // ───────────────────────── helpers ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
  const fmtKm = (n) => (n == null ? "—" : `${Math.round(n).toLocaleString()} km`);
  const fmtHrs = (h) => { if (h == null) return "—"; const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`; };
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function normRule(r) {
    const s = String(r || "").toLowerCase();
    if (/no\s*dog|prohibit|not allowed|banned/.test(s)) return "No dogs";
    if (/dog\s*park|fenced/.test(s)) return "Dog park";
    if (/\bpub\b|hotel|tavern|inn\b/.test(s)) return "Pub";
    if (/lake|lagoon/.test(s)) return "Lake";
    if (/off/.test(s)) return "Off lead";
    if (/check|unknown|\?/.test(s)) return "Check";
    if (/lead|leash|on/.test(s)) return "On lead";
    return "Check";
  }

  let toastTimer;
  function toast(msg, ms = 4000) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // Lake amenities: a value counts as "yes" unless blank / No / Check / Unknown.
  const AMEN = [["camping", "🏕", "Camping"], ["fires", "🔥", "Campfires"], ["fishing", "🎣", "Fishing"], ["dogSwim", "🐕", "Dog swim"]];
  const isYes = (v) => !!v && !/^(no|check|unknown|\?)/i.test(String(v).trim());

  const gmapsDir = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  // Exact AllTrails page from the CSV, else a site search for the walk name.
  const allTrailsUrl = (w) => w.alltrails ||
    `https://www.google.com/search?q=${encodeURIComponent(`site:alltrails.com ${w.name.replace(/\s*\(.*?\)\s*/g, " ").trim()} Tasmania`)}`;
  const gmapsPlace = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  // ───────────────────────── CSV ─────────────────────────
  function parseCsv(text) {
    const res = Papa.parse(text.replace(/^﻿/, ""), {
      header: true, skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    });
    return { rows: res.data, fields: res.meta.fields || [] };
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} – ${url}`);
    return r.text();
  }

  function setWalks(text) {
    const { rows, fields } = parseCsv(text);
    let skipped = 0;
    const walks = [];
    rows.forEach((row, i) => {
      const lat = num(row.lat ?? row.latitude), lng = num(row.lng ?? row.lon ?? row.long ?? row.longitude);
      if (lat == null || lng == null || !row.name) { skipped++; return; }
      walks.push({
        id: String(row.id || i + 1),
        base: (row.base || "Other").trim(),
        name: row.name.trim(),
        type: row.type || "",
        length: row.length_time || row.length || "",
        difficulty: row.difficulty || "",
        rule: normRule(row.dog_rule || row.dogs),
        ruleRaw: row.dog_rule || "",
        features: row.features || "",
        distBase: num(row.dist_from_base_km),
        detour: num(row.detour_km),
        notes: row.notes || "",
        lat, lng,
        source: safeUrl(row.source),
        alltrails: safeUrl(row.alltrails_url || row.alltrails),
        origin: /alltrails/i.test(row.origin || "") ? "alltrails" : "curated",
        camping: row.camping || "", fires: row.fires || "", fishing: row.fishing || "", dogSwim: row.dog_swim || "",
        rating: num(row.rating),
      });
    });
    state.walks = walks;
    state.rawWalks = rows; state.walksFields = fields;
    state.bases = [...new Set(walks.map((w) => w.base))];
    state.baseFilter = new Set([...state.baseFilter].filter((b) => state.bases.includes(b)));
    if (skipped) toast(`Loaded ${walks.length} walks – skipped ${skipped} row(s) missing name/lat/lng.`);
  }

  function setRoute(text) {
    const { rows, fields } = parseCsv(text);
    const stops = rows
      .map((r, i) => ({
        order: num(r.order) ?? i + 1,
        name: (r.name || "").trim(),
        lat: num(r.lat ?? r.latitude), lng: num(r.lng ?? r.lon ?? r.longitude),
        km: num(r.leg_km), hrs: num(r.leg_hrs), notes: r.notes || "",
      }))
      .filter((s) => s.name && s.lat != null && s.lng != null)
      .sort((a, b) => a.order - b.order);
    state.route = stops;
    state.rawRoute = rows; state.routeFields = fields;
  }

  // ───────────────────────── Road routing (OpenStreetMap / OSRM) ─────────────────────────
  // Used when Google Directions isn't available (no key, or legacy API not enabled).
  // Free public OSRM servers, called from the visitor's browser; the result is cached per browser.
  const OSRM_SERVERS = [
    "https://router.project-osrm.org/route/v1/driving/",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
  ];
  async function roadRoute(stops) {
    const coords = stops.map((s) => `${s.lng.toFixed(5)},${s.lat.toFixed(5)}`).join(";");
    const cacheKey = "tassiewalks:osrm:" + coords;
    try { const c = localStorage.getItem(cacheKey); if (c) return JSON.parse(c); } catch (_) {}
    for (const base of OSRM_SERVERS) {
      try {
        const r = await fetch(`${base}${coords}?overview=full&geometries=geojson&continue_straight=false`);
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        const rt = j.routes?.[0];
        if (j.code !== "Ok" || !rt) throw new Error(j.code || "no route");
        const out = {
          path: rt.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
          legs: rt.legs.map((l) => ({ km: l.distance / 1000, hrs: l.duration / 3600 })),
          source: "OpenStreetMap",
        };
        try { localStorage.setItem(cacheKey, JSON.stringify(out)); } catch (_) {}
        return out;
      } catch (e) { console.warn("Routing server failed:", base, e); }
    }
    return null;
  }
  let routeSeq = 0;

  // ───────────────────────── Google engine ─────────────────────────
  function loadGoogleBootstrap(key) {
    // Official dynamic library import bootstrap (developers.google.com/maps/documentation/javascript/load-maps-js-api)
    /* eslint-disable */
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key, v: "weekly" });
    /* eslint-enable */
  }

  async function googleEngine(el) {
    if (!window.google?.maps?.importLibrary) loadGoogleBootstrap(CFG.GOOGLE_MAPS_API_KEY);
    const { Map, InfoWindow, Polyline } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

    const map = new Map(el, {
      center: TAS_CENTER, zoom: 7,
      mapId: CFG.GOOGLE_MAP_ID || "DEMO_MAP_ID",
      gestureHandling: "greedy",
      streetViewControl: false,
      mapTypeControl: true,
      fullscreenControl: true,
    });
    const iw = new InfoWindow({ maxWidth: 330 });
    let markers = [], routeObjs = [], meMarker = null;

    function divEl(cls, text) { const d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; return d; }

    return {
      name: "Google Maps",
      addMarker(w, onClick) {
        const r = RULES[w.rule];
        const pin = new PinElement({ background: r.color, borderColor: "#ffffff", glyphColor: "#ffffff", glyph: r.glyph, scale: 1 });
        const m = new AdvancedMarkerElement({ map, position: { lat: w.lat, lng: w.lng }, title: w.name, content: pin.element, zIndex: 10 });
        m.addListener("click", () => onClick(w));
        markers.push(m);
        return {
          setVisible: (v) => { m.map = v ? map : null; },
          setSelected: (s) => { pin.scale = s ? 1.4 : 1; m.zIndex = s ? 100 : 10; },
        };
      },
      clearMarkers() { markers.forEach((m) => (m.map = null)); markers = []; iw.close(); },
      openInfo(w, html) { iw.setContent(html); iw.setPosition({ lat: w.lat, lng: w.lng }); iw.setOptions({ pixelOffset: new google.maps.Size(0, -38) }); iw.open({ map }); },
      closeInfo() { iw.close(); },
      panTo(w) { map.panTo({ lat: w.lat, lng: w.lng }); if (map.getZoom() < 11) map.setZoom(11); },
      fit(points) {
        if (!points.length) return;
        if (points.length === 1) { map.setCenter(points[0]); map.setZoom(12); return; }
        const b = new google.maps.LatLngBounds();
        points.forEach((p) => b.extend(p));
        map.fitBounds(b, 40);
      },
      async drawRoute(stops) {
        this.clearRoute();
        if (stops.length < 2) return null;
        const seq = ++routeSeq;
        stops.forEach((s, i) => {
          const m = new AdvancedMarkerElement({ map, position: { lat: s.lat, lng: s.lng }, title: s.name, content: divEl("stop-pin", String(i + 1)), zIndex: 5 });
          m.addListener("click", () => { iw.setContent(stopHtml(s, i)); iw.setPosition({ lat: s.lat, lng: s.lng }); iw.setOptions({ pixelOffset: new google.maps.Size(0, -14) }); iw.open({ map }); });
          routeObjs.push({ remove: () => (m.map = null) });
        });
        if (CFG.LIVE_DIRECTIONS) {
          try {
            const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");
            const res = await new DirectionsService().route({
              origin: stops[0], destination: stops[stops.length - 1],
              waypoints: stops.slice(1, -1).map((s) => ({ location: { lat: s.lat, lng: s.lng }, stopover: true })),
              travelMode: google.maps.TravelMode.DRIVING,
            });
            if (seq !== routeSeq) return undefined; // superseded by a newer draw
            const dr = new DirectionsRenderer({ map, directions: res, suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: "#2f5d50", strokeOpacity: 0.75, strokeWeight: 5 } });
            routeObjs.push({ remove: () => dr.setMap(null) });
            return { legs: res.routes[0].legs.map((l) => ({ km: l.distance.value / 1000, hrs: l.duration.value / 3600 })), source: "Google" };
          } catch (e) {
            console.warn("Google Directions unavailable, trying OpenStreetMap routing:", e);
          }
        }
        const rr = await roadRoute(stops);
        if (seq !== routeSeq) return undefined; // superseded by a newer draw
        if (rr) {
          const road = new Polyline({ map, path: rr.path, strokeColor: "#2f5d50", strokeOpacity: 0.75, strokeWeight: 5 });
          routeObjs.push({ remove: () => road.setMap(null) });
          return rr;
        }
        const line = new Polyline({
          map, path: stops.map((s) => ({ lat: s.lat, lng: s.lng })), strokeOpacity: 0,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#2f5d50", scale: 3 }, offset: "0", repeat: "14px" }],
        });
        routeObjs.push({ remove: () => line.setMap(null) });
        return null;
      },
      clearRoute() { routeObjs.forEach((o) => o.remove()); routeObjs = []; },
      setMe(p) {
        if (meMarker) meMarker.map = null;
        meMarker = p ? new AdvancedMarkerElement({ map, position: p, title: "You are here", content: divEl("me-dot"), zIndex: 200 }) : null;
      },
      onContext(cb) { map.addListener("contextmenu", (e) => cb(e.latLng.lat(), e.latLng.lng())); },
      resize() {},
    };
  }

  // ───────────────────────── Leaflet engine ─────────────────────────
  function leafletEngine(el) {
    const map = L.map(el, { zoomControl: true, tap: true }).setView([TAS_CENTER.lat, TAS_CENTER.lng], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const markerLayer = L.layerGroup().addTo(map);
    const routeLayer = L.layerGroup().addTo(map);
    let meLayer = null;

    return {
      name: "OpenStreetMap (Leaflet)",
      addMarker(w, onClick) {
        const r = RULES[w.rule];
        const m = L.circleMarker([w.lat, w.lng], { radius: 8, color: "#ffffff", weight: 2, fillColor: r.color, fillOpacity: 1 })
          .bindTooltip(w.name, { direction: "top", offset: [0, -8] })
          .on("click", () => onClick(w));
        markerLayer.addLayer(m);
        return {
          setVisible: (v) => (v ? markerLayer.addLayer(m) : markerLayer.removeLayer(m)),
          setSelected: (s) => { m.setRadius(s ? 12 : 8); if (s) m.bringToFront(); },
        };
      },
      clearMarkers() { markerLayer.clearLayers(); map.closePopup(); },
      openInfo(w, html) { L.popup({ maxWidth: 330, offset: [0, -6] }).setLatLng([w.lat, w.lng]).setContent(html).openOn(map); },
      closeInfo() { map.closePopup(); },
      panTo(w) { map.setView([w.lat, w.lng], Math.max(map.getZoom(), 11)); },
      fit(points) {
        if (!points.length) return;
        if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 12); return; }
        map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40] });
      },
      async drawRoute(stops) {
        routeLayer.clearLayers();
        if (stops.length < 2) return null;
        const seq = ++routeSeq;
        stops.forEach((s, i) => {
          L.marker([s.lat, s.lng], { icon: L.divIcon({ className: "", html: `<div class="stop-pin">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: -100 })
            .bindPopup(stopHtml(s, i)).addTo(routeLayer);
        });
        const rr = CFG.LIVE_DIRECTIONS ? await roadRoute(stops) : null;
        if (seq !== routeSeq) return undefined; // superseded by a newer draw
        if (rr) {
          L.polyline(rr.path.map((p) => [p.lat, p.lng]), { color: "#2f5d50", weight: 5, opacity: 0.75 }).addTo(routeLayer);
          return rr;
        }
        L.polyline(stops.map((s) => [s.lat, s.lng]), { color: "#2f5d50", weight: 3, opacity: 0.8, dashArray: "6 8" }).addTo(routeLayer);
        return null;
      },
      clearRoute() { routeLayer.clearLayers(); },
      setMe(p) {
        if (meLayer) map.removeLayer(meLayer);
        meLayer = p ? L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).bindTooltip("You are here").addTo(map) : null;
      },
      onContext(cb) { map.on("contextmenu", (e) => cb(e.latlng.lat, e.latlng.lng)); },
      resize() { setTimeout(() => map.invalidateSize(), 50); },
    };
  }

  // ───────────────────────── rendering ─────────────────────────
  function infoHtml(w) {
    const r = RULES[w.rule];
    const rows = [
      ["Length", w.length], ["Difficulty", w.difficulty], ["AllTrails", w.rating ? `★ ${w.rating}` : ""],
      ...AMEN.map(([k, ic, lab]) => [`${ic} ${lab}`, w[k]]),
      ["From " + w.base.split(" →")[0], w.distBase != null ? fmtKm(w.distBase) : ""],
      ["Detour", w.detour != null ? `${fmtKm(w.detour)} return` : ""],
      ["From you", state.me ? `${fmtKm(haversineKm(state.me, w))} (straight line)` : ""],
    ].filter(([, v]) => v);
    return `<div class="iw">
      <h3>${esc(w.name)}</h3>
      <span class="tag" style="background:${r.color}">${esc(r.label)}</span><span class="tag plain">${esc(w.base)}</span>${w.type && w.type !== r.label ? `<span class="tag plain">${esc(w.type)}</span>` : ""}
      ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
      ${w.features ? `<p>${esc(w.features)}</p>` : ""}
      ${w.notes ? `<p class="notes">${esc(w.notes)}</p>` : ""}
      <div class="links">
        <a href="${gmapsDir(w.lat, w.lng)}" target="_blank" rel="noopener">Directions ↗</a>
        <a href="${gmapsPlace(w.lat, w.lng)}" target="_blank" rel="noopener">Google Maps ↗</a>
        ${w.alltrails || !["Dog park", "Pub", "Lake"].includes(w.rule) ? `<a href="${esc(allTrailsUrl(w))}" target="_blank" rel="noopener">${w.alltrails ? "AllTrails ↗" : "Find on AllTrails ↗"}</a>` : ""}
        ${w.source ? `<a href="${esc(w.source)}" target="_blank" rel="noopener">Source ↗</a>` : ""}
      </div>
    </div>`;
  }

  function stopHtml(s, i) {
    return `<div class="iw"><h3>${i + 1}. ${esc(s.name)}</h3>
      ${i > 0 ? `<p>Leg from ${esc(state.route[i - 1]?.name)}: <b>${fmtKm(s.km)}</b>, ${fmtHrs(s.hrs)}</p>` : ""}
      ${s.notes ? `<p>${esc(s.notes)}</p>` : ""}
      <div class="links"><a href="${gmapsPlace(s.lat, s.lng)}" target="_blank" rel="noopener">Google Maps ↗</a></div></div>`;
  }

  function renderChips() {
    const counts = {};
    state.walks.forEach((w) => (counts[w.rule] = (counts[w.rule] || 0) + 1));
    $("#baseChips").innerHTML =
      `<button class="chip" data-base="" aria-pressed="${state.baseFilter.size === 0}">All areas</button>` +
      state.bases.map((b) => `<button class="chip" data-base="${esc(b)}" aria-pressed="${state.baseFilter.has(b)}">${esc(b)}</button>`).join("");
    $("#ruleChips").innerHTML = Object.entries(RULES)
      .filter(([k]) => counts[k])
      .map(([k, r]) => `<button class="chip" data-rule="${esc(k)}" aria-pressed="${state.ruleFilter.has(k)}"><span class="dot" style="background:${r.color}"></span>${esc(r.label)} <span class="pill">${counts[k]}</span></button>`)
      .join("");
    const oc = { curated: 0, alltrails: 0 };
    state.walks.forEach((w) => oc[w.origin]++);
    $("#originChips").innerHTML = oc.alltrails
      ? [["curated", "Researched list"], ["alltrails", "AllTrails trails"]]
          .map(([k, l]) => `<button class="chip" data-origin="${k}" aria-pressed="${state.originFilter.has(k)}">${l} <span class="pill">${oc[k]}</span></button>`).join("")
      : "";
    const hasAmen = state.walks.some((w) => AMEN.some(([k]) => w[k]));
    $("#amenChips").innerHTML = hasAmen
      ? AMEN.map(([k, ic, lab]) => `<button class="chip" data-amen="${k}" aria-pressed="${state.amenFilter.has(k)}">${ic} ${lab} <span class="pill">${state.walks.filter((w) => isYes(w[k])).length}</span></button>`).join("")
      : "";
    $("#legend").innerHTML = Object.values(RULES).map((r) => `<span><span class="dot" style="background:${r.color}"></span>${esc(r.label)}</span>`).join("") +
      `<span><span class="stop-pin mini">1</span>Trip stop</span>`;
  }

  function isVisible(w) {
    if (state.baseFilter.size && !state.baseFilter.has(w.base)) return false;
    if (state.ruleFilter.size && !state.ruleFilter.has(w.rule)) return false;
    if (state.originFilter.size && !state.originFilter.has(w.origin)) return false;
    for (const k of state.amenFilter) if (!isYes(w[k])) return false;
    if (Number.isFinite(state.maxDist) && w.distBase != null && w.distBase > state.maxDist) return false;
    if (state.q) {
      const hay = `${w.name} ${w.base} ${w.type} ${w.features} ${w.notes} ${w.difficulty} ${w.ruleRaw}`.toLowerCase();
      if (!state.q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  }

  function renderList() {
    const vis = state.walks.filter(isVisible);
    state.walks.forEach((w) => state.handles.get(w.id)?.setVisible(isVisible(w)));
    $("#count").textContent = vis.length;
    const list = $("#list");
    if (!vis.length) { list.innerHTML = `<li class="empty">No walks match these filters.</li>`; return vis; }

    const item = (w) => {
      const r = RULES[w.rule];
      const amen = AMEN.filter(([k]) => isYes(w[k])).map(([, ic, lab]) => `<span title="${lab}">${ic}</span>`).join("");
      const bits = [w.rating ? `★ ${w.rating}` : "", w.length, w.difficulty,
        w.distBase != null && w.distBase > 0 ? `~${fmtKm(w.distBase)} from ${w.base.split(" →")[0]}` : "",
        w.detour != null && w.detour > 0 ? `detour ${fmtKm(w.detour)}` : "",
        state.me ? `${fmtKm(haversineKm(state.me, w))} away` : ""].filter(Boolean);
      return `<li class="item${state.selected === w.id ? " sel" : ""}" data-id="${esc(w.id)}" tabindex="0">
        <span class="dot" style="background:${r.color}" title="${esc(r.label)}"></span>
        <div><h3>${esc(w.name)}</h3><div class="meta">${amen ? `<span class="amen">${amen}</span>` : ""}${bits.map((b) => `<span>${esc(b)}</span>`).join("")}</div>
        ${w.alltrails || !["Dog park", "Pub", "Lake"].includes(w.rule) ? `<a class="at-link" href="${esc(allTrailsUrl(w))}" target="_blank" rel="noopener">${w.alltrails ? "AllTrails ↗" : "Find on AllTrails ↗"}</a>` : ""}</div></li>`;
    };

    if (state.me) {
      const sorted = [...vis].sort((a, b) => haversineKm(state.me, a) - haversineKm(state.me, b));
      list.innerHTML = `<li class="group-head">Nearest to you</li>` + sorted.map(item).join("");
    } else {
      list.innerHTML = state.bases
        .map((b) => { const g = vis.filter((w) => w.base === b); return g.length ? `<li class="group-head">${esc(b)}</li>` + g.map(item).join("") : ""; })
        .join("");
    }
    return vis;
  }

  function renderRoute() {
    const s = state.route;
    if (s.length < 2) { $("#routeInfo").innerHTML = `<div class="route-box"><p class="hint">Add at least two stops to data/route.csv.</p></div>`; return; }
    const liveSrc = state.liveLegs?.source;
    const live = state.liveLegs?.legs;
    let totKm = 0, totHrs = 0, totLive = 0, totLiveH = 0;
    const rows = s.slice(1).map((stop, i) => {
      totKm += stop.km || 0; totHrs += stop.hrs || 0;
      const l = live?.[i]; if (l) { totLive += l.km; totLiveH += l.hrs; }
      return `<tr><td><b>${esc(s[i].name)} → ${esc(stop.name)}</b>${stop.notes ? `<div class="note">${esc(stop.notes)}</div>` : ""}</td>
        <td class="num">${fmtKm(stop.km)}<div class="note">${fmtHrs(stop.hrs)}</div></td>
        ${live ? `<td class="num live">${fmtKm(l?.km)}<div class="note">${fmtHrs(l?.hrs)}</div></td>` : ""}</tr>`;
    }).join("");
    const pts = s.map((x) => `${x.lat},${x.lng}`);
    const tripUrl = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${pts[0]}&destination=${pts[pts.length - 1]}` +
      (pts.length > 2 ? `&waypoints=${encodeURIComponent(pts.slice(1, -1).join("|"))}` : "");
    $("#routeInfo").innerHTML = `<div class="route-box">
      <table class="legs">
        <thead><tr><th>Leg</th><th class="num">Plan (CSV)</th>${live ? `<th class="num">Road (${esc(liveSrc)})</th>` : ""}</tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${fmtKm(totKm)}<div class="note">${fmtHrs(totHrs)}</div></td>${live ? `<td class="num live">${fmtKm(totLive)}<div class="note">${fmtHrs(totLiveH)}</div></td>` : ""}</tr></tfoot>
      </table>
      <div class="btn-row">
        <a class="btn" href="${tripUrl}" target="_blank" rel="noopener">Open whole trip in Google Maps ↗</a>
        <label class="btn ghost"><input type="checkbox" id="showRoute" ${state.showRoute ? "checked" : ""}> Show route</label>
      </div>
      <p class="hint">${live ? `The solid line and “Road” column follow real roads, routed by ${esc(liveSrc)}. The router picks its own fastest way, which may differ from the plan (e.g. sealed highway vs the Western Explorer).` : "Couldn't reach a routing service, so the dashed line joins the stops directly. Distances come from route.csv."}</p>
    </div>`;
    $("#showRoute").addEventListener("change", (e) => { state.showRoute = e.target.checked; drawRoute(); });
  }

  async function drawRoute() {
    const eng = state.engine;
    if (!state.showRoute) { routeSeq++; eng.clearRoute(); state.liveLegs = null; renderRoute(); return; }
    const res = await eng.drawRoute(state.route);
    if (eng !== state.engine) return;
    if (res === undefined) return; // a newer draw is in progress
    state.liveLegs = res;
    renderRoute();
  }

  function select(id, { fromMap = false } = {}) {
    const w = state.walks.find((x) => x.id === id);
    if (!w) return;
    if (state.selected) state.handles.get(state.selected)?.setSelected(false);
    state.selected = id;
    state.handles.get(id)?.setSelected(true);
    $$(".item.sel").forEach((el) => el.classList.remove("sel"));
    const li = $(`.item[data-id="${CSS.escape(id)}"]`);
    if (li) { li.classList.add("sel"); if (fromMap) li.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    if (!fromMap) { setView("map"); state.engine.panTo(w); }
    state.engine.openInfo(w, infoHtml(w));
  }

  function renderMarkers() {
    const eng = state.engine;
    eng.clearMarkers();
    state.handles = new Map();
    state.walks.forEach((w) => state.handles.set(w.id, eng.addMarker(w, (x) => select(x.id, { fromMap: true }))));
    if (state.selected) state.handles.get(state.selected)?.setSelected(true);
  }

  function fitVisible() {
    const pts = state.walks.filter(isVisible).map((w) => ({ lat: w.lat, lng: w.lng }));
    state.engine.fit(pts.length ? pts : state.route.map((s) => ({ lat: s.lat, lng: s.lng })));
  }

  function renderAll({ fit = true } = {}) {
    renderChips();
    renderMarkers();
    renderList();
    renderRoute();
    drawRoute();
    if (fit) fitVisible();
  }

  // ───────────────────────── engine switching ─────────────────────────
  function freshMapEl() {
    const old = $("#map");
    const el = old.cloneNode(false);
    old.replaceWith(el);
    return el;
  }

  async function initEngine() {
    if (CFG.GOOGLE_MAPS_API_KEY) {
      try {
        const eng = await Promise.race([
          googleEngine($("#map")),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
        ]);
        $("#engineInfo").textContent = "Map engine: Google Maps.";
        return eng;
      } catch (e) {
        console.warn("Google Maps failed:", e);
        toast("Google Maps couldn't load – using OpenStreetMap instead.", 6000);
        freshMapEl();
      }
    }
    $("#engineInfo").textContent = CFG.GOOGLE_MAPS_API_KEY
      ? "Map engine: OpenStreetMap (Google Maps failed to load)."
      : "Map engine: OpenStreetMap. Add a Google Maps API key in js/config.js to switch to Google Maps.";
    return leafletEngine($("#map"));
  }

  // Google calls this global if the key is invalid / not authorised for this site.
  window.gm_authFailure = () => {
    console.warn("Google Maps auth failure – falling back to Leaflet.");
    toast("Google Maps key was rejected (check the key and its website restrictions). Using OpenStreetMap.", 8000);
    state.engine = leafletEngine(freshMapEl());
    state.engine.onContext(onContext);
    $("#engineInfo").textContent = "Map engine: OpenStreetMap (Google key rejected).";
    renderAll();
  };

  // ───────────────────────── UI wiring ─────────────────────────
  function setView(v) {
    $("#app").dataset.view = v;
    $$(".mobile-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    if (v === "map") state.engine?.resize();
  }

  async function onContext(lat, lng) {
    const txt = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    let copied = false;
    try { await navigator.clipboard.writeText(`${lat.toFixed(5)},${lng.toFixed(5)}`); copied = true; } catch (_) {}
    toast(`${txt}${copied ? " — copied (lat,lng for the CSV)" : ""}`, 6000);
  }

  function download(name, rows, fields) {
    if (!rows) return toast("Nothing loaded yet.");
    const blob = new Blob([Papa.unparse({ fields, data: rows.map((r) => fields.map((f) => r[f] ?? "")) })], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function loadFileText(file, kind) {
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result);
      const fields = parseCsv(text).fields;
      const isRoute = kind ? kind === "route" : fields.includes("leg_km") || fields.includes("order");
      if (isRoute) { setRoute(text); renderRoute(); drawRoute(); toast(`Route loaded: ${state.route.length} stops from ${file.name}`); }
      else { setWalks(text); state.selected = null; renderAll(); toast(`Walks loaded: ${state.walks.length} from ${file.name}`); }
    };
    rd.readAsText(file);
  }

  function wireUi() {
    $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); renderList(); });

    $("#baseChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-base]"); if (!b) return;
      const v = b.dataset.base;
      if (!v) state.baseFilter.clear();
      else state.baseFilter.has(v) ? state.baseFilter.delete(v) : state.baseFilter.add(v);
      renderChips(); renderList(); fitVisible();
    });
    $("#ruleChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rule]"); if (!b) return;
      const v = b.dataset.rule;
      state.ruleFilter.has(v) ? state.ruleFilter.delete(v) : state.ruleFilter.add(v);
      renderChips(); renderList();
    });

    $("#originChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-origin]"); if (!b) return;
      const v = b.dataset.origin;
      state.originFilter.has(v) ? state.originFilter.delete(v) : state.originFilter.add(v);
      renderChips(); renderList();
    });
    $("#amenChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-amen]"); if (!b) return;
      const v = b.dataset.amen;
      state.amenFilter.has(v) ? state.amenFilter.delete(v) : state.amenFilter.add(v);
      renderChips(); renderList(); fitVisible();
    });
    $("#maxDist").addEventListener("change", (e) => {
      state.maxDist = e.target.value ? Number(e.target.value) : Infinity;
      renderList(); fitVisible();
    });

    $("#list").addEventListener("click", (e) => { if (e.target.closest("a")) return; const li = e.target.closest(".item"); if (li) select(li.dataset.id); });
    $("#list").addEventListener("keydown", (e) => { if (e.key === "Enter") { const li = e.target.closest(".item"); if (li) select(li.dataset.id); } });

    $$(".tab").forEach((t) => t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $$(".tab-body").forEach((x) => x.classList.toggle("active", x.id === `tab-${t.dataset.tab}`));
    }));
    $$(".mobile-toggle button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

    $("#nearMe").addEventListener("click", () => {
      if (state.me) { state.me = null; state.engine.setMe(null); $("#nearMe").textContent = "📍 Near me"; renderList(); return; }
      if (!navigator.geolocation) return toast("Location isn't available in this browser.");
      toast("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        (p) => {
          state.me = { lat: p.coords.latitude, lng: p.coords.longitude };
          state.engine.setMe(state.me);
          $("#nearMe").textContent = "✕ Clear location";
          renderList(); toast("List sorted by distance from you.");
        },
        (err) => toast(`Couldn't get your location (${err.message}).`),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    $("#fileWalks").addEventListener("change", (e) => e.target.files[0] && loadFileText(e.target.files[0], "walks"));
    $("#fileRoute").addEventListener("change", (e) => e.target.files[0] && loadFileText(e.target.files[0], "route"));
    $("#dlWalks").addEventListener("click", () => download("walks.csv", state.rawWalks, state.walksFields));
    $("#dlRoute").addEventListener("click", () => download("route.csv", state.rawRoute, state.routeFields));

    // drag & drop a CSV anywhere
    let dragDepth = 0;
    window.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth++; $("#drop").hidden = false; } });
    window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#drop").hidden = true; });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault(); dragDepth = 0; $("#drop").hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) loadFileText(f);
    });
  }

  // ───────────────────────── boot ─────────────────────────
  async function boot() {
    wireUi();
    const params = new URLSearchParams(location.search);
    const walksUrl = params.get("walks") || CFG.WALKS_CSV;
    const routeUrl = params.get("route") || CFG.ROUTE_CSV;

    const [engine, walksTxt, routeTxt] = await Promise.all([
      initEngine(),
      fetchText(walksUrl).catch((e) => { console.error(e); return null; }),
      fetchText(routeUrl).catch((e) => { console.error(e); return null; }),
    ]);
    if (!state.engine) { state.engine = engine; engine.onContext(onContext); } // gm_authFailure may already have swapped it

    if (walksTxt) setWalks(walksTxt);
    if (routeTxt) setRoute(routeTxt);
    if (!walksTxt || !routeTxt) {
      const hint = location.protocol === "file:" ? " Browsers block CSV loading from file:// – run a local server (see README) or use Data → Load CSV." : "";
      toast(`Couldn't load ${!walksTxt ? walksUrl : routeUrl}.${hint}`, 10000);
    }
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
