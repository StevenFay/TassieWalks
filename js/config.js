// ─────────────────────────────────────────────────────────────
//  TassieWalks configuration
// ─────────────────────────────────────────────────────────────
//  1. Paste your Google Maps JavaScript API key below.
//     Leave it empty and the app falls back to an OpenStreetMap
//     (Leaflet) base map, so it still works with no key at all.
//  2. Restrict the key in Google Cloud Console → Credentials →
//     "Website restrictions" to your site, e.g.
//        https://stevenfay.github.io/*
//        http://localhost:8000/*
//     A browser key is always visible in page source, so the
//     referrer restriction is what protects it.
// ─────────────────────────────────────────────────────────────
window.TASSIE_CONFIG = {
  GOOGLE_MAPS_API_KEY: "",

  // Advanced markers need a Map ID. "DEMO_MAP_ID" works for testing;
  // create your own under Google Cloud → Map Management for production.
  GOOGLE_MAP_ID: "DEMO_MAP_ID",

  // Data sources. Relative paths, or any public CSV URL
  // (e.g. a Google Sheet published as CSV). Can also be overridden
  // with ?walks=<url>&route=<url> in the page address.
  WALKS_CSV: "data/walks.csv",
  ROUTE_CSV: "data/route.csv",

  // Ask Google for a live driving route through the stops.
  // Falls back to straight lines + CSV distances if unavailable.
  LIVE_DIRECTIONS: true,
};
