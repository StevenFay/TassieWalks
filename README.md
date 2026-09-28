# 🐾 TassieWalks

A map of dog-friendly walks for a Tasmanian road trip:
**Devonport → Scottsdale → Beaumaris → Arthur River → Strahan**.

Everything on the map comes from two CSV files you can edit. The map uses
**Google Maps** when you add an API key. Without a key it uses
**OpenStreetMap**, so it works straight away.

## Features

- Coloured pins for each walk: 🟢 off lead · 🟣 dog park · 🟤 historic pub · 🔵 on lead · 🟠 check signage · 🔴 no dogs (places to skip)
- Filter by area and by dog rule, and search on any text
- Click a pin or a list row to see length, difficulty, distance from the town, detour off the route, features, notes, and links for **Directions**, **Google Maps**, **AllTrails** and the **Source**
- **Route tab** lists each driving leg and the trip total from `route.csv`. It draws the real road route with live driving distances: from Google when a key is set, otherwise from the free OpenStreetMap router (OSRM). It has a one-click **Open whole trip in Google Maps** link.
- **📍 Near me** sorts the walks by how far they are from you (handy on your phone during the trip)
- **Mobile layout** with a Map / List toggle
- **Try edits in the browser:** load a CSV from the Data tab or drag one onto the map. Download the current CSVs. Right-click (or long-press) the map to copy `lat,lng` for a new row.

## AllTrails trails

163 extra walks were imported from AllTrails: every trail within 300 km of a base town
that AllTrails tags as dog-friendly. They have `origin = alltrails`. Use the
“AllTrails trails” chip and the “Within … km of the base town” filter to show them.

- AllTrails doesn't give trailhead coordinates, so each pin was estimated from AllTrails'
  distance-to-trailhead data (usually within about 1 km, sometimes 2–3 km). Use the
  AllTrails link for the exact start.
- AllTrails dog tags are crowd-sourced. Where a trail sits in a State Reserve or National
  Park, it's marked “Check signage”, because dogs are normally banned there.
- Dogs “allowed” on AllTrails doesn't mean off-lead, so these are all shown as on-lead.

## Editing the data

### `data/walks.csv`

| column | notes |
|---|---|
| `id` | any unique value |
| `base` | the group the walk belongs to, e.g. `Scottsdale`, `Beaumaris → Arthur River`. Groups show in the order they first appear. |
| `name` | required |
| `type`, `length_time`, `difficulty` | free text |
| `dog_rule` | `Off lead`, `Dog park`, `Pub`, `On lead`, `Check` or `No dogs` |
| `features`, `notes` | free text (notes show as a highlighted warning) |
| `dist_from_base_km`, `detour_km` | numbers, can be left blank |
| `lat`, `lng` | required, as decimal degrees (right-click the map to get them) |
| `source` | a URL |
| `origin` | `curated` (researched from council / Parks sources) or `alltrails` (imported from AllTrails' dog-friendly tags) |
| `rating` | AllTrails star rating (optional) |
| `alltrails_url` | the walk's AllTrails page (optional; if left blank, the pop-up shows a “Find on AllTrails” search link instead) |

### `data/route.csv`

`order, name, lat, lng, leg_km, leg_hrs, notes`. The leg values are the
distance and time *from the previous stop*.

You can edit either file in Excel, Numbers, Google Sheets or directly on
GitHub. Commit the change and the site updates.

### Using a Google Sheet as the data source

1. Import `walks.csv` into a Google Sheet.
2. Choose **File → Share → Publish to web**, select the sheet, pick **CSV** and copy the link.
3. Open the site with `?walks=<that link>` added to the address (do the same with `&route=` for the route sheet).
   You can also put the link into `WALKS_CSV` in `js/config.js`.

After that, edits in the Sheet show up on the map the next time the page is loaded. Google may take a few minutes to update the published CSV.

## Google Maps setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable:
   - **Maps JavaScript API** (required)
   - **Directions API** (optional; without it the road route comes from OpenStreetMap instead)
2. Go to **Credentials → Create credentials → API key**, and restrict it:
   - Application restriction: **Websites**, e.g. `https://stevenfay.github.io/*` and `http://localhost:8000/*`
   - API restriction: Maps JavaScript API (+ Directions API)
3. Paste the key into `js/config.js` → `GOOGLE_MAPS_API_KEY`.
4. Optional: create a Map ID (**Map Management**) and set `GOOGLE_MAP_ID`. `DEMO_MAP_ID` is fine for testing.

A browser key is always visible in the page source. The website restriction
is what stops other sites from using it. Light personal use fits within
Google's free monthly credit.

If the key is missing, rejected or blocked, the app shows a message and
switches to OpenStreetMap. Newer Google Cloud projects can't enable the
legacy Directions API. In that case the road route comes from the free
OpenStreetMap router instead. Straight dashed lines only appear if no
routing service can be reached.

## Run locally

Browsers block loading CSV files from `file://`, so start a tiny local server:

```bash
cd TassieWalks
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish with GitHub Pages

In the repo, go to **Settings → Pages → Build and deployment**. Set the
source to **Deploy from a branch** and the branch to `main` / `(root)`.
The site will be at `https://stevenfay.github.io/TassieWalks/`.

## Project layout

```
index.html        page shell
css/style.css     styles (light/dark, mobile)
js/config.js      API key + data source settings
js/app.js         CSV loading, filters, list, Google/Leaflet map engines
data/walks.csv    the walks
data/route.csv    the trip stops and legs
```

Libraries come from cdnjs: [PapaParse](https://www.papaparse.com/) and
[Leaflet](https://leafletjs.com/). There is no build step.

## ⚠️ Caveats

- Coordinates are approximate, so check trailheads before you drive to them.
- Dogs are **not allowed in Tasmanian National Parks or State Reserves**.
  Beach rules change with the seasons (shorebird nesting), so always follow the signs on the day.
- Distances in the plan are estimates. Check them with the live Google figures or Google Maps.
