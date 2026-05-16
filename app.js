if (window.location.protocol === 'file:') {
  window.location.replace('http://localhost:8765/');
}

// ── State ─────────────────────────────────────────────────────────────────
let allCameras = [];
let filteredCameras = [];
let allSigns = [];
let allLpr = [];
let allSensors = [];
let allTempStations = [];
let tempMarkers  = new Map();
let camMarkers   = new Map();
let signMarkers  = new Map();
let incMarkers   = new Map();
let conMarkers   = new Map();
let powerLayers  = new Map();
let powerFeedEntries = new Map();
let govAirMarkers = new Map();
let civAirMarkers = new Map();
let emerMarkers  = new Map();
const emerMarkerTypes = new Map(); // key → icon type (fire, medical, police, traffic, patrol, warning)
let sensMarkers  = new Map();
let lprMarkers   = new Map();
let camAggregateMarkers  = new Map();
let signAggregateMarkers = new Map();
let sensAggregateMarkers = new Map();
let lprAggregateMarkers  = new Map();
let selectedId   = null;
let refreshTimer = null;
let hlsInstance  = null;
let initialLoaderSettled = false;
let introRevealPlayed = false;
const introStartedAt = performance.now();
let startupHintDismissed = false;
let startupHintPulsePlayed = false;
let startupHintPulseTimer = null;
let startupHintDismissTimer = null;
let feedPanelHintDismissed = false;
let feedPanelHintTimer = null;
let feedPanelCollapsed = true;
let panelCollapsed = true;
let liveStatusCollapsed = true;
let mobileHeaderMenuOpen = false;
let incidentLayerZoomOverride = false;
let cameraHopOptions = { up: null, down: null, left: null, right: null };
let radarRefreshToken = Date.now();
let radarSource = { provider: 'noaa', host: '', path: '' };
let radarSourceRefreshInFlight = null;
const layerVisible = { cam: true, sign: true, inc: true, con: true, flow: true, radar: true, power: true, air: true, govair: true, civair: true, emer: true, sens: true, lpr: true, temp: true };
const emerTypeVisible = { fire: true, medical: true, police: true, traffic: true, patrol: true, warning: true };
const DENSE_LAYER_KEYS = new Set(['cam', 'sign', 'sens', 'lpr', 'con', 'power', 'temp']);
const denseLayerZoomOverride = { cam: false, sign: false, sens: false, lpr: false, con: false, power: false, temp: false };
const CAMERA_RAW_MIN_ZOOM = 11;
const CAMERA_HOP_MIN_ZOOM = 13;
const DENSE_LAYER_MIN_ZOOM = { cam: 10, sign: 11, lpr: 11, sens: 11, con: 11, power: 9, temp: 7 };
const TEMPERATURE_REFRESH_INTERVAL_MS = 300000; // 5 min
const INCIDENT_LAYER_MIN_ZOOM = 11;
const STARTUP_HINT_PULSE_DELAY_MS = 6000;
const STARTUP_HINT_AUTO_DISMISS_MS = 10000;
const FEED_PANEL_HINT_DURATION_MS = 10000;
const RADAR_REFRESH_INTERVAL_MS = 300000;
const SENSOR_REFRESH_INTERVAL_MS = 60000;
const SIGN_REFRESH_INTERVAL_MS = 300000;
const INCIDENT_REFRESH_INTERVAL_MS = 300000;
const FLOW_REFRESH_INTERVAL_MS = 300000;
const CONSTRUCTION_REFRESH_INTERVAL_MS = 3600000;
const POWER_REFRESH_INTERVAL_MS = 600000;
const INITIAL_LOADER_MAX_WAIT_MS = 3500;
const CAMERA_NAME_WARM_LIMIT = 48;
const CAMERA_HOP_LABELS = {
  up: { arrow: '↑', marker: '▲', text: 'Up' },
  down: { arrow: '↓', marker: '▼', text: 'Down' },
  left: { arrow: '←', marker: '◀', text: 'Left' },
  right: { arrow: '→', marker: '▶', text: 'Right' }
};
const CAMERA_HOP_PANE = { name: 'cam-hop-pane', zIndex: 1255 };
const CAMERA_SELECTED_MARKER_GLYPH = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="#ffffff" d="M7.5 7.25 9.1 5.5h5.8l1.6 1.75H18a2 2 0 0 1 2 2v7.25a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9.25a2 2 0 0 1 2-2zm4.5 2.1a4.15 4.15 0 1 0 0 8.3 4.15 4.15 0 0 0 0-8.3zm0 1.9a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5z"/>
  </svg>
`;
const RAINVIEWER_MAX_TILE_ZOOM = 7;
const RAINVIEWER_TILE_SIZE = 512;
const RAINVIEWER_COLOR_SCHEME = 2;
const RAINVIEWER_TILE_OPTIONS = '1_0';
const LIVE_STATUS_RENDER_INTERVAL_MS = 10000;
const LAYER_PANES = {
  cam:  { name: 'cam-pane',  zIndex: 640, delay: 260 },
  sign: { name: 'sign-pane', zIndex: 641, delay: 340 },
  inc:  { name: 'inc-pane',  zIndex: 650, delay: 150 },
  con:  { name: 'con-pane',  zIndex: 645, delay: 220 },
  power: { name: 'power-pane', zIndex: 637, delay: 240 },
  govair: { name: 'govair-pane', zIndex: 1301, delay: 300 },
  civair: { name: 'civair-pane', zIndex: 1300, delay: 320 },
  emer: { name: 'emer-pane', zIndex: 660, delay: 80 },
  sens: { name: 'sens-pane', zIndex: 638, delay: 420 },
  lpr:  { name: 'lpr-pane',  zIndex: 639, delay: 380 },
  temp: { name: 'temp-pane', zIndex: 636, delay: 460 }
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LIVE_LAYER_STATUS = {
  air: { label: 'Aircraft', intervalMs: 30000 },
  emer: { label: 'Emergency', intervalMs: 60000 },
  sens: { label: 'Sensors', intervalMs: SENSOR_REFRESH_INTERVAL_MS },
  inc: { label: 'Incidents', intervalMs: INCIDENT_REFRESH_INTERVAL_MS },
  flow: { label: 'Traffic Flow', intervalMs: FLOW_REFRESH_INTERVAL_MS },
  radar: { label: 'Radar', intervalMs: RADAR_REFRESH_INTERVAL_MS },
  con: { label: 'Construction', intervalMs: CONSTRUCTION_REFRESH_INTERVAL_MS },
  power: { label: 'Power', intervalMs: POWER_REFRESH_INTERVAL_MS },
  temp: { label: 'Temperature', intervalMs: TEMPERATURE_REFRESH_INTERVAL_MS }
};
const liveLayerFreshness = Object.fromEntries(
  Object.keys(LIVE_LAYER_STATUS).map(key => [key, { updatedAt: null }])
);
const cameraNameRequests = new Map();
let cameraNameWarmQueued = false;
let cameraHopMarkerIds = new Set();
const incidentFeedEntries = new Map();
const emergencyFeedEntries = new Map();
const pendingIncidentFeedDetailKeys = new Set();
const ACTIVITY_FEED_DETAIL_FETCH_LIMIT = 16;
const SIGN_DETAIL_WARM_LIMIT = 48;
const SIGN_ALERT_PATTERN = /AMBER|SILVER|PURPLE|BLUE|MISSING|WRONG[\s-]?WAY/i;

function syncAircraftLayerVisibilityState() {
  layerVisible.air = Boolean(layerVisible.govair || layerVisible.civair);
}

function layerStatusVisible(key) {
  if (key === 'air') return Boolean(layerVisible.air);
  return layerVisible[key] !== false;
}

syncAircraftLayerVisibilityState();

function formatFreshnessAge(ageMs) {
  if (ageMs < 15000) return 'just now';
  if (ageMs < 60000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3600000) return `${Math.round(ageMs / 60000)}m ago`;
  return `${Math.round(ageMs / 3600000)}h ago`;
}

function freshnessTone(ageMs, intervalMs) {
  if (ageMs <= intervalMs * 1.5) return 'fresh';
  if (ageMs <= intervalMs * 3) return 'aging';
  return 'stale';
}

function markLayerFresh(key, timestamp = Date.now()) {
  if (!liveLayerFreshness[key]) return;
  liveLayerFreshness[key].updatedAt = timestamp;
  renderFreshnessPanel();
}

function renderFreshnessPanel() {
  const grid = document.getElementById('live-status-grid');
  if (!grid) return;
  const now = Date.now();
  grid.innerHTML = Object.entries(LIVE_LAYER_STATUS).map(([key, meta]) => {
    const updatedAt = liveLayerFreshness[key]?.updatedAt ?? null;
    const isVisible = layerStatusVisible(key);
    let tone = 'waiting';
    let value = 'Waiting';
    if (!isVisible) {
      tone = 'muted';
      value = 'Hidden';
    } else if (updatedAt) {
      const ageMs = now - updatedAt;
      tone = freshnessTone(ageMs, meta.intervalMs);
      value = formatFreshnessAge(ageMs);
    }
    const title = updatedAt
      ? `${meta.label} updated ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
      : `${meta.label} has not updated yet`;
    return `<div class="live-status-row ${tone}" title="${title}">
      <span class="live-status-dot"></span>
      <span class="live-status-label">${meta.label}</span>
      <span class="live-status-value">${value}</span>
    </div>`;
  }).join('');
}

function parseEventTimeMs(raw) {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFeedTimeLabel(item) {
  if (!item.timeMs) return 'No time';
  const ageMs = Date.now() - item.timeMs;
  if (ageMs < 60000) return 'Just now';
  if (ageMs < 3600000) return `${Math.max(1, Math.round(ageMs / 60000))}m ago`;
  return `${Math.max(1, Math.round(ageMs / 3600000))}h ago`;
}

function formatIncidentFeedLocation(item) {
  if (item.location) return item.location;
  if (typeof item.lat === 'number' && typeof item.lon === 'number') {
    return `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
  }
  return 'Location unavailable';
}

function powerLayerVisibleInBounds(layer, bounds, item) {
  const layerBounds = typeof layer?.getBounds === 'function' ? layer.getBounds() : null;
  if (layerBounds && typeof layerBounds.isValid === 'function' && layerBounds.isValid()) {
    return bounds.intersects(layerBounds);
  }
  if (item && typeof item.lat === 'number' && typeof item.lon === 'number') {
    return bounds.contains([item.lat, item.lon]);
  }
  return false;
}

function activityFeedItemsInView() {
  const bounds = map.getBounds();
  const items = [];
  if (incidentLayerMarkersVisible('emer')) {
    for (const item of emergencyFeedEntries.values()) {
      if (bounds.contains([item.lat, item.lon])) items.push(item);
    }
  }
  if (incidentLayerMarkersVisible('inc')) {
    for (const item of incidentFeedEntries.values()) {
      if (bounds.contains([item.lat, item.lon])) items.push(item);
    }
  }
  if (layerVisible.power) {
    for (const [key, item] of powerFeedEntries) {
      const layer = powerLayers.get(key);
      if (layer && powerLayerVisibleInBounds(layer, bounds, item)) items.push(item);
    }
  }
  if (layerVisible.sign && !denseLayerAutoHidden('sign')) {
    for (const sign of denseItemsInView(allSigns)) {
      if (!String(sign.msg || '').trim()) continue;
      items.push({
        key: `sign:${sign.id}`,
        id: sign.id,
        kind: 'sign',
        title: sign.msg,
        lat: sign.lat,
        lon: sign.lon,
        location: sign.name || 'Message Sign',
        timeMs: sign.timeMs || parseEventTimeMs(sign.timestamp),
        timeText: sign.timestamp || null,
        feedLabel: signIsAlertMessage(sign.msg) ? 'Alert Sign' : 'Message Sign',
        isAlert: signIsAlertMessage(sign.msg)
      });
    }
  }
  return items.sort((a, b) => {
    if (a.timeMs && b.timeMs) return b.timeMs - a.timeMs;
    if (a.timeMs) return -1;
    if (b.timeMs) return 1;
    if ((a.orderId || 0) !== (b.orderId || 0)) return (b.orderId || 0) - (a.orderId || 0);
    const priority = { emergency: 0, incident: 1, power: 2, sign: 3 };
    return ((priority[a.kind] ?? 9) - (priority[b.kind] ?? 9)) || String(a.key).localeCompare(String(b.key));
  });
}

function queueIncidentFeedDetail(item) {
  if (!item || item.kind !== 'incident' || item.detailLoaded || pendingIncidentFeedDetailKeys.has(item.key)) return;
  pendingIncidentFeedDetailKeys.add(item.key);
  fetchFL511Tooltip(item.layer, item.id).then(info => {
    pendingIncidentFeedDetailKeys.delete(item.key);
    const current = incidentFeedEntries.get(item.key);
    if (!current) return;
    current.detailLoaded = true;
    if (!info) {
      renderActivityFeed();
      return;
    }
    current.title = info.msg || current.title;
    current.severity = info.severity || current.severity || null;
    renderActivityFeed();
  }).catch(() => {
    pendingIncidentFeedDetailKeys.delete(item.key);
    const current = incidentFeedEntries.get(item.key);
    if (current) current.detailLoaded = true;
  });
}

function renderActivityFeed() {
  const list = document.getElementById('feed-list');
  const title = document.getElementById('feed-title');
  if (!list || !title) return;
  if (!layerVisible.emer && !layerVisible.inc && !layerVisible.power && !layerVisible.sign) {
    title.textContent = 'On-Screen Activity';
    list.innerHTML = `<div class="feed-empty">Enable <strong>Incidents</strong>, <strong>Power Outages</strong>, or <strong>Signs</strong> to populate this feed for the current view.</div>`;
    return;
  }
  const items = activityFeedItemsInView();
  title.textContent = `On-Screen Activity · ${items.length}`;
  if (!items.length) {
    list.innerHTML = `<div class="feed-empty">No emergency callouts, incidents, visible power outages, or active sign messages are currently visible in this map view.</div>`;
    return;
  }

  const toWarm = items.filter(item => item.kind === 'incident' && !item.detailLoaded).slice(0, ACTIVITY_FEED_DETAIL_FETCH_LIMIT);
  toWarm.forEach(queueIncidentFeedDetail);

  list.innerHTML = items.map(item => {
    const badgeClass = item.kind === 'emergency' ? 'emer' : item.kind === 'power' ? 'power' : item.kind === 'sign' ? 'sign' : 'inc';
    const badgeLabel = item.kind === 'emergency'
      ? (item.source || 'Emergency')
      : item.kind === 'power'
        ? 'Power'
      : (item.feedLabel || 'Incident');
    const titleText = item.title || item.feedLabel || 'Incident';
    const locationText = item.kind === 'sign' ? (item.location || 'Message Sign') : formatIncidentFeedLocation(item);
    const meta = item.kind === 'emergency'
      ? [item.category, item.source].filter(Boolean).join(' · ')
      : item.kind === 'power'
        ? [
            item.customersAffectedText,
            item.outagesText,
            item.status,
            item.timeText ? `Updated ${item.timeText}` : null
          ].filter(Boolean).join(' · ')
      : item.kind === 'sign'
        ? [item.isAlert ? 'Alert' : 'Sign', item.timeText ? 'FL511 timestamp' : null].filter(Boolean).join(' · ')
        : [item.severity, item.layer === 'DisabledVehicles' ? 'Disabled Vehicle' : 'FL511 Incident'].filter(Boolean).join(' · ');
    return `<button class="feed-item" type="button" data-kind="${escapeHtml(item.kind)}" data-key="${escapeHtml(item.key)}">
      <div class="feed-item-head">
        <span class="feed-item-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        <span class="feed-item-time">${escapeHtml(formatFeedTimeLabel(item))}</span>
      </div>
      <div class="feed-item-title">${escapeHtml(titleText)}</div>
      <div class="feed-item-location">${escapeHtml(locationText)}</div>
      <div class="feed-item-meta">${escapeHtml(meta || 'Visible on map')}</div>
    </button>`;
  }).join('');

  list.querySelectorAll('.feed-item').forEach(btn => {
    btn.addEventListener('click', () => focusActivityItem(btn.dataset.kind, btn.dataset.key));
  });
}

function focusActivityItem(kind, key) {
  const sourceMap = kind === 'emergency' ? emerMarkers : kind === 'power' ? powerLayers : kind === 'sign' ? signMarkers : incMarkers;
  const dataMap = kind === 'emergency' ? emergencyFeedEntries : kind === 'power' ? powerFeedEntries : kind === 'sign' ? null : incidentFeedEntries;
  const markerKey = kind === 'emergency' ? key : kind === 'power' ? key : kind === 'sign' ? key.replace(/^sign:/, '') : key.replace(/^inc:/, '');
  const marker = sourceMap.get(markerKey);
  const item = kind === 'sign'
    ? allSigns.find(sign => String(sign.id) === markerKey && String(sign.msg || '').trim())
    : dataMap.get(key);
  if (!item) return;
  if (kind === 'power' && marker && typeof marker.getBounds === 'function') {
    const bounds = marker.getBounds();
    if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
      const isSinglePoint =
        bounds.getNorth() === bounds.getSouth() &&
        bounds.getEast() === bounds.getWest();
      if (!isSinglePoint) {
        map.flyToBounds(bounds.pad(0.25), { maxZoom: 12, duration: 0.4 });
      } else {
        map.flyTo([item.lat, item.lon], Math.max(map.getZoom(), 12), { duration: 0.35 });
      }
    } else {
      map.flyTo([item.lat, item.lon], Math.max(map.getZoom(), 12), { duration: 0.35 });
    }
  } else {
    map.flyTo([item.lat, item.lon], Math.max(map.getZoom(), 12), { duration: 0.35 });
  }
  if (marker) {
    setTimeout(() => marker.openPopup(), 420);
  }
}

function isDesktopPanelLayout() {
  return window.innerWidth > 860;
}

function syncMobileHeaderMenuState() {
  const header = document.querySelector('header');
  const toggle = document.getElementById('mobile-header-menu-toggle');
  if (!header || !toggle) return;

  if (isDesktopPanelLayout()) {
    mobileHeaderMenuOpen = false;
    header.classList.remove('mobile-menu-open');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-label', 'Open layers menu');
    toggle.title = 'Open layers menu';
    return;
  }

  header.classList.toggle('mobile-menu-open', mobileHeaderMenuOpen);
  toggle.classList.toggle('active', mobileHeaderMenuOpen);
  toggle.setAttribute('aria-label', mobileHeaderMenuOpen ? 'Close layers menu' : 'Open layers menu');
  toggle.title = mobileHeaderMenuOpen ? 'Close layers menu' : 'Open layers menu';
}

function toggleMobileHeaderMenu(force) {
  if (isDesktopPanelLayout()) return;
  mobileHeaderMenuOpen = typeof force === 'boolean' ? force : !mobileHeaderMenuOpen;
  syncMobileHeaderMenuState();
}

let panelResizeTimer = null;
function scheduleMapResize() {
  clearTimeout(panelResizeTimer);
  panelResizeTimer = setTimeout(() => map.invalidateSize({ pan: false }), 270);
}

function syncLiveStatusCollapsedState() {
  const status = document.getElementById('live-status');
  const toggle = document.getElementById('live-status-toggle');
  if (!status || !toggle) return;

  const isMobile = !isDesktopPanelLayout();
  if (!isMobile) {
    status.classList.remove('mobile-collapsed', 'mobile-open');
    toggle.style.display = 'none';
    toggle.classList.remove('active');
    toggle.setAttribute('aria-label', 'Hide live status');
    toggle.title = 'Hide live status';
    return;
  }

  toggle.style.display = 'inline-flex';
  status.classList.toggle('mobile-collapsed', liveStatusCollapsed);
  status.classList.toggle('mobile-open', !liveStatusCollapsed);
  toggle.classList.toggle('active', !liveStatusCollapsed);
  toggle.setAttribute('aria-label', liveStatusCollapsed ? 'Show live status' : 'Hide live status');
  toggle.title = liveStatusCollapsed ? 'Show live status' : 'Hide live status';

  const shell = document.getElementById('map-shell');
  if (shell) {
    if (!liveStatusCollapsed) {
      requestAnimationFrame(() => {
        const cardH = status.getBoundingClientRect().height;
        shell.style.setProperty('--map-key-shift', `${-(cardH + 8)}px`);
      });
    } else {
      shell.style.removeProperty('--map-key-shift');
    }
  }
}

function toggleLiveStatusCollapsed() {
  if (isDesktopPanelLayout()) return;
  liveStatusCollapsed = !liveStatusCollapsed;
  syncLiveStatusCollapsedState();
}

function toggleMapKey() {
  const key = document.getElementById('map-key');
  const btn = document.getElementById('map-key-toggle');
  if (!key || !btn) return;
  const isOpen = !key.classList.contains('hidden');
  key.classList.toggle('hidden', isOpen);
  btn.classList.toggle('open', !isOpen);
  if (!isOpen && isDesktopPanelLayout()) {
    dismissFeedPanelHint();
    dismissStartupHint();
  }
  updateOverviewHint();
}

function syncFeedPanelCollapsedState() {
  const main = document.getElementById('main');
  const panel = document.getElementById('feed-panel');
  const toggle = document.getElementById('feed-panel-toggle');
  const chevron = document.getElementById('feed-panel-toggle-chevron');
  if (!main || !panel || !toggle) return;

  if (!isDesktopPanelLayout()) {
    main.classList.remove('feed-panel-collapsed');
    main.classList.remove('feed-panel-hinting');
    main.classList.remove('feed-panel-hint-fading');
    panel.classList.remove('collapsed');
    toggle.style.display = 'none';
    toggle.classList.remove('pulsing');
    if (feedPanelHintTimer) {
      clearTimeout(feedPanelHintTimer);
      feedPanelHintTimer = null;
    }
    return;
  }

  main.classList.toggle('feed-panel-collapsed', feedPanelCollapsed);
  panel.classList.toggle('collapsed', feedPanelCollapsed);
  toggle.style.display = 'flex';
  if (chevron) chevron.textContent = feedPanelCollapsed ? '›' : '‹';
  toggle.setAttribute('aria-label', feedPanelCollapsed ? 'Expand activity feed' : 'Collapse activity feed');
  toggle.title = feedPanelCollapsed ? 'Expand activity feed' : 'Collapse activity feed';
  const shouldShowHint = !feedPanelHintDismissed && feedPanelCollapsed;
  if (shouldShowHint) {
    main.classList.add('feed-panel-hinting');
    main.classList.remove('feed-panel-hint-fading');
    toggle.classList.add('pulsing');
    if (!feedPanelHintTimer) {
      feedPanelHintTimer = setTimeout(() => {
        feedPanelHintTimer = null;
        dismissFeedPanelHint();
      }, FEED_PANEL_HINT_DURATION_MS);
    }
  } else if (!main.classList.contains('feed-panel-hint-fading')) {
    main.classList.remove('feed-panel-hinting');
    toggle.classList.remove('pulsing');
  }
  scheduleMapResize();
}

function toggleFeedPanelCollapsed() {
  if (!isDesktopPanelLayout()) return;
  dismissFeedPanelHint(true);
  feedPanelCollapsed = !feedPanelCollapsed;
  syncFeedPanelCollapsedState();
}

function dismissFeedPanelHint(immediate = false) {
  if (feedPanelHintDismissed) return;
  feedPanelHintDismissed = true;
  if (feedPanelHintTimer) {
    clearTimeout(feedPanelHintTimer);
    feedPanelHintTimer = null;
  }
  const main = document.getElementById('main');
  const toggle = document.getElementById('feed-panel-toggle');
  if (toggle) toggle.classList.remove('pulsing');
  if (immediate) {
    if (main) {
      main.classList.remove('feed-panel-hinting');
      main.classList.remove('feed-panel-hint-fading');
    }
    scheduleMapResize();
    return;
  }
  if (main) {
    main.classList.add('feed-panel-hint-fading');
    main.classList.remove('feed-panel-hinting');
  }
  setTimeout(() => {
    if (main) main.classList.remove('feed-panel-hint-fading');
    scheduleMapResize();
  }, 360);
}

function syncPanelCollapsedState() {
  const main = document.getElementById('main');
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  if (!main || !panel || !toggle) return;

  if (!isDesktopPanelLayout()) {
    main.classList.remove('panel-collapsed');
    panel.classList.remove('collapsed');
    toggle.style.display = 'none';
    return;
  }

  const collapsed = panelCollapsed;

  main.classList.toggle('panel-collapsed', collapsed);
  panel.classList.toggle('collapsed', collapsed);
  toggle.style.display = 'flex';
  toggle.textContent = collapsed ? '‹' : '›';
  toggle.setAttribute('aria-label', collapsed ? 'Expand camera panel' : 'Collapse camera panel');
  toggle.title = collapsed ? 'Expand camera panel' : 'Collapse camera panel';
  syncCameraHopState();
  scheduleMapResize();
}

function togglePanelCollapsed() {
  if (!isDesktopPanelLayout()) return;
  panelCollapsed = !panelCollapsed;
  syncPanelCollapsedState();
}

// Statewide Florida bounds
const BBOX = { minLat: 24.4, maxLat: 31.1, minLon: -87.7, maxLon: -79.9 };
function inRegion(lat, lon) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;
}
const FLORIDA_BOUNDS = L.latLngBounds(
  [BBOX.minLat, BBOX.minLon],
  [BBOX.maxLat, BBOX.maxLon]
);
// Source: U.S. Census Bureau TIGERweb, Florida state landmass geometry
const FLORIDA_STATE_COORDS = [[[[-80.18387,25.34818],[-80.1391,25.4331],[-80.09456,25.47567],[-80.11557,25.52666],[-80.09178,25.72111],[-80.06943,25.75736],[-80.05453,26.07312],[-79.98248,26.56925],[-79.97543,26.80025],[-80.0391,27.02985],[-80.22239,27.44696],[-80.33253,27.76116],[-80.49977,28.07723],[-80.544,28.27109],[-80.51943,28.39108],[-80.48121,28.42551],[-80.4686,28.46308],[-80.52297,28.60824],[-80.90684,29.14471],[-81.1864,29.76008],[-81.33063,30.29948],[-81.33538,30.36129],[-81.3169,30.40772],[-81.35357,30.44666],[-81.37767,30.54446],[-81.38087,30.62735],[-81.34702,30.71244],[-81.45124,30.70948],[-81.48846,30.72631],[-81.53229,30.72409],[-81.53839,30.70866],[-81.60188,30.72959],[-81.60987,30.71593],[-81.62437,30.73634],[-81.65215,30.72887],[-81.66232,30.75418],[-81.6831,30.74849],[-81.67249,30.73879],[-81.72013,30.74472],[-81.76172,30.7757],[-81.78263,30.76145],[-81.79307,30.78725],[-81.86851,30.79291],[-81.90124,30.82988],[-81.90911,30.81568],[-81.94964,30.82784],[-81.97364,30.77872],[-82.02288,30.78771],[-82.0116,30.76188],[-82.03677,30.75443],[-82.04561,30.72755],[-82.03593,30.7062],[-82.04902,30.6553],[-82.0054,30.5637],[-82.01691,30.47511],[-82.04376,30.41487],[-82.03722,30.37185],[-82.06618,30.35576],[-82.10524,30.3689],[-82.16178,30.35711],[-82.20673,30.40678],[-82.20124,30.48511],[-82.2404,30.53777],[-82.21468,30.56856],[-84.86469,30.71154],[-84.91432,30.75359],[-84.93742,30.82089],[-84.92567,30.84268],[-84.93442,30.88359],[-84.98313,30.93479],[-84.98113,30.96339],[-85.00573,30.97591],[-85.0019,31.00068],[-87.59883,30.99746],[-87.59093,30.95351],[-87.63474,30.86561],[-87.54543,30.77939],[-87.52998,30.74095],[-87.40647,30.67515],[-87.39491,30.61427],[-87.45037,30.51446],[-87.42508,30.4656],[-87.36694,30.44048],[-87.42958,30.4065],[-87.46108,30.3353],[-87.5047,30.32404],[-87.49998,30.3062],[-87.45008,30.3111],[-87.51838,30.2839],[-87.51837,30.12553],[-87.30281,30.1683],[-87.17692,30.17281],[-86.71348,30.24363],[-86.4456,30.23231],[-86.30638,30.2094],[-86.0055,30.10606],[-85.80356,29.97816],[-85.70979,29.93584],[-85.58962,29.83756],[-85.57717,29.74594],[-85.54274,29.64934],[-85.44822,29.53443],[-85.35451,29.50537],[-85.25967,29.52481],[-85.12957,29.45328],[-85.06032,29.43622],[-84.89636,29.47121],[-84.71055,29.55206],[-84.58868,29.64074],[-84.47452,29.68773],[-84.41995,29.74696],[-84.32327,29.74809],[-84.25923,29.76815],[-84.18998,29.83038],[-84.1608,29.92127],[-84.06492,29.94008],[-83.919,29.84194],[-83.83029,29.81972],[-83.7809,29.79004],[-83.70578,29.64405],[-83.58207,29.56332],[-83.56633,29.46484],[-83.53876,29.41449],[-83.35723,29.2917],[-83.33042,29.21186],[-83.26208,29.15572],[-83.25588,29.08179],[-83.19827,28.99505],[-83.0939,28.94744],[-83.00568,28.9468],[-82.94557,28.96375],[-82.94177,28.90683],[-82.9158,28.8565],[-82.9235,28.76713],[-82.87086,28.6216],[-82.83914,28.57458],[-82.89736,28.35701],[-82.97418,28.31574],[-83.01698,28.24645],[-82.99746,28.01275],[-83.02054,27.87831],[-82.99389,27.77767],[-82.91522,27.68413],[-82.93493,27.5837],[-82.90265,27.48104],[-82.8323,27.35572],[-82.67054,27.15444],[-82.59439,26.99023],[-82.44505,26.76463],[-82.42578,26.63809],[-82.32065,26.39675],[-82.27636,26.35102],[-82.16932,26.28846],[-82.08688,26.27195],[-82.00546,26.28443],[-81.96444,26.05361],[-81.87372,25.83412],[-81.76672,25.70025],[-81.68273,25.67277],[-81.57623,25.68604],[-81.51902,25.65694],[-81.4876,25.59205],[-81.42541,25.5516],[-81.3252,25.39062],[-81.31491,25.35155],[-81.3423,25.22483],[-81.29506,25.09793],[-81.17055,24.96577],[-81.25758,24.9866],[-81.48849,24.96635],[-81.89429,24.76365],[-82.02695,24.72572],[-82.10976,24.74711],[-82.20073,24.73817],[-82.28243,24.67624],[-82.3265,24.58373],[-82.21545,24.58376],[-82.21417,24.52742],[-82.16949,24.4977],[-82.10033,24.5],[-82.06717,24.52372],[-82.03427,24.4825],[-81.97441,24.47121],[-81.97447,24.42082],[-81.92056,24.39631],[-81.8007,24.42714],[-81.78181,24.46093],[-81.79236,24.49561],[-81.77081,24.49687],[-81.77369,24.47273],[-81.74981,24.43845],[-81.6972,24.43231],[-81.53992,24.48603],[-81.51988,24.51256],[-81.52785,24.55328],[-81.51461,24.56476],[-81.46509,24.55285],[-81.3748,24.57149],[-81.14769,24.64906],[-81.05974,24.63586],[-80.85223,24.74893],[-80.77109,24.76595],[-80.64043,24.83843],[-80.51434,24.94063],[-80.46289,24.95594],[-80.4391,24.99799],[-80.39966,25.02358],[-80.39043,25.05719],[-80.33332,25.0992],[-80.18387,25.34818]]],[[[-83.10874,24.62949],[-83.08256,24.53687],[-82.99988,24.47698],[-82.99974,24.58392],[-82.87207,24.56222],[-82.82818,24.58377],[-82.65668,24.58371],[-82.63991,24.65491],[-82.65508,24.71332],[-82.70978,24.77312],[-82.77567,24.79817],[-82.86889,24.79809],[-82.97906,24.77605],[-83.04111,24.74091],[-83.08845,24.69205],[-83.10874,24.62949]]]];
function tile2lon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function tileIntersectsFlorida(coords) {
  const north = tile2lat(coords.y, coords.z);
  const south = tile2lat(coords.y + 1, coords.z);
  const west = tile2lon(coords.x, coords.z);
  const east = tile2lon(coords.x + 1, coords.z);
  return !(
    east < BBOX.minLon ||
    west > BBOX.maxLon ||
    north < BBOX.minLat ||
    south > BBOX.maxLat
  );
}

function lonToTilePixel(lon, coords, tileSize) {
  const worldSize = Math.pow(2, coords.z) * tileSize;
  return ((lon + 180) / 360) * worldSize - coords.x * tileSize;
}

function latToTilePixel(lat, coords, tileSize) {
  const worldSize = Math.pow(2, coords.z) * tileSize;
  const latRad = lat * Math.PI / 180;
  const mercator = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return (worldSize / 2) - (worldSize * mercator / (2 * Math.PI)) - coords.y * tileSize;
}

function clipTileToFlorida(ctx, coords, tileSize) {
  ctx.beginPath();
  for (const polygon of FLORIDA_STATE_COORDS) {
    const ring = polygon[0];
    ring.forEach(([lon, lat], index) => {
      const x = lonToTilePixel(lon, coords, tileSize);
      const y = latToTilePixel(lat, coords, tileSize);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
  }
  ctx.clip();
}

function buildCartoBasemapUrl(coords) {
  const subdomains = ['a', 'b', 'c', 'd'];
  const subdomain = subdomains[Math.abs(coords.x + coords.y) % subdomains.length];
  return `https://${subdomain}.basemaps.cartocdn.com/dark_all/${coords.z}/${coords.x}/${coords.y}.png`;
}

function tileBounds3857(coords) {
  const nw = L.CRS.EPSG3857.project(L.latLng(tile2lat(coords.y, coords.z), tile2lon(coords.x, coords.z)));
  const se = L.CRS.EPSG3857.project(L.latLng(tile2lat(coords.y + 1, coords.z), tile2lon(coords.x + 1, coords.z)));
  return [nw.x, se.y, se.x, nw.y];
}

function buildRadarWmsUrl(coords, size) {
  const [minX, minY, maxX, maxY] = tileBounds3857(coords);
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    layers: 'radar_base_reflectivity_time',
    styles: 'default',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    width: String(size.x),
    height: String(size.y),
    bbox: `${minX},${minY},${maxX},${maxY}`,
    _: String(radarRefreshToken)
  });
  return `https://mapservices.weather.noaa.gov/eventdriven/services/radar/radar_base_reflectivity_time/ImageServer/WMSServer?${params.toString()}`;
}

function buildRainViewerTileUrl(coords) {
  if (!radarSource.host || !radarSource.path) return null;
  const z = Math.min(coords.z, RAINVIEWER_MAX_TILE_ZOOM);
  const scale = Math.pow(2, coords.z - z);
  const x = Math.floor(coords.x / scale);
  const y = Math.floor(coords.y / scale);
  return `${radarSource.host}${radarSource.path}/${RAINVIEWER_TILE_SIZE}/${z}/${x}/${y}/${RAINVIEWER_COLOR_SCHEME}/${RAINVIEWER_TILE_OPTIONS}.png`;
}

function drawRainViewerTile(ctx, img, coords, size) {
  const z = Math.min(coords.z, RAINVIEWER_MAX_TILE_ZOOM);
  if (coords.z <= z) {
    ctx.drawImage(img, 0, 0, size.x, size.y);
    return;
  }
  const scale = Math.pow(2, coords.z - z);
  const tileX = ((coords.x % scale) + scale) % scale;
  const tileY = ((coords.y % scale) + scale) % scale;
  const cropWidth = img.width / scale;
  const cropHeight = img.height / scale;
  ctx.drawImage(
    img,
    tileX * cropWidth,
    tileY * cropHeight,
    cropWidth,
    cropHeight,
    0,
    0,
    size.x,
    size.y
  );
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }
  return [h / 6, s, l];
}

function hueToRgb(p, q, t) {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255)
  ];
}

function recolorRainViewerTile(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (!alpha) continue;
    const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    // Shift RainViewer's blue/cyan light-rain band into green while preserving
    // the existing yellow/orange/red storm colors.
    if (s > 0.18 && h >= 0.47 && h <= 0.66) {
      const greenHue = 0.29 + ((h - 0.47) / 0.19) * 0.05;
      const [r, g, b] = hslToRgb(greenHue, Math.min(1, s * 1.05), l);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }
  ctx.putImageData(image, 0, 0);
}

async function refreshRadarSource(options = {}) {
  const { redraw = true } = options;
  if (!radarSourceRefreshInFlight) {
    radarSourceRefreshInFlight = (async () => {
      try {
        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`RainViewer metadata ${response.status}`);
        const data = await response.json();
        const latestFrame = data?.radar?.past?.at(-1);
        if (data?.host && latestFrame?.path) {
          radarSource = { provider: 'rainviewer', host: data.host, path: latestFrame.path };
          radarRefreshToken = data.generated || latestFrame.time || Date.now();
        } else {
          radarSource = { provider: 'noaa', host: '', path: '' };
          radarRefreshToken = Date.now();
        }
      } catch (err) {
        console.warn('RainViewer metadata unavailable, falling back to NOAA:', err);
        if (!radarSource.path) {
          radarSource = { provider: 'noaa', host: '', path: '' };
        }
        radarRefreshToken = Date.now();
      }
      return radarSource;
    })().finally(() => {
      radarSourceRefreshInFlight = null;
    });
  }
  const source = await radarSourceRefreshInFlight;
  if (redraw && radarLayer) radarLayer.redraw();
  return source;
}

// ── Map ───────────────────────────────────────────────────────────────────
const DEFAULT_CENTER = [28.5383, -81.49];
const DEFAULT_ZOOM = 12;
const map = L.map('map', {
  zoomControl: true
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
map.attributionControl.setPrefix(false);
map.getPane('popupPane').style.zIndex = 1405;

for (const cfg of Object.values(LAYER_PANES)) {
  map.createPane(cfg.name);
  const pane = map.getPane(cfg.name);
  pane.style.zIndex = cfg.zIndex;
  pane.classList.add('layer-intro-pane');
}
map.createPane(CAMERA_HOP_PANE.name);
const cameraHopPane = map.getPane(CAMERA_HOP_PANE.name);
cameraHopPane.style.zIndex = CAMERA_HOP_PANE.zIndex;
cameraHopPane.classList.add('layer-intro-pane', 'layer-intro-visible');

function layerPane(type) {
  return LAYER_PANES[type]?.name;
}

function revealLayerPane(type) {
  const pane = map.getPane(layerPane(type));
  if (pane) pane.classList.add('layer-intro-visible');
}

function playInitialLayerReveal() {
  if (introRevealPlayed) return;
  introRevealPlayed = true;
  const overlay = document.getElementById('map-loading');
  if (overlay) overlay.classList.add('hidden');
  scheduleStartupHintPulse();
  Object.entries(LAYER_PANES).forEach(([type, cfg]) => {
    setTimeout(() => revealLayerPane(type), cfg.delay);
  });
}

function finishInitialMapLoad() {
  if (initialLoaderSettled) return;
  initialLoaderSettled = true;
  const elapsed = performance.now() - introStartedAt;
  const delay = Math.max(0, 550 - elapsed);
  setTimeout(playInitialLayerReveal, delay);
}

const overviewHintControl = L.control({ position: 'bottomleft' });
overviewHintControl.onAdd = () => {
  const div = L.DomUtil.create('div', 'overview-hint');
  div.style.display = 'block';
  div.innerHTML = 'Zoom Out To Look Around Florida.';
  div.classList.add('startup-hint');
  div.classList.add('clickable');
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.setAttribute('aria-label', 'Zoom out to look around Florida');
  div.title = 'Zoom out to look around Florida';
  const activate = (event) => {
    if (!div.classList.contains('startup-hint') || startupHintDismissed) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    dismissStartupHint();
    map.flyTo(map.getCenter(), Math.max(map.getZoom() - 2, 8), { duration: 0.55 });
  };
  div.addEventListener('click', activate);
  div.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') activate(event);
  });
  return div;
};
overviewHintControl.addTo(map);

function setStartupHintInteractive(enabled) {
  const hint = overviewHintControl.getContainer();
  if (!hint) return;
  hint.classList.toggle('clickable', enabled);
  if (enabled) {
    hint.setAttribute('role', 'button');
    hint.setAttribute('tabindex', '0');
    hint.setAttribute('aria-label', 'Zoom out to look around Florida');
    hint.title = 'Zoom out to look around Florida';
  } else {
    hint.removeAttribute('role');
    hint.setAttribute('tabindex', '-1');
    hint.removeAttribute('aria-label');
    hint.removeAttribute('title');
  }
}

function showStartupHint() {
  const hint = overviewHintControl.getContainer();
  if (!hint || startupHintDismissed) return;
  hint.style.display = 'block';
  hint.innerHTML = 'Zoom Out To Look Around Florida.';
  hint.classList.remove('fading');
  hint.classList.add('startup-hint');
  setStartupHintInteractive(true);
  if (!startupHintDismissTimer) {
    startupHintDismissTimer = setTimeout(() => {
      startupHintDismissTimer = null;
      dismissStartupHint();
    }, STARTUP_HINT_AUTO_DISMISS_MS);
  }
}

function scheduleStartupHintPulse() {
  if (startupHintDismissed || startupHintPulsePlayed || startupHintPulseTimer) return;
  startupHintPulseTimer = setTimeout(() => {
    startupHintPulseTimer = null;
    if (startupHintDismissed || startupHintPulsePlayed) return;
    const hint = overviewHintControl.getContainer();
    if (!hint) return;
    startupHintPulsePlayed = true;
    hint.classList.remove('pulsing');
    void hint.offsetWidth;
    hint.classList.add('pulsing');
  }, STARTUP_HINT_PULSE_DELAY_MS);
}

function dismissStartupHint() {
  if (startupHintDismissed) return;
  startupHintDismissed = true;
  const hint = overviewHintControl.getContainer();
  if (!hint) return;
  if (startupHintPulseTimer) {
    clearTimeout(startupHintPulseTimer);
    startupHintPulseTimer = null;
  }
  if (startupHintDismissTimer) {
    clearTimeout(startupHintDismissTimer);
    startupHintDismissTimer = null;
  }
  hint.classList.remove('pulsing');
  hint.classList.add('fading');
  setTimeout(() => {
    hint.classList.remove('startup-hint', 'fading');
    setStartupHintInteractive(false);
    updateOverviewHint();
  }, 360);
}

['click', 'dragstart', 'zoomstart'].forEach(eventName => {
  map.on(eventName, () => {
    dismissStartupHint();
    if (mobileHeaderMenuOpen) toggleMobileHeaderMenu(false);
  });
});

showStartupHint();

map.createPane('radar-pane');
map.getPane('radar-pane').style.zIndex = 1200;
map.getPane('radar-pane').style.pointerEvents = 'none';
map.getPane('radar-pane').style.opacity = '0.72';

const FloridaBasemapLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    if (!tileIntersectsFlorida(coords)) {
      done(null, tile);
      return tile;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = tile.getContext('2d');
      ctx.save();
      clipTileToFlorida(ctx, coords, tile.width);
      ctx.drawImage(img, 0, 0, tile.width, tile.height);
      ctx.restore();
      done(null, tile);
    };
    img.onerror = () => done(null, tile);
    img.src = buildCartoBasemapUrl(coords);
    return tile;
  }
});

const basemapLayer = new FloridaBasemapLayer({
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19,
  bounds: FLORIDA_BOUNDS,
  noWrap: true
}).addTo(map);

// Traffic flow tile layer — canvas layer that drops green (free-flow) pixels,
// keeping only orange/red (congested) segments.
const CanvasFlowLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    if (!tileIntersectsFlorida(coords)) {
      done(null, tile);
      return tile;
    }
    const url = `/tile?x=${coords.x}&y=${coords.y}&z=${coords.z}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = tile.getContext('2d');
      ctx.save();
      clipTileToFlorida(ctx, coords, tile.width);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      const d = ctx.getImageData(0, 0, tile.width, tile.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i+1], b = px[i+2], a = px[i+3];
        if (a < 10) continue;
        // FL511 tile colors:
        //   free-flow teal-green ≈ (36, 157, 116) — suppress
        //   slow yellow          ≈ (244, 255, 36)  — suppress (not congested)
        //   congested orange/red ≈ high r, low-mid g, low b — keep
        const isTealGreen = r < 80 && g > 100;            // free-flow
        const isYellow    = r > 150 && g > 150 && b < 80; // slow
        if (isTealGreen) {
          px[i+3] = Math.round(a * 0.30); // muted — camera circles stay dominant
        } else if (isYellow) {
          px[i+3] = Math.round(a * 0.45);
        } else {
          px[i+3] = Math.round(a * 0.90); // orange/red congestion at full weight
        }
      }
      ctx.putImageData(d, 0, 0);
      done(null, tile);
    };
    img.onerror = () => done(null, tile);
    img.src = url;
    return tile;
  }
});
const flowLayer = new CanvasFlowLayer({
  maxZoom: 19,
  zIndex: 2,
  bounds: FLORIDA_BOUNDS
}).addTo(map);
flowLayer.on('load', () => markLayerFresh('flow'));

const WeatherRadarLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    if (!tileIntersectsFlorida(coords)) {
      done(null, tile);
      return tile;
    }

    const drawFromUrl = (url, drawImage) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ctx = tile.getContext('2d');
        ctx.save();
        clipTileToFlorida(ctx, coords, tile.width);
        drawImage(ctx, img);
        ctx.restore();
        done(null, tile);
      };
      img.onerror = () => {
        if (url === buildRadarWmsUrl(coords, size)) {
          done(null, tile);
          return;
        }
        drawFromUrl(buildRadarWmsUrl(coords, size), (ctx, fallbackImg) => {
          ctx.drawImage(fallbackImg, 0, 0, tile.width, tile.height);
        });
      };
      img.src = url;
    };

    const rainViewerUrl = buildRainViewerTileUrl(coords);
    if (rainViewerUrl) {
      drawFromUrl(rainViewerUrl, (ctx, img) => {
        drawRainViewerTile(ctx, img, coords, size);
        recolorRainViewerTile(ctx, tile.width, tile.height);
      });
      return tile;
    }

    drawFromUrl(buildRadarWmsUrl(coords, size), (ctx, img) => {
      ctx.drawImage(img, 0, 0, tile.width, tile.height);
    });
    return tile;
  }
});

const radarLayer = new WeatherRadarLayer({
  pane: 'radar-pane',
  attribution: 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a> / NOAA NWS',
  maxZoom: 19,
  bounds: FLORIDA_BOUNDS,
  noWrap: true
});
radarLayer.on('load', () => markLayerFresh('radar'));

const initialRadarSourcePromise = refreshRadarSource({ redraw: false });
initialRadarSourcePromise.finally(() => {
  if (layerVisible.radar) radarLayer.addTo(map);
});

let currentIncidentCount = 0;
let currentConstructionCount = 0;

function updateEventStat() {
  const el = document.getElementById('stat-inc');
  if (el) el.textContent = `${currentIncidentCount + currentConstructionCount} events`;
}

function refreshFlowLayer() {
  flowLayer.redraw();
}

// ── Load all layers ───────────────────────────────────────────────────────
async function loadAll() {
  const emergencyPromise = loadEmergency();
  const baseLayersPromise = Promise.all([loadCameras(), loadSigns(), loadIncidents(), loadConstruction(), loadPowerOutages()]);
  baseLayersPromise
    .then(() => finishInitialMapLoad())
    .catch(() => finishInitialMapLoad());
  setTimeout(() => finishInitialMapLoad(), INITIAL_LOADER_MAX_WAIT_MS);
  loadAircraft();
  setInterval(loadAircraft, 30000); // 30s poll — adsb.lol has no rate limit
  setInterval(loadEmergency, 60000);
  setInterval(loadSigns, SIGN_REFRESH_INTERVAL_MS);
  setInterval(loadSensors, SENSOR_REFRESH_INTERVAL_MS);
  setInterval(loadIncidents, INCIDENT_REFRESH_INTERVAL_MS);
  setInterval(loadConstruction, CONSTRUCTION_REFRESH_INTERVAL_MS);
  setInterval(loadPowerOutages, POWER_REFRESH_INTERVAL_MS);
  setInterval(loadTemperatureStations, TEMPERATURE_REFRESH_INTERVAL_MS);
  setInterval(refreshFlowLayer, FLOW_REFRESH_INTERVAL_MS);
  setInterval(refreshRadarSource, RADAR_REFRESH_INTERVAL_MS);
  setInterval(renderFreshnessPanel, LIVE_STATUS_RENDER_INTERVAL_MS);
  loadSensors();
  loadLPR();
  loadTemperatureStations();
  await Promise.allSettled([baseLayersPromise, emergencyPromise]);
}

async function loadCameras() {
  const d = await fetch('/fl511/Cameras').then(r => r.json());
  const items = d.item2 || [];
  const data = items.map(c => ({
    id:           c.itemId,
    lat:          c.location[0],
    lon:          c.location[1],
    rawName:      c.title || '',
    name:         humanizeCameraName(c.title || '', c.itemId),
    desc:         '',
    nameResolved: Boolean((c.title || '').trim()),
    video_enabled: c.expando?.videoEnabled ?? false,
    video_url:    '',
    snapshot_url: `https://fl511.com/map/Cctv/${c.itemId}`
  }));
  allCameras = data;
  filteredCameras = data;
  const camStat = document.getElementById('stat-cam');
  if (camStat) camStat.textContent = `${data.length} cams`;
  renderCamMarkers(data);
  scheduleVisibleCameraNameWarm();
}

async function loadSigns() {
  const d = await fetch('/fl511/MessageSigns').then(r => r.json());
  const items = d.item2 || [];
  const previousById = new Map(allSigns.map(sign => [sign.id, sign]));
  const signStat = document.getElementById('stat-sign');
  if (signStat) signStat.textContent = `${items.length} signs`;
  allSigns = items.filter(s => s.location).map(s => ({
      id: s.itemId,
      lat: s.location[0],
      lon: s.location[1],
      name: previousById.get(s.itemId)?.name || s.title || '',
      msg: previousById.get(s.itemId)?.msg ?? null,
      timestamp: previousById.get(s.itemId)?.timestamp ?? null,
      timeMs: previousById.get(s.itemId)?.timeMs ?? null
    }));
  scheduleDenseLayerRefresh();
  scheduleVisibleSignDetailRefresh(true);
}

async function loadIncidents() {
  const [incData, dvData] = await Promise.all([
    fetch('/fl511/Incidents').then(r => r.json()),
    fetch('/fl511/DisabledVehicles').then(r => r.json())
  ]);
  const incidents = (incData.item2 || []);
  const dvs       = (dvData.item2 || []);
  const seen = new Set();
  incidents.forEach(i => {
    if (!i.location) return;
    seen.add(i.itemId);
    incidentFeedEntries.set(`inc:${i.itemId}`, {
      key: `inc:${i.itemId}`,
      id: i.itemId,
      kind: 'incident',
      feedLabel: 'Incident',
      title: 'Incident',
      lat: i.location[0],
      lon: i.location[1],
      layer: 'Incidents',
      timeMs: null,
      orderId: Number(i.itemId) || 0,
      detailLoaded: false,
      severity: null,
      location: null
    });
    addIncMarker({ id: i.itemId, lat: i.location[0], lon: i.location[1], type: 'Incident', layer: 'Incidents' });
  });
  dvs.forEach(i => {
    if (!i.location) return;
    seen.add(i.itemId);
    incidentFeedEntries.set(`inc:${i.itemId}`, {
      key: `inc:${i.itemId}`,
      id: i.itemId,
      kind: 'incident',
      feedLabel: 'Disabled Vehicle',
      title: 'Disabled Vehicle',
      lat: i.location[0],
      lon: i.location[1],
      layer: 'DisabledVehicles',
      timeMs: null,
      orderId: Number(i.itemId) || 0,
      detailLoaded: false,
      severity: null,
      location: null
    });
    addIncMarker({ id: i.itemId, lat: i.location[0], lon: i.location[1], type: 'DisabledVehicles', layer: 'DisabledVehicles' });
  });
  for (const [id, marker] of incMarkers) {
    if (!seen.has(id)) {
      map.removeLayer(marker);
      incMarkers.delete(id);
    }
  }
  for (const key of Array.from(incidentFeedEntries.keys())) {
    if (!seen.has(key.replace(/^inc:/, ''))) incidentFeedEntries.delete(key);
  }
  currentIncidentCount = incidents.length + dvs.length;
  updateEventStat();
  markLayerFresh('inc');
  renderActivityFeed();
}

async function loadConstruction() {
  const data = await fetch('/fl511/Construction').then(r => r.json());
  const cons = data.item2 || [];
  const seen = new Set();
  cons.forEach(c => {
    if (!c.location) return;
    seen.add(c.itemId);
    addConMarker({ id: c.itemId, lat: c.location[0], lon: c.location[1], layer: 'Construction' });
  });
  for (const [id, marker] of conMarkers) {
    if (!seen.has(id)) {
      map.removeLayer(marker);
      conMarkers.delete(id);
    }
  }
  currentConstructionCount = cons.length;
  updateEventStat();
  markLayerFresh('con');
}

const POWER_PROVIDER_COLORS = {
  duke: '#58a6ff',
  teco: '#f0883e',
  jea: '#3fb950',
  lakeland: '#a371f7',
  ouc: '#f2cc60'
};

function powerProviderColor(providerKey) {
  return POWER_PROVIDER_COLORS[providerKey] || '#f778ba';
}

function powerMarkerRadius(customersAffected) {
  const count = Math.max(1, Number(customersAffected) || 1);
  return Math.max(6, Math.min(18, 5 + Math.log10(count + 1) * 4.2));
}

function formatPowerPopupValue(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  return value;
}

function buildPowerPopupHtml(props) {
  const countText = `${Number(props.customers_affected || 0).toLocaleString()} affected`;
  const outagesText = props.outages ? `${Number(props.outages).toLocaleString()} outage${Number(props.outages) === 1 ? '' : 's'}` : null;
  const detailText = [props.status, props.reason].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <div class="popup-inner">
      <div class="popup-type power">Power Outage</div>
      <div class="popup-name">${escapeHtml(props.provider || 'Utility Outage')}</div>
      <div class="popup-msg" style="font-family:inherit;font-size:12px">
        ${escapeHtml(props.area_name || 'Florida outage area')}<br>${countText}${outagesText ? `<br>${outagesText}` : ''}
      </div>
      ${detailText ? `<div class="popup-meta">${detailText}</div>` : ''}
      ${props.etr ? `<div class="popup-meta">ETR: ${escapeHtml(formatPowerPopupValue(props.etr))}</div>` : ''}
      ${props.start_time ? `<div class="popup-meta">Started: ${escapeHtml(formatPowerPopupValue(props.start_time))}</div>` : ''}
    </div>`;
}

function createPowerLayer(feature) {
  const props = feature.properties || {};
  const color = powerProviderColor(props.provider_key);
  const count = Number(props.customers_affected) || 0;
  const layer = L.geoJSON(feature, {
    pane: layerPane('power'),
    style: () => ({
      color,
      weight: 1.8,
      opacity: 0.95,
      fillColor: color,
      fillOpacity: Math.min(0.42, 0.18 + Math.log10(Math.max(1, count) + 1) * 0.08)
    }),
    pointToLayer: (_feat, latlng) => L.circleMarker(latlng, {
      pane: layerPane('power'),
      radius: powerMarkerRadius(count),
      color: '#ffffff',
      weight: 1.4,
      fillColor: color,
      fillOpacity: 0.9
    })
  });
  layer.bindPopup(buildPowerPopupHtml(props));
  return layer;
}

async function loadPowerOutages() {
  try {
    const geojson = await fetch('/power-outages').then(r => r.json());
    clearMarkerMap(powerLayers);
    powerFeedEntries.clear();
    (geojson.features || []).forEach(feature => {
      const key = feature?.properties?.key;
      if (!key || !feature?.geometry) return;
      const layer = createPowerLayer(feature);
      const props = feature.properties || {};
      const layerBounds = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
      const center = layerBounds && typeof layerBounds.isValid === 'function' && layerBounds.isValid()
        ? layerBounds.getCenter()
        : null;
      powerLayers.set(key, layer);
      powerFeedEntries.set(key, {
        key,
        id: key,
        kind: 'power',
        title: props.provider || 'Power Outage',
        provider: props.provider || 'Utility Outage',
        lat: center?.lat ?? null,
        lon: center?.lng ?? null,
        location: props.area_name || 'Florida outage area',
        customersAffectedText: `${Number(props.customers_affected || 0).toLocaleString()} affected`,
        outagesText: props.outages ? `${Number(props.outages).toLocaleString()} outage${Number(props.outages) === 1 ? '' : 's'}` : null,
        status: props.status || null,
        reason: props.reason || null,
        timeMs: parseEventTimeMs(props.updated_at || props.start_time || props.etr),
        timeText: formatPowerPopupValue(props.updated_at || props.start_time || props.etr),
        orderId: Number(props.customers_affected || 0)
      });
      if (layerVisible.power && denseLayerMode('power', powerLayers.size).kind !== 'hidden') layer.addTo(map);
    });
    markLayerFresh('power');
    renderActivityFeed();
  } catch (e) {
    console.warn('Power outage load failed:', e);
  }
}

loadAll();

function clearMarkerMap(markerMap) {
  for (const [, marker] of markerMap) map.removeLayer(marker);
  markerMap.clear();
}

function denseItemsInView(items) {
  const bounds = map.getBounds().pad(0.18);
  return items.filter(item => bounds.contains([item.lat, item.lon]));
}

function cameraDirectionText(token) {
  const upper = String(token || '').trim().toUpperCase();
  return {
    N: 'Northbound',
    S: 'Southbound',
    E: 'Eastbound',
    W: 'Westbound',
    NB: 'Northbound',
    SB: 'Southbound',
    EB: 'Eastbound',
    WB: 'Westbound'
  }[upper] || '';
}

function cameraFriendlyToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  const directMap = {
    TPKE: 'Turnpike',
    TPK: 'Turnpike',
    TPASS: 'Toll Plaza',
    CO: 'County',
    RD: 'Rd',
    AVE: 'Ave',
    BLVD: 'Blvd',
    DR: 'Dr',
    PKWY: 'Pkwy',
    HWY: 'Hwy',
    EXPY: 'Expy',
    ST: 'St'
  };
  if (directMap[upper]) return directMap[upper];
  const usMatch = upper.match(/^US(\d+[A-Z]?)$/);
  if (usMatch) return `US ${usMatch[1]}`;
  const srMatch = upper.match(/^SR-?(\d+[A-Z]?)$/);
  if (srMatch) return `SR ${srMatch[1]}`;
  const crMatch = upper.match(/^CR-?(\d+[A-Z]?)$/);
  if (crMatch) return `CR ${crMatch[1]}`;
  const iMatch = upper.match(/^I-?(\d+[A-Z]?)$/);
  if (iMatch) return `I-${iMatch[1]}`;
  if (/^\d+$/.test(raw)) return raw.replace(/^0+(?=\d)/, '');
  if (/^[A-Z]{2,6}$/.test(raw)) return raw;
  return raw
    .split(/([&/-])/)
    .map(part => {
      if (!part || /^[&/-]$/.test(part)) return part;
      if (/^\d+$/.test(part)) return part.replace(/^0+(?=\d)/, '');
      if (/^[A-Z]{2,6}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function humanizeCameraName(raw, fallbackId = '') {
  const label = String(raw || '').replace(/&amp;/gi, '&').trim();
  if (!label) return 'Traffic Camera';

  if (!label.includes('_')) {
    return label
      .replace(/\bTpke\b/gi, 'Turnpike')
      .replace(/\bMP\b/gi, 'MM')
      .replace(/\bNB\b/g, 'Northbound')
      .replace(/\bSB\b/g, 'Southbound')
      .replace(/\bEB\b/g, 'Eastbound')
      .replace(/\bWB\b/g, 'Westbound')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const parts = label.split('_').filter(Boolean);
  let direction = '';
  if (parts.length > 1) {
    const firstDir = parts[0].match(/^\d+([NSEW])$/i);
    if (firstDir) {
      direction = cameraDirectionText(firstDir[1]);
      parts.shift();
    }
  }
  if (parts.length > 1 && /^\d+$/.test(parts[0])) {
    parts[0] = `I-${parts[0].replace(/^0+(?=\d)/, '')}`;
  }

  const words = [];
  let mileMarker = '';
  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i];
    const upper = token.toUpperCase();
    if ((upper === 'SR' || upper === 'US' || upper === 'CR') && /^\d+[A-Z]?$/i.test(parts[i + 1] || '')) {
      words.push(`${upper} ${String(parts[i + 1]).replace(/^0+(?=\d)/, '')}`);
      i += 1;
      continue;
    }
    if (/^[NSEW]\/O$/i.test(upper)) {
      words.push({
        'N/O': 'North Of',
        'S/O': 'South Of',
        'E/O': 'East Of',
        'W/O': 'West Of'
      }[upper] || upper);
      continue;
    }
    const markerMatch = upper.match(/^M(P)?(\d+(?:\.\d+)?)$/);
    if (markerMatch) {
      mileMarker = `MM ${markerMatch[2]}`;
      continue;
    }
    const tokenDirection = cameraDirectionText(upper);
    if (tokenDirection) {
      direction = direction || tokenDirection;
      continue;
    }
    words.push(cameraFriendlyToken(token));
  }

  let friendly = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (mileMarker) friendly = friendly ? `${friendly} · ${mileMarker}` : mileMarker;
  if (direction) friendly = friendly ? `${friendly} · ${direction}` : direction;
  return friendly || 'Traffic Camera';
}

function cameraDisplayName(cam) {
  return humanizeCameraName(cam?.name || cam?.rawName || '', cam?.id || '');
}

function refreshSelectedCameraMeta(cam) {
  document.getElementById('cam-name').textContent = cameraDisplayName(cam);
  document.getElementById('cam-desc').textContent = cam.desc || '';
}

async function hydrateCameraName(cam, options = {}) {
  const { force = false } = options;
  if (!cam) return cam;
  if (!force && cam.nameResolved && cam.name) return cam;
  if (!force && cameraNameRequests.has(cam.id)) return cameraNameRequests.get(cam.id);

  const request = (async () => {
    const info = await fetchFL511Tooltip('Cameras', cam.id, { force });
    const raw = (info?.name || info?.msg || cam.rawName || '').trim();
    if (raw) {
      cam.rawName = raw;
      cam.name = humanizeCameraName(raw, cam.id);
    }
    cam.nameResolved = true;
    if (selectedId === cam.id) refreshSelectedCameraMeta(cam);
    if (selectedId) {
      const selectedCam = allCameras.find(item => item.id === selectedId);
      if (selectedCam) populateNearby(selectedCam);
      renderCameraHopHud();
    }
    scheduleDenseLayerRefresh();
    return cam;
  })().finally(() => {
    cameraNameRequests.delete(cam.id);
  });

  cameraNameRequests.set(cam.id, request);
  return request;
}

function scheduleVisibleCameraNameWarm() {
  if (cameraNameWarmQueued) return;
  cameraNameWarmQueued = true;
  setTimeout(() => {
    cameraNameWarmQueued = false;
    denseItemsInView(filteredCameras)
      .slice(0, CAMERA_NAME_WARM_LIMIT)
      .forEach(cam => {
        if (!cam.nameResolved || !cam.name) hydrateCameraName(cam);
      });
  }, 180);
}

function cameraHopDirectionForId(id) {
  if (!cameraHopModeActive()) return '';
  for (const [direction, cam] of Object.entries(cameraHopOptions)) {
    if (cam?.id === id) return direction;
  }
  return '';
}

function cameraHopModeActive() {
  return Boolean(selectedId && isDesktopPanelLayout() && !panelCollapsed);
}

function cameraMarkerPaneForId(id) {
  if (!cameraHopModeActive()) return layerPane('cam');
  if (id === selectedId) return CAMERA_HOP_PANE.name;
  return cameraHopDirectionForId(id) ? CAMERA_HOP_PANE.name : layerPane('cam');
}

function shouldShowCameraHopHud() {
  return cameraHopModeActive();
}

function computeCameraHopOptions(cam) {
  if (!cam) return { up: null, down: null, left: null, right: null };
  const latScale = Math.cos((cam.lat * Math.PI) / 180);
  const ranked = { up: [], down: [], left: [], right: [] };

  for (const other of filteredCameras) {
    if (!other || other.id === cam.id) continue;
    const dx = (other.lon - cam.lon) * latScale;
    const dy = other.lat - cam.lat;
    const dist2 = dx * dx + dy * dy;
    if (!dist2) continue;

    if (dy > 0 && dy >= Math.abs(dx)) ranked.up.push({ camera: other, dist2 });
    if (dy < 0 && -dy >= Math.abs(dx)) ranked.down.push({ camera: other, dist2 });
    if (dx < 0 && -dx > Math.abs(dy)) ranked.left.push({ camera: other, dist2 });
    if (dx > 0 && dx > Math.abs(dy)) ranked.right.push({ camera: other, dist2 });
  }

  return Object.fromEntries(
    Object.entries(ranked).map(([direction, items]) => {
      items.sort((a, b) => a.dist2 - b.dist2);
      return [direction, items[0]?.camera || null];
    })
  );
}

function renderCameraHopHud() {
  const hud = document.getElementById('camera-hop-hud');
  if (!hud) return;
  if (!shouldShowCameraHopHud()) {
    hud.classList.remove('active');
    hud.innerHTML = '';
    return;
  }

  const current = allCameras.find(cam => cam.id === selectedId);
  if (!current) {
    hud.classList.remove('active');
    hud.innerHTML = '';
    return;
  }

  const cells = ['up', 'left', 'down', 'right'].map((direction) => {
    const cam = cameraHopOptions[direction];
    const meta = CAMERA_HOP_LABELS[direction];
    if (!cam) {
      return `<div class="camera-hop-cell empty"><div class="camera-hop-key">${meta.arrow} ${meta.text}</div><div class="camera-hop-label">No Camera</div></div>`;
    }
    return `<div class="camera-hop-cell"><div class="camera-hop-key">${meta.arrow} ${meta.text}</div><div class="camera-hop-label">${escapeHtml(cameraDisplayName(cam))}</div></div>`;
  }).join('');

  const enterHint = current.video_enabled ? 'Enter To Open Live Video' : 'Enter To Refresh Snapshot';
  hud.innerHTML = `
    <div class="camera-hop-card">
      <div class="camera-hop-current">${escapeHtml(cameraDisplayName(current))}</div>
      <div class="camera-hop-grid">${cells}</div>
      <div class="camera-hop-footer">Arrow Keys Jump Between Cameras · ${enterHint}</div>
    </div>`;
  hud.classList.add('active');
}

function syncCameraHopState() {
  const current = allCameras.find(cam => cam.id === selectedId);
  cameraHopOptions = (current && cameraHopModeActive())
    ? computeCameraHopOptions(current)
    : { up: null, down: null, left: null, right: null };
  const nextHopMarkerIds = new Set();
  if (current && cameraHopModeActive()) {
    nextHopMarkerIds.add(current.id);
    Object.values(cameraHopOptions).forEach(cam => {
      if (cam?.id) nextHopMarkerIds.add(cam.id);
    });
  }
  const markerIdsToRefresh = new Set([...cameraHopMarkerIds, ...nextHopMarkerIds]);
  cameraHopMarkerIds = nextHopMarkerIds;
  Object.values(cameraHopOptions).forEach(cam => {
    if (cam && (!cam.nameResolved || !cam.name)) hydrateCameraName(cam);
  });
  markerIdsToRefresh.forEach(id => syncCameraMarkerPresentation(id));
  renderCameraHopHud();
  scheduleDenseLayerRefresh();
}

function cameraKeyboardNavigationAllowed() {
  const active = document.activeElement;
  if (!active) return true;
  const tag = active.tagName;
  if (active.isContentEditable) return false;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return false;
  if (tag === 'VIDEO' || tag === 'AUDIO') return false;
  return true;
}

function handleCameraHopKey(event) {
  if (!cameraHopModeActive() || !cameraKeyboardNavigationAllowed()) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const keyMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right'
  };
  const direction = keyMap[event.key];
  if (direction) {
    const nextCam = cameraHopOptions[direction];
    if (!nextCam) return;
    event.preventDefault();
    selectCamera(nextCam.id);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    const current = allCameras.find(cam => cam.id === selectedId);
    if (!current) return;
    if (current.video_enabled) showLive();
    else showSnapshot();
  }
}

function denseLayerCount(type) {
  if (type === 'cam') return filteredCameras.length;
  if (type === 'sign') return allSigns.length;
  if (type === 'lpr') return allLpr.length;
  if (type === 'sens') return allSensors.length;
  if (type === 'con') return conMarkers.size;
  if (type === 'power') return powerLayers.size;
  if (type === 'temp') return allTempStations.length;
  return 0;
}

function denseLayerMode(type, count) {
  const zoom = map.getZoom();
  const minZoom = DENSE_LAYER_MIN_ZOOM[type] ?? 11;
  if (zoom < minZoom && !denseLayerZoomOverride[type]) return { kind: 'hidden' };
  return { kind: 'raw' };
}

function denseLayerAutoHidden(type) {
  return layerVisible[type] && denseLayerMode(type, denseLayerCount(type)).kind === 'hidden';
}

function incidentLayerAutoHidden() {
  return (layerVisible.inc || layerVisible.emer) && map.getZoom() < INCIDENT_LAYER_MIN_ZOOM && !incidentLayerZoomOverride;
}

function incidentLayerMarkersVisible(type) {
  if (type === 'emer') return layerVisible.emer && !incidentLayerAutoHidden();
  return layerVisible.inc && !incidentLayerAutoHidden();
}

function syncIncidentLayerVisibility() {
  const showInc = incidentLayerMarkersVisible('inc');
  const showEmer = incidentLayerMarkersVisible('emer');
  for (const [, marker] of incMarkers) {
    if (showInc) marker.addTo(map); else map.removeLayer(marker);
  }
  for (const [key, marker] of emerMarkers) {
    const t = emerMarkerTypes.get(key) || 'warning';
    if (showEmer && emerTypeVisible[t]) marker.addTo(map); else map.removeLayer(marker);
  }
  refreshLayerToggleButtons();
}

function layerButtonActive(type) {
  if (type === 'inc') {
    return (layerVisible.inc || layerVisible.emer) && !incidentLayerAutoHidden();
  }
  if (DENSE_LAYER_KEYS.has(type)) {
    return layerVisible[type] && !denseLayerAutoHidden(type);
  }
  return layerVisible[type];
}

function refreshLayerToggleButtons() {
  Object.keys(layerVisible).forEach(type => {
    const btn = document.querySelector(`.layer-btn.${type}`);
    if (btn) btn.classList.toggle('active', layerButtonActive(type));
  });
  syncMapKeyCheckboxes();
}

function isLayerZoomGated(layer) {
  if (!layerVisible[layer]) return false; // user turned it off — not zoom-gated, just off
  if (DENSE_LAYER_KEYS.has(layer)) return denseLayerAutoHidden(layer);
  if (layer === 'inc' || layer === 'emer') return incidentLayerAutoHidden();
  return false;
}

function syncMapKeyCheckboxes() {
  document.querySelectorAll('#map-key-body .key-cb[data-layer]').forEach(cb => {
    const layer = cb.dataset.layer;
    cb.checked = !!layerVisible[layer];
    const row = cb.closest('.key-row');
    if (!row) return;
    const gated = isLayerZoomGated(layer);
    row.classList.toggle('zoom-gated', gated && cb.checked);
    let badge = row.querySelector('.key-zoom-badge');
    if (gated && cb.checked) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'key-zoom-badge';
        badge.textContent = 'zoom in';
        row.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  });
  document.querySelectorAll('#map-key-body .key-cb[data-emer-type]').forEach(cb => {
    cb.checked = !!emerTypeVisible[cb.dataset.emerType];
    const row = cb.closest('.key-row');
    if (!row) return;
    // emer sub-types inherit the emer layer zoom state
    const gated = isLayerZoomGated('emer');
    row.classList.toggle('zoom-gated', gated && cb.checked);
    let badge = row.querySelector('.key-zoom-badge');
    if (gated && cb.checked) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'key-zoom-badge';
        badge.textContent = 'zoom in';
        row.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  });
}

function toggleEmerType(type) {
  emerTypeVisible[type] = !emerTypeVisible[type];
  syncIncidentLayerVisibility();
  syncMapKeyCheckboxes();
}

function aggregateDenseItems(items, cellPx) {
  const zoom = map.getZoom();
  const clusters = new Map();
  items.forEach(item => {
    const pt = map.project([item.lat, item.lon], zoom);
    const key = `${Math.floor(pt.x / cellPx)}:${Math.floor(pt.y / cellPx)}`;
    if (!clusters.has(key)) {
      clusters.set(key, { items: [], latSum: 0, lonSum: 0 });
    }
    const cluster = clusters.get(key);
    cluster.items.push(item);
    cluster.latSum += item.lat;
    cluster.lonSum += item.lon;
  });
  return Array.from(clusters.entries()).map(([key, cluster]) => ({
    key,
    count: cluster.items.length,
    items: cluster.items,
    lat: cluster.latSum / cluster.items.length,
    lon: cluster.lonSum / cluster.items.length,
  }));
}

function formatDenseCount(count) {
  return count > 99 ? '99+' : String(count);
}

function denseClusterIcon(type, count) {
  const size = Math.max(30, Math.min(54, 28 + Math.round(Math.log2(count + 1) * 7)));
  return L.divIcon({
    className: '',
    html: `<div class="dense-cluster ${type}" style="width:${size}px;height:${size}px"><span>${formatDenseCount(count)}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function denseClusterPopup(type, cluster) {
  if (type === 'cam') {
    const preview = cluster.items.slice(0, 4).map(item => escapeHtml(cameraDisplayName(item)));
    return `
    <div class="popup-inner">
      <div class="popup-type cam">${cluster.count} Cameras</div>
      <div class="popup-msg" style="font-family:inherit;font-size:12px">${preview.join('<br>')}</div>
      ${cluster.count > preview.length ? `<div class="popup-meta">+${cluster.count - preview.length} more</div>` : ''}
      <div class="popup-meta">Zoom in for individual cameras</div>
    </div>`;
  }
  if (type === 'lpr') {
    const preview = cluster.items.slice(0, 4).map(item => escapeHtml(item.operator || 'License Plate Reader'));
    return `
    <div class="popup-inner">
      <div class="popup-type lpr">${cluster.count} Plate Readers</div>
      <div class="popup-msg" style="font-family:inherit;font-size:12px">${preview.join('<br>')}</div>
      ${cluster.count > preview.length ? `<div class="popup-meta">+${cluster.count - preview.length} more</div>` : ''}
      <div class="popup-meta">Zoom in for individual plate readers</div>
    </div>`;
  }
  if (type === 'sign') {
    const preview = cluster.items.slice(0, 4).map(item => escapeHtml(item.name || 'Message Sign'));
    return `
    <div class="popup-inner">
      <div class="popup-type sign">${cluster.count} Message Signs</div>
      <div class="popup-msg" style="font-family:inherit;font-size:12px">${preview.join('<br>')}</div>
      ${cluster.count > preview.length ? `<div class="popup-meta">+${cluster.count - preview.length} more</div>` : ''}
      <div class="popup-meta">Zoom in for individual signs</div>
    </div>`;
  }
  const avgSpeed = Math.round(
    cluster.items.reduce((sum, item) => sum + (Number(item.speed) || 0), 0) / Math.max(cluster.items.length, 1)
  );
  return `
  <div class="popup-inner">
    <div class="popup-type sens">${cluster.count} Speed Sensors</div>
    <div class="popup-msg" style="font-family:inherit;font-size:12px">Average current speed: ${avgSpeed || '?'} mph</div>
    <div class="popup-meta">Zoom in for individual sensors</div>
  </div>`;
}

function createDenseAggregateMarker(type, cluster) {
  const marker = L.marker([cluster.lat, cluster.lon], {
    icon: denseClusterIcon(type, cluster.count),
    pane: layerPane(type)
  });
  marker.bindPopup(denseClusterPopup(type, cluster));
  marker.on('click', () => {
    const targetZoom = map.getZoom() <= 7 ? 9 : 12;
    map.flyTo([cluster.lat, cluster.lon], Math.max(map.getZoom() + 1, targetZoom), { duration: 0.35 });
  });
  return marker;
}

function syncDenseAggregateMarker(type, marker, cluster) {
  marker.setLatLng([cluster.lat, cluster.lon]);
  marker.setIcon(denseClusterIcon(type, cluster.count));
  marker.getPopup()?.setContent(denseClusterPopup(type, cluster));
}

function createCameraMarker(cam) {
  const marker = L.marker([cam.lat, cam.lon], {
    icon: camIcon(cam, cam.id === selectedId, cameraHopDirectionForId(cam.id)),
    pane: cameraMarkerPaneForId(cam.id)
  });
  marker.on('click', () => selectCamera(cam.id));
  return marker;
}

function createSignMarker(sign) {
  const marker = L.marker([sign.lat, sign.lon], {
    icon: signMarkerIcon(signIsAlertMessage(sign.msg)),
    pane: layerPane('sign')
  });
  marker.bindPopup(L.popup({ maxWidth: 280 }));
  syncSignMarker(marker, sign, sign.msg == null);
  marker.on('popupopen', async () => {
    await hydrateSignDetail(sign, { force: true });
    syncSignMarker(marker, sign);
  });
  return marker;
}

function createLprMarker(item) {
  return L.marker([item.lat, item.lon], {
    icon: lprIcon(item.tags),
    pane: layerPane('lpr')
  }).bindPopup(item.popup);
}

function createSensorMarker(item) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="sens-marker" style="background:${item.color}">${item.speedLabel}</div>`,
    iconSize: [28, 18],
    iconAnchor: [14, 9]
  });
  return L.marker([item.lat, item.lon], { icon, pane: layerPane('sens') }).bindPopup(item.popup);
}

function renderDenseLayer(type, items, rawMap, aggregateMap, createMarker) {
  if (!layerVisible[type]) {
    clearMarkerMap(rawMap);
    clearMarkerMap(aggregateMap);
    return;
  }

  const visibleItems = denseItemsInView(items);
  const mode = denseLayerMode(type, items.length);

  if (mode.kind === 'hidden') {
    clearMarkerMap(rawMap);
    clearMarkerMap(aggregateMap);
    return;
  }

  if (mode.kind === 'raw') {
    clearMarkerMap(aggregateMap);
    const visibleIds = new Set(visibleItems.map(item => item.id));
    for (const [id, marker] of rawMap) {
      if (!visibleIds.has(id)) {
        map.removeLayer(marker);
        rawMap.delete(id);
      }
    }
    visibleItems.forEach(item => {
      let marker = rawMap.get(item.id);
      if (!marker) {
        marker = createMarker(item);
        rawMap.set(item.id, marker);
      }
      if (type === 'cam') syncCameraMarkerPresentation(item.id);
      if (type === 'sign') syncSignMarker(marker, item, item.msg == null);
      if (!map.hasLayer(marker)) marker.addTo(map);
    });
    return;
  }

  clearMarkerMap(rawMap);
  const clusters = aggregateDenseItems(visibleItems, mode.cellPx);
  const clusterKeys = new Set(clusters.map(cluster => cluster.key));
  for (const [key, marker] of aggregateMap) {
    if (!clusterKeys.has(key)) {
      map.removeLayer(marker);
      aggregateMap.delete(key);
    }
  }
  clusters.forEach(cluster => {
    let marker = aggregateMap.get(cluster.key);
    if (!marker) {
      marker = createDenseAggregateMarker(type, cluster);
      aggregateMap.set(cluster.key, marker);
    } else {
      syncDenseAggregateMarker(type, marker, cluster);
    }
    if (!map.hasLayer(marker)) marker.addTo(map);
  });
}

function renderConLayer() {
  const show = layerVisible.con && denseLayerMode('con', conMarkers.size).kind !== 'hidden';
  for (const [, marker] of conMarkers) {
    if (show) marker.addTo(map); else map.removeLayer(marker);
  }
}

function renderPowerLayer() {
  const show = layerVisible.power && denseLayerMode('power', powerLayers.size).kind !== 'hidden';
  for (const [, layer] of powerLayers) {
    if (show) layer.addTo(map); else map.removeLayer(layer);
  }
}

function renderTempLayer() {
  const show = layerVisible.temp && denseLayerMode('temp', allTempStations.length).kind !== 'hidden';
  for (const [, marker] of tempMarkers) {
    if (show) marker.addTo(map); else map.removeLayer(marker);
  }
}

function renderDenseLayers() {
  renderDenseLayer('sign', allSigns, signMarkers, signAggregateMarkers, createSignMarker);
  renderDenseLayer('cam', filteredCameras, camMarkers, camAggregateMarkers, createCameraMarker);
  renderDenseLayer('lpr', allLpr, lprMarkers, lprAggregateMarkers, createLprMarker);
  renderDenseLayer('sens', allSensors, sensMarkers, sensAggregateMarkers, createSensorMarker);
  renderConLayer();
  renderPowerLayer();
  renderTempLayer();
}

function updateOverviewHint() {
  const hint = overviewHintControl.getContainer();
  if (!hint) return;
  const mapKeyOpen = !document.getElementById('map-key')?.classList.contains('hidden');
  if (cameraHopModeActive() || mapKeyOpen) {
    hint.classList.remove('startup-hint', 'pulsing', 'fading');
    setStartupHintInteractive(false);
    hint.style.display = 'none';
    return;
  }
  const hidden = [];
  for (const type of DENSE_LAYER_KEYS) {
    if (!layerVisible[type]) continue;
    if (denseLayerMode(type, denseLayerCount(type)).kind === 'hidden') {
      if (type === 'cam') hidden.push('cameras');
      if (type === 'sign') hidden.push('signs');
      if (type === 'lpr') hidden.push('plate readers');
      if (type === 'sens') hidden.push('sensors');
      if (type === 'con') hidden.push('construction');
      if (type === 'power') hidden.push('power outages');
      if (type === 'temp') hidden.push('temperature stations');
    }
  }
  const nearStartView = map.getZoom() >= DEFAULT_ZOOM - 1;
  if (nearStartView && !startupHintDismissed) {
    showStartupHint();
    return;
  }
  hint.classList.remove('startup-hint', 'pulsing', 'fading');
  setStartupHintInteractive(false);
  if (nearStartView && startupHintDismissed && !hidden.length) {
    hint.style.display = 'none';
    return;
  }
  if (!hidden.length) {
    hint.style.display = 'none';
    return;
  }
  hint.style.display = 'block';
  hint.innerHTML = `<strong>Overview Mode</strong><br>Zoom In To Reveal Incidents, Signs, Sensors, &amp; More.`;
}

let denseLayerRefreshQueued = false;
function scheduleDenseLayerRefresh() {
  if (denseLayerRefreshQueued) return;
  denseLayerRefreshQueued = true;
  requestAnimationFrame(() => {
    denseLayerRefreshQueued = false;
    renderDenseLayers();
    updateOverviewHint();
    refreshLayerToggleButtons();
  });
}

map.on('zoomend moveend', () => {
  scheduleDenseLayerRefresh();
  scheduleVisibleCameraNameWarm();
  scheduleVisibleSignDetailRefresh();
  renderActivityFeed();
});
map.on('zoomend', () => {
  syncIncidentLayerVisibility();
  syncMapKeyCheckboxes();
});

// ── Camera markers ────────────────────────────────────────────────────────
function camIcon(cam, selected = false, hopDirection = '') {
  const classes = ['cam-marker'];
  let size = 14;

  if (selected) {
    classes.push('selected');
    size = 24;
  } else if (hopDirection) {
    classes.push('hop', hopDirection);
    size = 20;
  } else if (!cam.video_enabled) {
    classes.push('snap-only');
  }

  let content = '';
  if (selected) {
    content = CAMERA_SELECTED_MARKER_GLYPH;
  } else if (hopDirection) {
    content = CAMERA_HOP_LABELS[hopDirection]?.marker || CAMERA_HOP_LABELS[hopDirection]?.arrow || '';
  }
  return L.divIcon({
    className: '',
    html: `<div class="${classes.join(' ')}">${content}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function syncCameraMarkerPresentation(id) {
  const marker = camMarkers.get(id);
  const cam = allCameras.find(item => item.id === id);
  if (!marker || !cam) return;
  const desiredPane = cameraMarkerPaneForId(id);
  const paneChanged = marker.options.pane !== desiredPane;
  const onMap = map.hasLayer(marker);
  if (paneChanged && onMap) map.removeLayer(marker);
  if (paneChanged) marker.options.pane = desiredPane;
  marker.setIcon(camIcon(cam, cam.id === selectedId, cameraHopDirectionForId(cam.id)));
  if (paneChanged && onMap) marker.addTo(map);
  if (desiredPane === CAMERA_HOP_PANE.name && map.hasLayer(marker) && typeof marker.bringToFront === 'function') {
    marker.bringToFront();
  }
}

function renderCamMarkers(cameras) {
  scheduleDenseLayerRefresh();
}

// ── FL511 tooltip fetcher (shared by signs, incidents, construction) ───────
const fl511TooltipCache = new Map();

async function fetchFL511Tooltip(layer, id, options = {}) {
  const { force = false } = options;
  const key = `${layer}:${id}`;
  if (force) fl511TooltipCache.delete(key);
  if (fl511TooltipCache.has(key)) return fl511TooltipCache.get(key);
  try {
    const r = await fetch(`/fl511tooltip?layer=${layer}&id=${id}`);
    if (!r.ok) throw new Error(r.status);
    const info = await r.json();
    fl511TooltipCache.set(key, info);
    return info;
  } catch (e) {
    return null;
  }
}

function signIsAlertMessage(message) {
  return SIGN_ALERT_PATTERN.test(message || '');
}

function signMarkerIcon(isAlert) {
  return L.divIcon({
    className: '',
    html: `<div class="sign-marker${isAlert ? ' alert' : ''}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
}

function buildSignPopupHtml(name, message, timestamp, isAlert) {
  return `
    <div class="popup-inner">
      <div class="popup-type sign${isAlert ? ' alert' : ''}">${isAlert ? '⚠ ALERT' : 'Message Sign'}</div>
      <div class="popup-name">${escapeHtml(name || 'Message Sign')}</div>
      <div class="popup-msg">${escapeHtml(message || '(blank)')}</div>
      ${timestamp ? `<div class="popup-meta">${escapeHtml(timestamp)}</div>` : ''}
    </div>`;
}

function syncSignMarker(marker, sign, loading = false) {
  const isAlert = signIsAlertMessage(sign.msg);
  marker.setIcon(signMarkerIcon(isAlert));
  const popup = marker.getPopup();
  if (!popup) return;
  if (sign.msg != null) {
    popup.setContent(buildSignPopupHtml(sign.name, sign.msg, sign.timestamp, isAlert));
  } else if (loading) {
    popup.setContent(buildSignPopupHtml(sign.name, 'Loading…', sign.timestamp, false));
  } else {
    popup.setContent(buildSignPopupHtml(sign.name, '(blank)', sign.timestamp, false));
  }
}

async function hydrateSignDetail(sign, options = {}) {
  const info = await fetchFL511Tooltip('MessageSigns', sign.id, options);
  if (!info) return null;
  sign.name = info.name || sign.name;
  sign.msg = info.msg ?? sign.msg;
  sign.timestamp = info.timestamp ?? sign.timestamp;
  sign.timeMs = parseEventTimeMs(sign.timestamp);
  return info;
}

let signDetailRefreshQueued = false;
let signDetailRefreshForce = false;
function scheduleVisibleSignDetailRefresh(force = false) {
  if (!layerVisible.sign || map.getZoom() < (DENSE_LAYER_MIN_ZOOM.sign ?? 11)) return;
  signDetailRefreshForce = signDetailRefreshForce || force;
  if (signDetailRefreshQueued) return;
  signDetailRefreshQueued = true;
  setTimeout(async () => {
    signDetailRefreshQueued = false;
    const useForce = signDetailRefreshForce;
    signDetailRefreshForce = false;
    const visibleSigns = denseItemsInView(allSigns).slice(0, SIGN_DETAIL_WARM_LIMIT);
    await Promise.allSettled(visibleSigns.map(async sign => {
      await hydrateSignDetail(sign, { force: useForce });
      const marker = signMarkers.get(sign.id);
      if (marker) syncSignMarker(marker, sign);
    }));
    renderActivityFeed();
  }, 220);
}

// ── Incident markers ──────────────────────────────────────────────────────
function addIncMarker(item) {
  const { id, lat, lon, type, layer, desc, severity, timestamp } = item;
  if (incMarkers.has(id)) {
    const marker = incMarkers.get(id);
    marker.setLatLng([lat, lon]);
    return;
  }
  const icon = L.divIcon({
    className: '', html: `<div class="inc-marker">!</div>`,
    iconSize: [14, 14], iconAnchor: [7, 7]
  });
  const m = L.marker([lat, lon], { icon, pane: layerPane('inc') });
  const label = type === 'DisabledVehicles' ? 'Disabled Vehicle' : 'Incident';

  function buildIncHtml(d, sev) {
    const sevClass = sev === 'Minor' ? 'sev-minor' : sev === 'Major' ? 'sev-major' : 'sev-moderate';
    return `
    <div class="popup-inner">
      <div class="popup-type inc">${escapeHtml(label)}</div>
      <div class="popup-msg" style="font-family:inherit;font-size:12px">${escapeHtml(d || '(no description)')}</div>
      ${sev ? `<span class="popup-severity ${sevClass}">${escapeHtml(sev)}</span>` : ''}
      ${timestamp ? `<div class="popup-meta">${escapeHtml(timestamp)}</div>` : ''}
    </div>`;
  }

  const popup = L.popup({ maxWidth: 300 });
  if (desc != null) {
    popup.setContent(buildIncHtml(desc, severity));
  } else {
    popup.setContent(buildIncHtml('Loading…', null));
    m.on('popupopen', async () => {
      const info = await fetchFL511Tooltip(layer || 'Incidents', id);
      if (info) popup.setContent(buildIncHtml(info.msg, info.severity));
    });
  }

  m.bindPopup(popup);
  if (incidentLayerMarkersVisible('inc')) m.addTo(map);
  incMarkers.set(id, m);
}

// ── Construction markers ──────────────────────────────────────────────────
function addConMarker(item) {
  const { id, lat, lon, layer, desc, severity, timestamp } = item;
  if (conMarkers.has(id)) {
    const marker = conMarkers.get(id);
    marker.setLatLng([lat, lon]);
    return;
  }
  const icon = L.divIcon({
    className: '', html: `<div class="con-marker"></div>`,
    iconSize: [14, 13], iconAnchor: [7, 13]
  });
  const m = L.marker([lat, lon], { icon, pane: layerPane('con') });

  function buildConHtml(d, sev) {
    const sevClass = sev === 'Minor' ? 'sev-minor' : sev === 'Major' ? 'sev-major' : 'sev-moderate';
    return `
    <div class="popup-inner">
      <div class="popup-type con">Construction</div>
      <div class="popup-msg" style="font-family:inherit;font-size:12px">${escapeHtml(d || '(no description)')}</div>
      ${sev ? `<span class="popup-severity ${sevClass}">${escapeHtml(sev)}</span>` : ''}
      ${timestamp ? `<div class="popup-meta">${escapeHtml(timestamp)}</div>` : ''}
    </div>`;
  }

  const popup = L.popup({ maxWidth: 300 });
  if (desc != null) {
    popup.setContent(buildConHtml(desc, severity));
  } else {
    popup.setContent(buildConHtml('Loading…', null));
    m.on('popupopen', async () => {
      const info = await fetchFL511Tooltip(layer || 'Construction', id);
      if (info) popup.setContent(buildConHtml(info.msg, info.severity));
    });
  }

  m.bindPopup(popup);
  if (layerVisible.con && denseLayerMode('con', conMarkers.size).kind !== 'hidden') m.addTo(map);
  conMarkers.set(id, m);
}

// ── Aircraft (ADS-B) ──────────────────────────────────────────────────────
// Known government/law enforcement callsign prefixes
const GOV_CALLSIGNS = [
  // Federal law enforcement / agencies
  'CBP','FED','DOJ','DEA','FBI','ICE','ATF','FAMS','HSI',
  // Florida law enforcement
  'FHP','FLHP',           // Florida Highway Patrol
  'OPD','OCSO','PCSO','HCSO','BCSO','SCSO','LCSO','MCSO', // FL sheriff/police
  'FLPD','OIPD',
  // Generic prefixes
  'SHERIFF','TROOPER','POLICE','PATROL','RESCUE',
  // Military callsign prefixes
  'JOLLY','PEDRO','KING','REACH','EVAC','DUSTOFF','MEDEVAC',
];

// Owner name keywords that identify police/fire/EMS/military operators
const GOV_OWNER_TERMS = [
  'SHERIFF','POLICE','FIRE','RESCUE','EMS','MEDIC','MEDEVAC','LIFEFLIGHT',
  'LIFE FLIGHT','CAREFLITE','CARE FLIGHT','LIFESTAR','LIFENET','AIRLIFE',
  'AIR METHODS','METRO AVIATION','PHI AIR','STARS AIR','OMNIFLIGHT',
  'AIR EVAC','GUARDIAN FLIGHT','REACH AIR','CALSTAR',
  'HIGHWAY PATROL','STATE PATROL','TROOPER','MARSHAL','CONSTABLE',
  'BORDER PATROL','CUSTOMS','NATIONAL GUARD','COAST GUARD',
  'DEPT OF PUBLIC SAFETY','DEPARTMENT OF PUBLIC SAFETY',
  'COUNTY FIRE','CITY FIRE','DISTRICT FIRE',
];

const MEDICAL_AIR_TERMS = [
  'EMS','MEDIC','MEDEVAC','LIFEFLIGHT','LIFE FLIGHT','AIR MEDICAL','AIR AMBULANCE',
  'ADVENTHEALTH','ADVENT HEALTH','ORLANDO HEALTH','NEMOURS','NEMOURS CHILDREN',
  'NICKLAUS CHILDREN','JACKSON HEALTH','TAMPA GENERAL','BROWARD HEALTH',
  'MEMORIAL HEALTH','HEALTH FIRST','LEE HEALTH','UF HEALTH','BAPTIST HEALTH',
  'AIR METHODS','METRO AVIATION','PHI AIR','PHI AIR MEDICAL','OMNIFLIGHT',
  'GUARDIAN FLIGHT','AIR EVAC','CAREFLITE','CARE FLIGHT','LIFESTAR','LIFENET',
  'AIRLIFE','AIR LIFE'
];

const POLICE_AIR_TERMS = [
  'SHERIFF','POLICE','HIGHWAY PATROL','STATE PATROL','TROOPER','PATROL',
  'DEPARTMENT OF PUBLIC SAFETY','DEPT OF PUBLIC SAFETY','LAW ENFORCEMENT',
  'FHP','FLHP','STATE OF FLORIDA'
];

const FIRE_AIR_TERMS = [
  'FIRE','RESCUE','FIRE RESCUE','SEARCH AND RESCUE'
];

const MILITARY_AIR_TERMS = [
  'UNITED STATES','US NAVY','US ARMY','US AIR FORCE','US MARINE','MARINES',
  'AIR NATIONAL GUARD','NATIONAL GUARD','COAST GUARD','DEPARTMENT OF DEFENSE',
  'DOD','CUSTOMS AND BORDER PROTECTION','BORDER PATROL'
];

function hasGovOwner(reg) {
  if (!reg?.owner) return false;
  const owner = reg.owner.toUpperCase();
  return GOV_OWNER_TERMS.some(t => owner.includes(t));
}

function hasGovCallsign(callsign) {
  const cs = (callsign || '').trim().toUpperCase();
  return GOV_CALLSIGNS.some(p => cs.startsWith(p)) || cs.includes('GOV') || cs.includes('LAW');
}

// ICAO aircraft type designators that are rotorcraft
const HELO_ICAO_TYPES = new Set([
  'R22','R44','R66',                                           // Robinson
  'B06','B222','B230','B412','B427','B429','B430','B407',      // Bell
  'B206','B212','B214','B505','B47G','B47J',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',            // Airbus/Eurocopter
  'H125','H135','H145','H155','H160','H175','H215','H225',
  'AS32','AS50','AS55','AS65','AS35',
  'S300','S61','S76','S92',                                    // Sikorsky
  'H500','H369','HUCO','MD5','MD52','MD6',                     // MD/Hughes
  'A109','A119','A139','A149','A169','A189',                   // Leonardo/Agusta
  'UH1','CH47','UH60','UH72','OH58',                          // Military
  'S269','S333','CABR','F28',                                  // Schweizer/Guimbal/Enstrom
]);

const HELO_TEXT_TERMS = [
  'HELICOPTER','ROTORCRAFT','EUROCOPTER','AIRBUS HELICOPTERS','BELL',
  'ROBINSON','SIKORSKY','AGUSTA','LEONARDO','MD HELICOPTERS',
  'EC120','EC130','EC135','EC145','BK117','AS350','AS355','AS365',
  'AW109','AW119','AW139','AW169','AW189'
];

function matchesAnyTerm(value, terms) {
  const text = (value || '').toUpperCase();
  if (!text) return false;
  return terms.some(term => text.includes(term));
}

function aircraftService(icao, callsign, reg, dbFlags = 0) {
  const cs = (callsign || '').trim().toUpperCase();
  const owner = reg?.owner || '';
  const flags = Number(dbFlags) || 0;
  const isMilitary = /^ae/i.test(icao || '') || (flags & 1) || matchesAnyTerm(owner, MILITARY_AIR_TERMS) || GOV_CALLSIGNS.slice(-5).some(p => cs.startsWith(p));
  if (isMilitary) return 'military';
  if (matchesAnyTerm(owner, MEDICAL_AIR_TERMS) || matchesAnyTerm(cs, MEDICAL_AIR_TERMS)) return 'medical';
  if (matchesAnyTerm(owner, FIRE_AIR_TERMS) || matchesAnyTerm(cs, FIRE_AIR_TERMS)) return 'fire';
  if (matchesAnyTerm(owner, POLICE_AIR_TERMS) || matchesAnyTerm(cs, POLICE_AIR_TERMS) || hasGovCallsign(cs)) return 'police';
  if (hasGovOwner(reg)) return 'gov';
  return null;
}

function isRotorcraft(category = '', icaoType = '', reg = null) {
  const categoryText = String(category || '').toUpperCase();
  if (categoryText.startsWith('B')) return true;
  const typeCodes = [
    String(icaoType || '').toUpperCase(),
    String(reg?.model || '').toUpperCase()
  ].filter(Boolean);
  if (typeCodes.some(code => HELO_ICAO_TYPES.has(code))) return true;
  const descriptiveText = [reg?.manufacturer, reg?.model, reg?.type, icaoType]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  return HELO_TEXT_TERMS.some(term => descriptiveText.includes(term));
}

function aircraftTraits(icao, callsign, reg, dbFlags = 0, category = '', icaoType = '') {
  const service = aircraftService(icao, callsign, reg, dbFlags);
  const isGov = Boolean(service);
  const isHelo = isRotorcraft(category, icaoType, reg);
  return { isGov, isHelo, service };
}

// Returns true if this aircraft should be shown (police/fire/EMS/military)
function isEmergencyAircraft(icao, callsign, reg, dbFlags = 0, category = '', icaoType = '') {
  return aircraftTraits(icao, callsign, reg, dbFlags, category, icaoType).isGov;
}

function shouldLookupAircraftRegistry(callsign, category, tailNumber) {
  const cs = (callsign || '').trim().toUpperCase();
  const reg = (tailNumber || '').trim().toUpperCase();
  if (category && ['A3', 'A4', 'A5', 'A6'].includes(category) && /^[A-Z]{3,4}\d/.test(cs)) return false;
  if (!cs && reg.startsWith('N')) return true;
  return true;
}

function aircraftIcon(icao, callsign, heading, alt, vel, reg, dbFlags, category, icaoType) {
  const { isGov, isHelo, service } = aircraftTraits(icao, callsign, reg, dbFlags, category, icaoType);
  const color = ({
    medical: '#ff6b6b',
    police: '#58a6ff',
    fire: '#ff9e43',
    military: '#f2cc60',
    gov: '#f85149'
  })[service] || (isGov ? '#f85149' : '#c9d1d9');
  const hdg = heading ?? 0;
  // Top-down silhouettes, nose pointing up (north), rotated by heading
  const shape = isHelo
    ? /* helicopter top-down: main rotor disc, teardrop fuselage, tail boom, tail rotor */
      `<circle cx="12" cy="10" r="9" fill="${color}" fill-opacity="0.13" stroke="${color}" stroke-width="0.9"/>
       <line x1="3" y1="10" x2="21" y2="10" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
       <circle cx="12" cy="10" r="1.3" fill="${color}"/>
       <path d="M12,4 C15.5,4 17,7.5 17,11 C17,14.5 15,16.5 12,17.5 C9,16.5 7,14.5 7,11 C7,7.5 8.5,4 12,4 Z" fill="${color}"/>
       <rect x="11.2" y="17" width="1.6" height="5.5" rx="0.8" fill="${color}"/>
       <ellipse cx="12" cy="22.5" rx="3.5" ry="1.1" fill="${color}"/>
       <circle cx="12" cy="22.5" r="0.8" fill="${color}" fill-opacity="0.6"/>`
    : /* fixed-wing: sleek fuselage + swept wings + v-tail */
      `<ellipse cx="12" cy="12" rx="1.8" ry="8.5" fill="${color}"/>
       <polygon points="12,7 22,17 19,17.5 12,13 5,17.5 2,17" fill="${color}"/>
       <polygon points="12,18.5 16,23 8,23" fill="${color}"/>`;
  return L.divIcon({
    className: '',
    html: `<svg width="28" height="28" style="transform:rotate(${hdg}deg);filter:drop-shadow(0 1px 4px rgba(0,0,0,0.9))"
                viewBox="0 0 24 24">${shape}</svg>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
}

const registryCache = new Map(); // icao → {owner, manufacturer, model} | null

async function fetchRegistry(icao) {
  if (registryCache.has(icao)) return registryCache.get(icao);
  try {
    const d = await fetch(`/registry?icao=${icao}`).then(r => r.json());
    const ac = d?.response?.aircraft;
    const info = ac ? {
      owner: ac.registered_owner || null,
      manufacturer: ac.manufacturer || null,
      model: ac.icao_type || null,
      type: ac.type || null
    } : null;
    registryCache.set(icao, info);
    return info;
  } catch { registryCache.set(icao, null); return null; }
}

function buildAircraftPopup(cs, icao, alt_ft, spd_kt, hdg, reg, dbFlags, category, icaoType) {
  const { isGov, isHelo, service } = aircraftTraits(icao, cs, reg, dbFlags, category, icaoType);
  const serviceLabel = ({
    medical: isHelo ? 'Medical Helicopter' : 'Medical Aircraft',
    police: isHelo ? 'Law Enforcement Helicopter' : 'Law Enforcement Aircraft',
    fire: isHelo ? 'Fire / Rescue Helicopter' : 'Fire / Rescue Aircraft',
    military: isHelo ? 'Military Helicopter' : 'Military Aircraft',
    gov: isHelo ? 'Public Safety Helicopter' : 'Public Safety Aircraft'
  })[service];
  const badgeColor = ({
    medical: '#ff6b6b',
    police: '#58a6ff',
    fire: '#ff9e43',
    military: '#f2cc60',
    gov: '#f85149'
  })[service] || '#f85149';
  const govBadge = isGov && serviceLabel ? `<b style="color:${badgeColor}">${escapeHtml(serviceLabel)}</b><br>` : '';
  const civilianBadge = !isGov ? `<b style="color:#c9d1d9">${isHelo ? 'Civilian Helicopter' : 'Civilian Aircraft'}</b><br>` : '';
  const ownerLine = reg?.owner ? `<br><b>Owner:</b> ${escapeHtml(reg.owner)}` : '';
  const aircraftLine = (reg?.manufacturer || reg?.model)
    ? `<br><b>Aircraft:</b> ${escapeHtml([reg.manufacturer, reg.model].filter(Boolean).join(' '))}`
    : '';
  const typeLine = reg?.type ? `<br><small style="color:#aaa">${escapeHtml(reg.type)}</small>` : '';
  return `${govBadge || civilianBadge}<b>${escapeHtml(cs || icao)}</b><br>ICAO: ${escapeHtml(icao)}${ownerLine}${aircraftLine}${typeLine}<br>Alt: ${alt_ft !== null ? alt_ft + ' ft' : '—'}<br>Speed: ${spd_kt !== null ? spd_kt + ' kt' : '—'}<br>Heading: ${hdg !== null ? Math.round(hdg) + '°' : '—'}`;
}

function removeAircraftMarker(mapStore, icao) {
  if (!mapStore.has(icao)) return;
  map.removeLayer(mapStore.get(icao));
  mapStore.delete(icao);
}

function refreshAircraftMarkerVisibility() {
  syncAircraftLayerVisibilityState();
  for (const [, marker] of govAirMarkers) {
    if (layerVisible.govair) marker.addTo(map); else map.removeLayer(marker);
  }
  for (const [, marker] of civAirMarkers) {
    if (layerVisible.civair) marker.addTo(map); else map.removeLayer(marker);
  }
}

function upsertAircraftMarker(icao, lat, lon, popup, icon, isGov) {
  const targetStore = isGov ? govAirMarkers : civAirMarkers;
  const otherStore = isGov ? civAirMarkers : govAirMarkers;
  removeAircraftMarker(otherStore, icao);

  let marker = targetStore.get(icao);
  if (!marker) {
    marker = L.marker([lat, lon], {
      icon,
      pane: layerPane(isGov ? 'govair' : 'civair')
    }).bindPopup(popup);
    targetStore.set(icao, marker);
  } else {
    marker.setLatLng([lat, lon]);
    marker.setIcon(icon);
    marker.getPopup()?.setContent(popup);
  }

  if ((isGov && layerVisible.govair) || (!isGov && layerVisible.civair)) {
    marker.addTo(map);
  } else {
    map.removeLayer(marker);
  }
}

async function loadAircraft() {
  try {
    const d = await fetch('/aircraft').then(r => r.json());
    const aircraft = d.aircraft || [];
    const seenGov = new Set();
    const seenCiv = new Set();

    aircraft.forEach(ac => {
      const icao = ac.hex;
      const lat = ac.lat, lon = ac.lon;
      if (!lat || !lon) return;
      if (ac.alt_baro === 'ground' || ac.ground) return;

      const cs = (ac.flight || '').trim();
      const alt_ft = typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : null;
      const spd_kt = typeof ac.gs === 'number' ? Math.round(ac.gs) : null;
      const hdg = ac.track ?? null;
      const dbFlags = ac.dbFlags || 0;
      const category = ac.category || '';
      const icaoType = ac.t || '';
      const tailNumber = ac.r || '';
      const reg = registryCache.has(icao) ? registryCache.get(icao) : undefined;
      const canLookupRegistry = !registryCache.has(icao) && shouldLookupAircraftRegistry(cs, category, tailNumber);
      const isGov = aircraftTraits(icao, cs, reg ?? null, dbFlags, category, icaoType).isGov;
      (isGov ? seenGov : seenCiv).add(icao);
      const popup = buildAircraftPopup(cs, icao, alt_ft, spd_kt, hdg, reg ?? null, dbFlags, category, icaoType);
      upsertAircraftMarker(
        icao,
        lat,
        lon,
        popup,
        aircraftIcon(icao, cs, hdg, alt_ft, spd_kt, reg ?? null, dbFlags, category, icaoType),
        isGov
      );

      if (canLookupRegistry) {
        fetchRegistry(icao).then(nextReg => {
          const nextIsGov = aircraftTraits(icao, cs, nextReg, dbFlags, category, icaoType).isGov;
          upsertAircraftMarker(
            icao,
            lat,
            lon,
            buildAircraftPopup(cs, icao, alt_ft, spd_kt, hdg, nextReg, dbFlags, category, icaoType),
            aircraftIcon(icao, cs, hdg, alt_ft, spd_kt, nextReg, dbFlags, category, icaoType),
            nextIsGov
          );
        });
      }
    });

    for (const [icao, marker] of govAirMarkers) {
      if (!seenGov.has(icao)) {
        map.removeLayer(marker);
        govAirMarkers.delete(icao);
      }
    }
    for (const [icao, marker] of civAirMarkers) {
      if (!seenCiv.has(icao)) {
        map.removeLayer(marker);
        civAirMarkers.delete(icao);
      }
    }
    markLayerFresh('air');
  } catch(e) { console.warn('Aircraft load failed:', e); }
}

// ── License plate readers ────────────────────────────────────────────────
const GOV_OPERATORS = ['sheriff','police','county','city','university','fdot','state','highway patrol','department'];
const LPR_DIRECTION_LABELS = [
  'North',
  'North North East',
  'North East',
  'East North East',
  'East',
  'East South East',
  'South East',
  'South South East',
  'South',
  'South South West',
  'South West',
  'West South West',
  'West',
  'West North West',
  'North West',
  'North North West'
];

function parseLPRDir(raw) {
  if (!raw) return [];
  // "70;240" → [70, 240]
  if (raw.includes(';')) return raw.split(';').map(Number).filter(n => !isNaN(n));
  // "30-100" → midpoint [65]
  const rangeParts = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeParts) return [( +rangeParts[1] + +rangeParts[2] ) / 2];
  // cardinal
  const cardinals = {N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,
                     S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5};
  const card = cardinals[raw.trim().toUpperCase()];
  if (card !== undefined) return [card];
  const n = parseFloat(raw);
  return isNaN(n) ? [] : [n];
}

function lprDirectionValue(tags) {
  return tags.direction || tags['camera:direction'] || '';
}

function lprDirectionLabel(raw) {
  if (!raw) return '';
  const dirs = parseLPRDir(raw);
  if (!dirs.length) return raw;
  const labels = dirs.map((deg) => {
    const normalized = ((deg % 360) + 360) % 360;
    const index = Math.round(normalized / 22.5) % 16;
    return LPR_DIRECTION_LABELS[index];
  });
  return Array.from(new Set(labels)).join(' / ');
}

function lprWedgePath(angleDeg) {
  // Sector pointing outward from center (14,14), aperture 55°, radius 13px
  const cx = 14, cy = 14, r = 13, half = 27.5 * Math.PI / 180;
  const base = (angleDeg - 90) * Math.PI / 180;
  const x1 = cx + r * Math.cos(base - half);
  const y1 = cy + r * Math.sin(base - half);
  const x2 = cx + r * Math.cos(base + half);
  const y2 = cy + r * Math.sin(base + half);
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function lprIcon(tags) {
  const op = (tags.operator || '').toLowerCase();
  const isGov = GOV_OPERATORS.some(k => op.includes(k));
  const dotColor = isGov ? '#4f8ef7' : '#8b949e';
  const dirs = parseLPRDir(lprDirectionValue(tags));
  const wedges = dirs.map(d =>
    `<path d="${lprWedgePath(d)}" fill="#e53935" fill-opacity="0.40"/>`
  ).join('');
  const inner = wedges
    ? `<svg width="28" height="28" style="position:absolute;top:0;left:0;overflow:visible">${wedges}</svg>`
    : `<div class="lpr-dot" style="background:${dotColor};opacity:0.7"></div>`;
  return L.divIcon({
    className: '',
    html: `<div class="lpr-wrap" style="width:28px;height:28px">${inner}</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
}

async function loadLPR() {
  try {
    const d = await fetch('/lpr').then(r => r.json());
    allLpr = d.elements.map(el => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') return null;
      const tags = el.tags || {};
      const dirRaw = lprDirectionValue(tags);
      const dirLabel = lprDirectionLabel(dirRaw);
      const dir = dirLabel ? ` · Facing ${dirLabel}` : '';
      const operator = tags.operator || tags.manufacturer || 'Unknown operator';
      const zoneLabel = String(tags.surveillance_zone || tags['surveillance:zone'] || '').replace(/\btraffic\b/g, 'Traffic');
      return {
        id: String(el.id),
        lat,
        lon,
        tags,
        operator,
        popup: `<b>License Plate Reader</b><br>${escapeHtml(operator)}<br><small>${escapeHtml(zoneLabel)} ${escapeHtml(dir)}</small>`
      };
    }).filter(Boolean);
    scheduleDenseLayerRefresh();
  } catch(e) { console.warn('LPR load failed:', e); }
}

// ── Speed sensors ─────────────────────────────────────────────────────────
function sensColor(speed, limit) {
  if (!speed || !limit) return '#888';
  const ratio = speed / limit;
  if (ratio >= 0.85) return '#3fb950'; // free-flow green
  if (ratio >= 0.65) return '#e3b341'; // moderate yellow
  if (ratio >= 0.45) return '#f0883e'; // slow orange
  return '#f85149';                    // congested red
}

async function loadSensors() {
  try {
    const d = await fetch('/sensors').then(r => r.json());
    allSensors = d.features.map(f => {
      const a = f.attributes;
      const lat = a.LATITUDE, lon = a.LNGITUDE;
      const speedLabel = a.CURAVSPD ? Math.round(a.CURAVSPD) : '?';
      const lim = a.MAXSPEEDR || '?';
      const color = sensColor(a.CURAVSPD, a.MAXSPEEDR);
      return {
        id: a.IDSTR,
        lat,
        lon,
        speed: a.CURAVSPD,
        speedLabel,
        color,
        popup: `<b>${escapeHtml(a.LOCALNAM)}</b><br>${speedLabel} mph / ${lim} mph limit<br><small>${escapeHtml(a.IDSTR)}</small>`
      };
    }).filter(item => typeof item.lat === 'number' && typeof item.lon === 'number');
    scheduleDenseLayerRefresh();
    markLayerFresh('sens');
  } catch(e) { console.warn('Sensors load failed:', e); }
}

// ── Temperature stations ──────────────────────────────────────────────────
function tempColor(tmpf) {
  if (tmpf === null || tmpf === undefined) return '#8b949e';
  if (tmpf >= 100) return '#b91c1c';
  if (tmpf >= 90)  return '#ef4444';
  if (tmpf >= 80)  return '#f97316';
  if (tmpf >= 70)  return '#ff9d4d';
  if (tmpf >= 60)  return '#eab308';
  if (tmpf >= 50)  return '#84cc16';
  if (tmpf >= 40)  return '#22d3ee';
  return '#60a5fa';
}

function windDirLabel(drct) {
  if (drct === null || drct === undefined) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(drct / 22.5) % 16];
}

async function loadTemperatureStations() {
  try {
    const geojson = await fetch('/temperature-stations').then(r => r.json());
    const seen = new Set();
    for (const feat of geojson.features || []) {
      const p = feat.properties;
      const [lon, lat] = feat.geometry.coordinates;
      const id = p.station;
      seen.add(id);
      const color = tempColor(p.tmpf);
      const label = p.tmpf !== null ? `${Math.round(p.tmpf)}°` : '?°';
      const windStr = p.sknt ? `${Math.round(p.sknt)} kt ${windDirLabel(p.drct)}` : 'Calm';
      const dewStr = p.dwpf !== null ? `${Math.round(p.dwpf)}°F` : '—';
      const humStr = p.relh !== null ? `${Math.round(p.relh)}%` : '—';
      const popup = `
        <div class="popup-inner">
          <div class="popup-type" style="color:#ff9d4d">Weather Station</div>
          <div class="popup-msg"><b>${escapeHtml(p.name || id)}</b></div>
          <div class="popup-meta">
            🌡 ${label}F &nbsp;·&nbsp; 💧 Dew ${dewStr} &nbsp;·&nbsp; 💦 RH ${humStr}<br>
            💨 ${escapeHtml(windStr)}
            ${p.utc_valid ? `<br><small>Updated ${escapeHtml(p.utc_valid.replace('T', ' ').replace('+00:00', ' UTC'))}</small>` : ''}
          </div>
        </div>`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="temp-marker" style="background:${color}">${escapeHtml(label)}</div>`,
        iconSize: [32, 18],
        iconAnchor: [16, 9],
      });

      if (tempMarkers.has(id)) {
        const m = tempMarkers.get(id);
        m.setIcon(icon);
        m.getPopup()?.setContent(popup);
      } else {
        const m = L.marker([lat, lon], { icon, pane: layerPane('temp') }).bindPopup(popup);
        if (layerVisible.temp && denseLayerMode('temp', allTempStations.length).kind !== 'hidden') m.addTo(map);
        tempMarkers.set(id, m);
      }
    }
    // Remove stale stations
    for (const [id, m] of tempMarkers) {
      if (!seen.has(id)) { map.removeLayer(m); tempMarkers.delete(id); }
    }
    allTempStations = Array.from(tempMarkers.keys()).map(id => ({ id }));
    scheduleDenseLayerRefresh();
    markLayerFresh('temp');
  } catch(e) { console.warn('Temperature stations load failed:', e); }
}

// ── Emergency calls ───────────────────────────────────────────────────────
const EMER_ICON_MAP = {
  fire: { color: '#ff4500', symbol: '🔥' },
  medical: { color: '#e05252', symbol: '🚑' },
  police: { color: '#4f94cd', symbol: '🚔' },
  traffic: { color: '#f0a500', symbol: '🚗' },
  patrol: { color: '#6c8ebf', symbol: '👁' },
  warning: { color: '#d29922', symbol: '⚠' },
};

function emerIcon(iconFile) {
  const key = iconFile ? iconFile.replace('.png', '') : 'warning';
  const cfg = EMER_ICON_MAP[key] || EMER_ICON_MAP.warning;
  return L.divIcon({
    className: '',
    html: `<div class="emer-marker" style="background:${cfg.color}" title="${key}">${cfg.symbol}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11]
  });
}

async function loadEmergency() {
  try {
    const geojson = await fetch('/emergency').then(r => r.json());
    const seen = new Set();
    geojson.features.forEach(f => {
      const p = f.properties;
      const key = p.key;
      seen.add(key);
      const [lon, lat] = f.geometry.coordinates;
      emergencyFeedEntries.set(key, {
        key,
        id: key,
        kind: 'emergency',
        title: p.description || 'Emergency callout',
        lat,
        lon,
        location: p.location || null,
        source: p.source || 'Emergency',
        category: p.category || (p.icon ? p.icon.replace('.png', '') : null),
        timeMs: parseEventTimeMs(p.time),
        timeText: p.time || null
      });
      const iconType = (p.icon || 'warning').replace('.png', '');
      emerMarkerTypes.set(key, iconType);
      const age = Math.round((Date.now() - new Date(p.time).getTime()) / 60000);
      const popup = `<b>${escapeHtml(p.description)}</b><br>${escapeHtml(p.location)}<br><small>${escapeHtml(p.source)} · ${age} min ago</small>`;
      if (emerMarkers.has(key)) {
        const m = emerMarkers.get(key);
        m.setLatLng([lat, lon]);
        m.setIcon(emerIcon(p.icon));
        m.getPopup()?.setContent(popup);
      } else {
        const m = L.marker([lat, lon], {
          icon: emerIcon(p.icon),
          pane: layerPane('emer')
        }).bindPopup(popup);
        if (incidentLayerMarkersVisible('emer') && emerTypeVisible[iconType]) m.addTo(map);
        emerMarkers.set(key, m);
      }
    });
    // Remove stale markers
    for (const [key, m] of emerMarkers) {
      if (!seen.has(key)) { map.removeLayer(m); emerMarkers.delete(key); emerMarkerTypes.delete(key); }
    }
    for (const key of Array.from(emergencyFeedEntries.keys())) {
      if (!seen.has(key)) emergencyFeedEntries.delete(key);
    }
    markLayerFresh('emer');
    renderActivityFeed();
  } catch(e) { console.warn('Emergency load failed:', e); }
}

// ── Layer toggles ─────────────────────────────────────────────────────────
function toggleLayer(type) {
  if (DENSE_LAYER_KEYS.has(type)) {
    const minZoom = DENSE_LAYER_MIN_ZOOM[type] ?? 11;
    const zoomBlocked = map.getZoom() < minZoom;

    if (zoomBlocked) {
      if (denseLayerZoomOverride[type]) {
        denseLayerZoomOverride[type] = false;
        layerVisible[type] = true;
      } else if (layerVisible[type]) {
        denseLayerZoomOverride[type] = true;
      } else {
        layerVisible[type] = true;
        denseLayerZoomOverride[type] = true;
      }
    } else {
      layerVisible[type] = !layerVisible[type];
      if (!layerVisible[type]) denseLayerZoomOverride[type] = false;
    }

    refreshLayerToggleButtons();
    renderFreshnessPanel();
    renderActivityFeed();
    renderDenseLayers();
    if (type === 'sign' && layerVisible.sign) scheduleVisibleSignDetailRefresh(true);
    return;
  }

  if (type === 'inc') {
    const zoomBlocked = map.getZoom() < INCIDENT_LAYER_MIN_ZOOM;

    if (zoomBlocked) {
      if (incidentLayerZoomOverride) {
        incidentLayerZoomOverride = false;
        layerVisible.inc = true;
        layerVisible.emer = true;
      } else if (layerVisible.inc || layerVisible.emer) {
        incidentLayerZoomOverride = true;
      } else {
        layerVisible.inc = true;
        layerVisible.emer = true;
        incidentLayerZoomOverride = true;
      }
    } else {
      const nextVisible = !(layerVisible.inc && layerVisible.emer);
      layerVisible.inc = nextVisible;
      layerVisible.emer = nextVisible;
      if (!nextVisible) incidentLayerZoomOverride = false;
    }

    refreshLayerToggleButtons();
    renderFreshnessPanel();
    renderActivityFeed();
    syncIncidentLayerVisibility();
    return;
  }

  if (type === 'govair' || type === 'civair') {
    layerVisible[type] = !layerVisible[type];
    syncAircraftLayerVisibilityState();
    refreshLayerToggleButtons();
    renderFreshnessPanel();
    refreshAircraftMarkerVisibility();
    return;
  }

  layerVisible[type] = !layerVisible[type];
  refreshLayerToggleButtons();
  renderFreshnessPanel();
  renderActivityFeed();

  if (type === 'flow') {
    if (layerVisible.flow) flowLayer.addTo(map); else map.removeLayer(flowLayer);
    return;
  }
  if (type === 'radar') {
    if (layerVisible.radar) radarLayer.addTo(map); else map.removeLayer(radarLayer);
    return;
  }
  const markerMaps = {
    cam: camMarkers,
    sign: signMarkers,
    inc: incMarkers,
    con: conMarkers,
    emer: emerMarkers,
    sens: sensMarkers,
    lpr: lprMarkers
  };
  const targetMap = markerMaps[type];
  if (!targetMap) return;
  for (const [, marker] of targetMap) {
    if (layerVisible[type]) marker.addTo(map); else map.removeLayer(marker);
  }
}
renderFreshnessPanel();
renderActivityFeed();
syncMobileHeaderMenuState();
syncLiveStatusCollapsedState();
syncFeedPanelCollapsedState();
syncPanelCollapsedState();
window.addEventListener('resize', () => {
  syncMobileHeaderMenuState();
  syncLiveStatusCollapsedState();
  syncFeedPanelCollapsedState();
  syncPanelCollapsedState();
  renderCameraHopHud();
  renderActivityFeed();
});
document.addEventListener('click', (event) => {
  if (isDesktopPanelLayout() || !mobileHeaderMenuOpen) return;
  const header = document.querySelector('header');
  if (header && !header.contains(event.target)) {
    toggleMobileHeaderMenu(false);
  }
});
window.addEventListener('keydown', handleCameraHopKey);

document.getElementById('cam-list').addEventListener('click', (event) => {
  const item = event.target.closest('.cam-list-item');
  if (item?.dataset.id) selectCamera(item.dataset.id);
});

// ── Camera selection ──────────────────────────────────────────────────────
function selectCamera(id) {
  const cam = allCameras.find(c => c.id === id);
  if (!cam) return;

  const previousSelectedId = selectedId;
  if (previousSelectedId) {
    const old = allCameras.find(c => c.id === previousSelectedId);
    if (old && camMarkers.has(previousSelectedId)) camMarkers.get(previousSelectedId).setIcon(camIcon(old));
  }
  selectedId = id;
  syncCameraHopState();
  if (previousSelectedId) {
    const old = allCameras.find(c => c.id === previousSelectedId);
    if (old && camMarkers.has(previousSelectedId)) {
      camMarkers.get(previousSelectedId).setIcon(camIcon(old, false, cameraHopDirectionForId(previousSelectedId)));
    }
  }
  camMarkers.get(id)?.setIcon(camIcon(cam, true, cameraHopDirectionForId(id)));

  document.querySelectorAll('.cam-list-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id)
  );

  document.getElementById('panel-empty').style.display = 'none';
  document.getElementById('camera-view').style.display = 'flex';
  document.getElementById('panel').classList.add('open');
  panelCollapsed = false;
  syncPanelCollapsedState();

  refreshSelectedCameraMeta(cam);
  document.getElementById('cam-coords').textContent = `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}`;
  document.getElementById('btn-live').style.display = cam.video_enabled ? 'inline-block' : 'none';

  stopLive();
  showSnapshot();
  populateNearby(cam);
  hydrateCameraName(cam);
  const minZoom = cameraHopModeActive() ? CAMERA_HOP_MIN_ZOOM : CAMERA_RAW_MIN_ZOOM;
  const targetZoom = Math.max(map.getZoom(), minZoom);
  map.flyTo([cam.lat, cam.lon], targetZoom, { duration: 0.35 });
  scheduleDenseLayerRefresh();
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('camera-view').style.display = 'none';
  document.getElementById('panel-empty').style.display = 'flex';
  if (selectedId) {
    const previousSelectedId = selectedId;
    const old = allCameras.find(c => c.id === previousSelectedId);
    selectedId = null;
    syncCameraHopState();
    if (old && camMarkers.has(previousSelectedId)) camMarkers.get(previousSelectedId).setIcon(camIcon(old));
  }
  stopLive();
  syncPanelCollapsedState();
}

// ── Snapshot ──────────────────────────────────────────────────────────────
function showSnapshot() {
  stopLive();
  const cam = allCameras.find(c => c.id === selectedId);
  if (!cam) return;

  const img = document.getElementById('snapshot-img');
  const loading = document.getElementById('snapshot-loading');
  document.getElementById('video-el').style.display = 'none';
  img.style.display = 'block';
  document.getElementById('live-badge').style.display = 'none';
  document.getElementById('refresh-badge').style.display = 'block';
  document.getElementById('btn-stop').style.display = 'none';
  loading.style.display = 'flex';
  loading.textContent = 'Loading...';

  function loadSnap() {
    const tmp = new Image();
    tmp.onload = () => { img.src = tmp.src; loading.style.display = 'none'; };
    tmp.onerror = () => { loading.textContent = 'Snapshot unavailable'; };
    tmp.src = `${cam.snapshot_url}?t=${Date.now()}`;
  }
  loadSnap();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadSnap, 60000);
}

// ── Live video ────────────────────────────────────────────────────────────
async function showLive() {
  const cam = allCameras.find(c => c.id === selectedId);
  if (!cam) return;
  clearInterval(refreshTimer);

  const img = document.getElementById('snapshot-img');
  const video = document.getElementById('video-el');
  const loading = document.getElementById('snapshot-loading');

  img.style.display = 'none';
  video.style.display = 'block';
  loading.style.display = 'flex';
  loading.textContent = 'Authenticating...';
  document.getElementById('live-badge').style.display = 'block';
  document.getElementById('refresh-badge').style.display = 'none';
  document.getElementById('btn-stop').style.display = 'inline-block';

  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  // Always fetch the authenticated stream URL via proxy (video_url may be empty)
  let streamUrl = cam.video_url || null;
  try {
    const res = await fetch(`/video-token?id=${cam.id}`);
    if (res.ok) {
      const data = await res.json();
      streamUrl = data.url;
    }
  } catch(e) { /* fall back to base URL if available */ }

  if (!streamUrl) {
    loading.textContent = 'Stream unavailable';
    return;
  }

  loading.textContent = 'Connecting...';

  if (Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(streamUrl);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => { video.play(); loading.style.display = 'none'; });
    hlsInstance.on(Hls.Events.ERROR, (e, d) => {
      if (d.fatal) { loading.textContent = 'Stream unavailable'; loading.style.display = 'flex'; }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => { video.play(); loading.style.display = 'none'; });
  } else {
    loading.textContent = 'HLS not supported';
  }
}

function stopLive() {
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  const video = document.getElementById('video-el');
  video.pause(); video.src = ''; video.style.display = 'none';
  document.getElementById('live-badge').style.display = 'none';
  document.getElementById('btn-stop').style.display = 'none';
}

// ── Nearby list ───────────────────────────────────────────────────────────
function populateNearby(cam) {
  const nearby = allCameras
    .filter(c => c.id !== cam.id)
    .map(c => ({ camera: c, d: dist(cam.lat, cam.lon, c.lat, c.lon) }))
    .sort((a, b) => a.d - b.d).slice(0, 20);

  nearby.forEach(item => {
    if (!item.camera.nameResolved || !item.camera.name) hydrateCameraName(item.camera);
  });

  document.getElementById('cam-list').innerHTML = nearby.map(({ camera, d }) => `
    <div class="cam-list-item${camera.id === selectedId ? ' active' : ''}" data-id="${escapeHtml(camera.id)}">
      <div class="cam-dot ${camera.video_enabled ? 'live' : 'snap'}"></div>
      <div class="cam-list-name">${escapeHtml(cameraDisplayName(camera))}</div>
      <div class="cam-list-type">${(d * 69).toFixed(1)}mi</div>
    </div>`).join('');
}

function dist(a, b, c, d) { return Math.sqrt((c-a)**2+(d-b)**2); }

