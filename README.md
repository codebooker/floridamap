# FloridaMap

A live statewide Florida operations map built with vanilla JavaScript and Leaflet. Displays real-time traffic cameras, incidents, weather radar, aircraft, power outages, dynamic message signs, speed sensors, plate readers, and emergency activity across Florida.

**Live site:** https://floridamap.app

---

## Features

- **Traffic cameras** — live FL511 camera feeds and snapshots
- **Incidents** — statewide traffic incidents and construction zones
- **Weather radar** — live RainViewer radar overlay
- **Aircraft** — real-time aircraft positions
- **Power outages** — Duke Energy outage map
- **Message signs** — FL511 dynamic message sign content
- **Speed sensors** — live sensor readings
- **Plate readers** — statewide LPR locations (OpenStreetMap data)
- **Emergency activity** — PulsePoint EMS/fire dispatch
- **Tampa Fire** — Tampa Fire Rescue unit dispatch with grid info

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS, [Leaflet 1.9.4](https://leafletjs.com/) |
| Video | [hls.js 1.6.16](https://github.com/video-dev/hls.js/) |
| Backend | Python 3 stdlib HTTP server (`proxy.py`) |
| Crypto | `cryptography` package (PulsePoint AES decryption) |

No build step. No npm. No framework.

---

## Running locally

### 1. Install dependencies

```bash
python3 -m pip install cryptography
```

### 2. Set required environment variables

Copy `.env.example` to `.env` and fill in real credentials:

```bash
cp .env.example .env
# edit .env
```

Required variables:

| Variable | Description |
|---|---|
| `DUKE_ENERGY_AUTH` | Duke Energy API — `Basic <base64 user:pass>` |
| `PULSEPOINT_SECRET` | PulsePoint payload decryption key |

Optional:

| Variable | Default | Description |
|---|---|---|
| `FLORIDAMAP_HOST` | `127.0.0.1` | Bind address |
| `FLORIDAMAP_PORT` | `8765` | Listen port |
| `FLORIDAMAP_DEBUG` | `0` | Set to `1` for verbose logging (never in production) |

### 3. Start the server

```bash
# Load env vars and start
export $(grep -v '^#' .env | xargs)
python3 proxy.py
```

Then open http://localhost:8765 in your browser.

---

## Project structure

```
index.html              Main HTML shell
app.js                  All application JavaScript
proxy.py                Python proxy / API gateway / static file server
site.webmanifest        PWA manifest
floridamap-logo.svg     SVG favicon
apple-touch-icon.png    iOS home screen icon (180×180)
icon-192.png            PWA icon (192×192)
icon-512.png            PWA icon (512×512)
floridamap-social-card.png    OG image (1200×630)
floridamap-social-square.png  OG square image (1200×1200)
floridamap-social-card.svg    Source SVG for social card
floridamap-social-square.svg  Source SVG for social square
cameras.json            FL511 camera registry (static)
lpr.json                LPR location data (OpenStreetMap)
signs.json              FL511 sign registry (static)
construction.json       Construction zone data
.env.example            Environment variable template
```

---

## Security notes

- The proxy enforces a Content Security Policy with no `unsafe-inline` on scripts.
- All API data is HTML-escaped before insertion into the DOM.
- The stream proxy only forwards to an allowlisted upstream host (`divas.cloud`).
- Credentials are required via environment variables — there are no hardcoded defaults.
- See `.env.example` for required secrets. **Never commit `.env`.**

---

## Data sources

| Data | Source |
|---|---|
| Traffic cameras, incidents, signs | [FL511](https://fl511.com) |
| Aircraft | ADS-B (proxied) |
| Weather radar | [RainViewer](https://www.rainviewer.com/) |
| Power outages | Duke Energy API |
| Emergency dispatch | [PulsePoint](https://www.pulsepoint.org/) |
| Tampa Fire dispatch | Tampa Gov ArcGIS |
| Plate readers | [OpenStreetMap](https://www.openstreetmap.org/) Overpass API |
| Base map tiles | [CartoDB](https://carto.com/basemaps/) |
| Traffic tiles | ibi511 |
