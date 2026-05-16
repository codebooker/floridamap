#!/usr/bin/env python3
"""
Proxy server:
  GET /video-token?id={cameraId}  → 2-step FL511 auth, returns proxied m3u8 URL
  GET /stream/{host}/{path}?{qs}  → forwards to divas.cloud with FL511 Referer
  GET /*                          → static file serving
"""
import base64, concurrent.futures, datetime, hashlib, html, http, http.server, json, math, os, re, threading, time, urllib.error, urllib.parse, urllib.request

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from zoneinfo import ZoneInfo

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST = os.getenv('FLORIDAMAP_HOST', '127.0.0.1')
PORT = int(os.getenv('FLORIDAMAP_PORT', os.getenv('PORT', '8765')))
DEBUG = os.getenv('FLORIDAMAP_DEBUG', '').strip() == '1'
FL511_REFERER = 'https://fl511.com/'
FL_BOUNDS = { 'min_lat': 24.4, 'max_lat': 31.1, 'min_lon': -87.7, 'max_lon': -79.9 }
DAVNIT_KEEP_SOURCES = { 'OPD', 'OCSO', 'FHP' }
ALLOWED_STREAM_HOST_SUFFIXES = ('divas.cloud',)
PUBLIC_STATIC_FILES = frozenset({
    'index.html',
    'app.js',
    'floridamap-logo.svg',
    'floridamap-social-card.png',
    'floridamap-social-square.png',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'site.webmanifest',
    'robots.txt',
    'sitemap.xml',
})
SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': (
        "default-src 'self'; "
        "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: blob: https://fl511.com https://*.basemaps.cartocdn.com "
        "https://mapservices.weather.noaa.gov https://*.rainviewer.com "
        "https://*.arcgisonline.com https://tile.openweathermap.org; "
        "connect-src 'self' https://api.rainviewer.com; "
        "media-src 'self' blob:; "
        "frame-src 'none'; "
        "frame-ancestors 'self'; "
        "object-src 'none';"
    ),
}
EMERGENCY_CACHE_TTL = 75
EMERGENCY_CACHE = { 'expires_at': 0, 'body': None, 'refreshing': False, 'last_error': None }
EMERGENCY_CACHE_LOCK = threading.Lock()
POWER_OUTAGE_CACHE_TTL = 600
POWER_OUTAGE_CACHE = { 'expires_at': 0, 'body': None, 'refreshing': False, 'last_error': None }
POWER_OUTAGE_CACHE_LOCK = threading.Lock()
GEOCODE_CACHE = {}
GEOCODE_CACHE_LOCK = threading.Lock()
GEOCODE_CACHE_MAX_SIZE = 2048
GEOCODE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=8)
TAMPA_FIRE_GRID_CACHE = {}
TAMPA_FIRE_GRID_CACHE_LOCK = threading.Lock()
TAMPA_FIRE_GRID_CACHE_MAX_SIZE = 256
REGISTRY_CACHE_TTL = 86400
REGISTRY_CACHE_NEGATIVE_TTL = 21600
REGISTRY_CACHE = {}
REGISTRY_CACHE_LOCK = threading.Lock()
REGISTRY_CACHE_MAX_SIZE = 4096
RATE_LIMIT_WINDOW = 60
RATE_LIMITS = {
    '/video-token': 20,
    '/emergency': 10,
    '/power-outages': 10,
    '/aircraft': 30,
    '/sensors': 10,
    '/lpr': 5,
    '/temperature-stations': 10,
}
TEMPERATURE_CACHE_TTL = 300  # 5 minutes — matches IEM update cadence
TEMPERATURE_CACHE = { 'expires_at': 0, 'body': None, 'refreshing': False, 'last_error': None }
TEMPERATURE_CACHE_LOCK = threading.Lock()
RATE_LIMIT_DEFAULT = 120
_RATE_LIMIT_STATE = {}
_RATE_LIMIT_LOCK = threading.Lock()
AIRCRAFT_CACHE_TTL = 45
AIRCRAFT_CACHE_MAX_STALE = 300
AIRCRAFT_MIN_RELIABLE_COUNT = 8
AIRCRAFT_CACHE = {
    'expires_at': 0,
    'stale_until': 0,
    'body': None,
    'refreshing': False,
    'last_error': None,
    'last_good_count': 0,
}
AIRCRAFT_CACHE_LOCK = threading.Lock()
AIRCRAFT_PRIMARY_QUERY = (27.5, -83.5, 300)
AIRCRAFT_FALLBACK_QUERIES = (
    (30.3, -81.7, 300),
    (28.5, -81.4, 300),
    (26.1, -80.2, 300),
)
LOCAL_TZ = ZoneInfo('America/New_York')
PINELLAS_ACTIVITY_URL = 'https://911.pinellas.gov/files/Activity.json'
PINELLAS_SHERIFF_CALLS_URL = 'https://www.pinellassheriff.gov/ExternalSitePages/activecalls'
MARION_FIRE_CALLS_URL = 'https://bcc.marionfl.org/firecalls/activecadcalls.aspx'
MARTIN_FIRE_CALLS_URL = 'https://frd-scanner.martin.fl.us/frdcad.html'
MIAMI_DADE_FIRE_CALLS_URL = 'https://www.miamidade.gov/firecalls/calls.html'
JAX_SHERIFF_CALLS_URL = 'https://callsforservice.jaxsheriff.org/'
JAX_SHERIFF_MAX_CALLS = 40
TAMPA_FIRE_CALLS_URL = 'https://ncapps.tampagov.net/callsforservice/TFR/Json'
TAMPA_FIRE_GRID_QUERY_URL = 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Fire/MapServer/0/query'
TAMPA_FIRE_RECENT_HOURS = 8
CLEARWATER_POLICE_CALLS_URL = 'https://apps.myclearwater.com/activecalls/api/ActiveCalls'
TOPS_ACTIVE_INCIDENTS_URL = (
    'https://utility.arcgis.com/usrsvcs/servers'
    '/b1081fc7268643e5ab3253fc9bc3e1a5/rest/services/Active_Incidents_TOPS/FeatureServer/0/query'
)
TOPS_REFERER = 'https://www.talgov.com/gis/tops/'
DUKE_POWER_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Authorization': os.environ['DUKE_ENERGY_AUTH'],
}
DUKE_POWER_OUTAGES_URL = 'https://prod.apigee.duke-energy.app/outage-maps/v1/outages?jurisdiction=DEF'
DUKE_POWER_SUMMARY_URL = 'https://prod.apigee.duke-energy.app/outage-maps/v1/jurisdictions/DEF'
DUKE_POWER_DETAIL_URL = (
    'https://prod.apigee.duke-energy.app/outage-maps/v1/outages/outage'
    '?jurisdiction=DEF&sourceEventNumber={source_id}'
)
DUKE_POWER_DETAIL_LIMIT = 60
TECO_POWER_CONFIG_URL = 'https://outage-data-prod-hrcadje2h9aje9c9.a03.azurefd.net/api/v1/config'
TECO_POWER_TILES_URL = 'https://outage-data-prod-hrcadje2h9aje9c9.a03.azurefd.net/api/v1/outage-tiles'
TECO_POWER_SOURCE_URL = 'https://www.tampaelectric.com/poweroutages/'
KEYS_POWER_SOURCE_URL = 'https://powerstatus.keysenergy.com/'
KEYS_POWER_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': KEYS_POWER_SOURCE_URL,
    'Accept': 'application/json,text/plain,*/*',
}
KEYS_POWER_SUMMARY_URL = urllib.parse.urljoin(KEYS_POWER_SOURCE_URL, 'data/outageSummary.json')
KEYS_POWER_OUTAGES_URL = urllib.parse.urljoin(KEYS_POWER_SOURCE_URL, 'data/outages.json')
KEYS_POWER_POLYGONS_URL = urllib.parse.urljoin(KEYS_POWER_SOURCE_URL, 'data/outagePolygons.json')
KUBRA_POWER_PROVIDERS = {
    'jea': {
        'name': 'JEA',
        'instance_id': '2bb4315d-ff9d-4937-a231-57b8a9df189c',
        'view_id': '40a074f2-b303-42b7-b717-ed7d9d2ad9e2',
        'source_url': 'https://www.jea.com/Outage_Center/Outage_Map/',
    },
    'lakeland': {
        'name': 'Lakeland Electric',
        'instance_id': 'ea5d4449-04f0-4511-ba9e-c96762eda641',
        'view_id': 'f362d0d7-4493-4d66-bdd5-6b66609744b7',
        'source_url': 'https://outagemap.lakelandelectric.com/',
    },
    'ouc': {
        'name': 'OUC',
        'instance_id': 'b26c1223-ffac-4e60-b9de-402fbc33f9e4',
        'view_id': '535dc59f-6e00-445d-a855-73c700c6c451',
        'source_url': 'https://www.ouc.com/customer-service/outage-map/',
    },
    'seco': {
        'name': 'SECO Energy',
        'instance_id': 'c63333d7-dc3c-4fb1-b874-461216e528bf',
        'view_id': '0730fe50-c114-4eb0-97a9-3553ab8421cd',
        'source_url': 'https://stormcenter.secoenergy.com/',
    },
}

PULSEPOINT_FL_AGENCIES = {
    "EMS1296": "Alachua/Gainesville",
    "06142": "Boca Raton Fire",
    "EMS1236": "Brevard County Fire",
    "10282": "Broward County Fire",
    "48032": "Clay County Fire",
    "10021": "Coconut Creek FR",
    "CCSO1": "Collier Co Sheriff",
    "10151": "Coral Springs FD",
    "10242": "Davie Fire",
    "06172": "Delray Fire",
    "10192": "Fort Lauderdale Fire",
    "06062": "Greenacres Fire",
    "10052": "Hollywood Fire",
    "10062": "Lauderhill FD",
    "10252": "Lighthouse Pt Fire",
    "EMS1203": "Manatee County",
    "10092": "Margate Fire Rescue",
    "14162": "Marion County",
    "X1012": "Miami Beach Fire",
    "10232": "Miramar Fire-Rescue",
    "10132": "N Lauderdale Fire",
    "06102": "N Palm Beach Fire",
    "10182": "Oakland Park Fire",
    "65060": "Orange County Fire",
    "PID136": "Orlando Airport Fire",
    "07212": "Orlando FD",
    "06042": "PB Gardens Fire",
    "06301": "Palm Beach Co Fire",
    "28042": "Pasco County Fire",
    "10082": "Pembroke Pines Fire",
    "5102x": "Polk County Fire",
    "10125": "Pompano Beach Fire",
    "16072": "Sarasota County",
    "17022": "Seminole County Fire",
    "36011": "South Walton Fire",
    "X4015": "Sumter Fire & EMS",
    "10162": "Sunrise Fire Rescue",
    "10202": "Tamarac Fire",
    "06272": "West Palm Beach Fire",
    "07042": "Winter Park Fire",
}

PULSEPOINT_CALL_TYPES = {
    "AA": ("Auto Aid", "Aid"),
    "MU": ("Mutual Aid", "Aid"),
    "ST": ("Strike Team/Task Force", "Aid"),
    "AC": ("Aircraft Crash", "Aircraft"),
    "AE": ("Aircraft Emergency", "Aircraft"),
    "AES": ("Aircraft Emergency Standby", "Aircraft"),
    "LZ": ("Landing Zone", "Aircraft"),
    "AED": ("AED Alarm", "Alarm"),
    "OA": ("Alarm", "Alarm"),
    "CMA": ("Carbon Monoxide", "Alarm"),
    "FA": ("Fire Alarm", "Alarm"),
    "MA": ("Manual Alarm", "Alarm"),
    "SD": ("Smoke Detector", "Alarm"),
    "TRBL": ("Trouble Alarm", "Alarm"),
    "WFA": ("Waterflow Alarm", "Alarm"),
    "FL": ("Flooding", "Assist"),
    "LR": ("Ladder Request", "Assist"),
    "LA": ("Lift Assist", "Assist"),
    "PA": ("Police Assist", "Assist"),
    "PS": ("Public Service", "Assist"),
    "SH": ("Sheared Hydrant", "Assist"),
    "EX": ("Explosion", "Explosion"),
    "PE": ("Pipeline Emergency", "Explosion"),
    "TE": ("Transformer Explosion", "Explosion"),
    "AF": ("Appliance Fire", "Fire"),
    "CHIM": ("Chimney Fire", "Fire"),
    "CF": ("Commercial Fire", "Fire"),
    "WSF": ("Confirmed Structure Fire", "Fire"),
    "WVEG": ("Confirmed Vegetation Fire", "Fire"),
    "CB": ("Controlled Burn/Prescribed Fire", "Fire"),
    "ELF": ("Electrical Fire", "Fire"),
    "EF": ("Extinguished Fire", "Fire"),
    "FIRE": ("Fire", "Fire"),
    "FULL": ("Full Assignment", "Fire"),
    "IF": ("Illegal Fire", "Fire"),
    "MF": ("Marine Fire", "Fire"),
    "OF": ("Outside Fire", "Fire"),
    "PF": ("Pole Fire", "Fire"),
    "GF": ("Refuse/Garbage Fire", "Fire"),
    "RF": ("Residential Fire", "Fire"),
    "SF": ("Structure Fire", "Fire"),
    "TF": ("Tank Fire", "Fire"),
    "VEG": ("Vegetation Fire", "Fire"),
    "VF": ("Vehicle Fire", "Fire"),
    "WF": ("Confirmed Fire", "Fire"),
    "WCF": ("Working Commercial Fire", "Fire"),
    "WRF": ("Working Residential Fire", "Fire"),
    "BT": ("Bomb Threat", "Hazard"),
    "EE": ("Electrical Emergency", "Hazard"),
    "EM": ("Emergency", "Hazard"),
    "ER": ("Emergency Response", "Hazard"),
    "GAS": ("Gas Leak", "Hazard"),
    "HC": ("Hazardous Condition", "Hazard"),
    "HMR": ("Hazardous Response", "Hazard"),
    "TD": ("Tree Down", "Hazard"),
    "WE": ("Water Emergency", "Hazard"),
    "AI": ("Arson Investigation", "Investigation"),
    "FWI": ("Fireworks Investigation", "Investigation"),
    "HMI": ("Hazmat Investigation", "Investigation"),
    "INV": ("Investigation", "Investigation"),
    "OI": ("Odor Investigation", "Investigation"),
    "SI": ("Smoke Investigation", "Investigation"),
    "CL": ("Commercial Lockout", "Lockout"),
    "LO": ("Lockout", "Lockout"),
    "RL": ("Residential Lockout", "Lockout"),
    "VL": ("Vehicle Lockout", "Lockout"),
    "CP": ("Community Paramedicine", "Medical"),
    "IFT": ("Interfacility Transfer", "Medical"),
    "ME": ("Medical Emergency", "Medical"),
    "MCI": ("Multi Casualty", "Medical"),
    "EQ": ("Earthquake", "Natural Disaster"),
    "FLW": ("Flood Warning", "Natural Disaster"),
    "TOW": ("Tornado Warning", "Natural Disaster"),
    "TSW": ("Tsunami Warning", "Natural Disaster"),
    "WX": ("Weather Incident", "Natural Disaster"),
    "AR": ("Animal Rescue", "Rescue"),
    "CR": ("Cliff Rescue", "Rescue"),
    "CSR": ("Confined Space Rescue", "Rescue"),
    "ELR": ("Elevator Rescue", "Rescue"),
    "EER": ("Elevator/Escalator Rescue", "Rescue"),
    "IR": ("Ice Rescue", "Rescue"),
    "IA": ("Industrial Accident", "Rescue"),
    "RES": ("Rescue", "Rescue"),
    "RR": ("Rope Rescue", "Rescue"),
    "SC": ("Structural Collapse", "Rescue"),
    "TR": ("Technical Rescue", "Rescue"),
    "TNR": ("Trench Rescue", "Rescue"),
    "USAR": ("Urban Search and Rescue", "Rescue"),
    "VS": ("Vessel Sinking", "Rescue"),
    "WR": ("Water Rescue", "Rescue"),
    "TCP": ("Collision Involving Pedestrian", "Vehicle"),
    "TCS": ("Collision Involving Structure", "Vehicle"),
    "TCT": ("Collision Involving Train", "Vehicle"),
    "TCE": ("Expanded Traffic Collision", "Vehicle"),
    "RTE": ("Railroad/Train Emergency", "Vehicle"),
    "TC": ("Traffic Collision", "Vehicle"),
    "PLE": ("Powerline Emergency", "Wires"),
    "WA": ("Wires Arching", "Wires"),
    "WD": ("Wires Down", "Wires"),
    "WDA": ("Wires Down/Arcing", "Wires"),
    "BP": ("Burn Permit", "Other"),
    "CA": ("Community Activity", "Other"),
    "FW": ("Fire Watch", "Other"),
    "MC": ("Move-up/Cover", "Other"),
    "NO": ("Notification", "Other"),
    "STBY": ("Standby", "Other"),
    "TEST": ("Test", "Other"),
    "TRNG": ("Training", "Other"),
    "NEWS": ("News", "Alert"),
    "CERT": ("CERT", "Alert"),
    "DISASTER": ("Disaster", "Alert"),
    "UNK": ("Unknown Call Type", "Unknown"),
}


def in_florida(lat, lon):
    return (
        lat != 0 and lon != 0 and
        FL_BOUNDS['min_lat'] <= lat <= FL_BOUNDS['max_lat'] and
        FL_BOUNDS['min_lon'] <= lon <= FL_BOUNDS['max_lon']
    )


def display_text(value):
    text = str(value or '').strip()
    if not text:
        return ''
    return text.title() if text.upper() == text else text


def file_path(name):
    return os.path.join(BASE_DIR, name)


def normalized_host(value):
    host = str(value or '').strip().lower()
    if not host:
        return ''
    if host.startswith('['):
        end = host.find(']')
        return host[1:end] if end != -1 else host.strip('[]')
    if host.count(':') == 1:
        return host.split(':', 1)[0]
    return host


DEFAULT_ALLOWED_HOSTS = tuple(sorted({
    host for host in (
        normalized_host(HOST),
        'localhost',
        '127.0.0.1',
        '::1',
    ) if host and host not in {'0.0.0.0', '::'}
}))
ALLOWED_HOSTS = tuple(
    part for part in (
        normalized_host(raw)
        for raw in os.getenv('FLORIDAMAP_ALLOWED_HOSTS', ','.join(DEFAULT_ALLOWED_HOSTS)).split(',')
    )
    if part
)


def allowed_request_host(hostname):
    host = normalized_host(hostname)
    if not host:
        return False
    for allowed in ALLOWED_HOSTS:
        if allowed == '*':
            return True
        if allowed.startswith('*.'):
            if host.endswith(allowed[1:]) and host != allowed[2:]:
                return True
            continue
        if host == allowed:
            return True
    return False


def allowed_stream_host(hostname):
    host = str(hostname or '').strip().lower()
    if not host:
        return False
    return any(host == suffix or host.endswith('.' + suffix) for suffix in ALLOWED_STREAM_HOST_SUFFIXES)


def valid_numeric_id(value):
    return bool(re.fullmatch(r'\d{1,18}', str(value or '').strip()))


def valid_icao(value):
    return bool(re.fullmatch(r'[0-9a-fA-F]{6}', str(value or '').strip()))


def safe_int_param(value, minimum=None, maximum=None):
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return None
    if minimum is not None and parsed < minimum:
        return None
    if maximum is not None and parsed > maximum:
        return None
    return parsed


def public_static_target(path):
    raw_path = urllib.parse.unquote(path or '/')
    if raw_path in {'', '/'}:
        return 'index.html'
    target = raw_path.lstrip('/')
    if not target or '/' in target or '\\' in target or target.startswith('.'):
        return None
    return target if target in PUBLIC_STATIC_FILES else None


def normalized_cache_key(value):
    return ' '.join(str(value or '').split())


def strip_tags(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', str(value or ''))).split())


def local_time_iso(value):
    try:
        now = datetime.datetime.now(LOCAL_TZ)
        hour, minute, second = [int(part) for part in str(value).split(':')]
        stamp = now.replace(hour=hour, minute=minute, second=second, microsecond=0)
        if stamp > now + datetime.timedelta(minutes=5):
            stamp -= datetime.timedelta(days=1)
        return stamp.isoformat()
    except (AttributeError, TypeError, ValueError):
        return None


def geocode_query(location, locality=''):
    text = ' '.join(str(location or '').split())
    if not text:
        return ''
    text = html.unescape(text)
    text = re.sub(r'(?i)\b(\d{1,5})\s+BLOCK\s*&\s+', r'\1 ', text)
    text = re.sub(r'\s*/\s*', ' & ', text)
    text = re.sub(r'\s+', ' ', text).strip(' ,')
    return f'{text}, {locality}' if locality else text


def parse_time_iso(value, formats):
    text = ' '.join(str(value or '').split())
    if not text:
        return None
    now = datetime.datetime.now(LOCAL_TZ)
    for fmt in formats:
        try:
            stamp = datetime.datetime.strptime(text, fmt)
        except (TypeError, ValueError):
            continue
        if '%Y' not in fmt:
            stamp = stamp.replace(year=now.year)
            if stamp.replace(tzinfo=LOCAL_TZ) > now + datetime.timedelta(days=1):
                stamp = stamp.replace(year=now.year - 1)
        return stamp.replace(tzinfo=LOCAL_TZ).isoformat()
    return None


def tops_time_iso(value):
    try:
        text = ' '.join(str(value or '').split())
        if not text:
            return None
        stamp = datetime.datetime.strptime(text, '%b %d %Y %I:%M%p')
        return stamp.replace(tzinfo=LOCAL_TZ).isoformat()
    except (TypeError, ValueError):
        return None


def web_mercator_to_latlon(x, y):
    lon = x * 180.0 / 20037508.34
    lat = y * 180.0 / 20037508.34
    lat = 180.0 / math.pi * (2.0 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lat, lon


def rings_center(rings):
    points = [
        (float(point[0]), float(point[1]))
        for ring in (rings or [])
        for point in ring
        if len(point) >= 2
    ]
    if not points:
        return None
    min_lon = min(point[0] for point in points)
    max_lon = max(point[0] for point in points)
    min_lat = min(point[1] for point in points)
    max_lat = max(point[1] for point in points)
    lat = (min_lat + max_lat) / 2.0
    lon = (min_lon + max_lon) / 2.0
    return (lat, lon) if in_florida(lat, lon) else None


def safe_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def fetch_json_url(url, headers=None, data=None, timeout=20):
    req_headers = {'User-Agent': 'Mozilla/5.0'}
    if headers:
        req_headers.update(headers)
    payload = data
    if isinstance(data, (dict, list)):
        payload = json.dumps(data).encode('utf-8')
        req_headers.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, data=payload, headers=req_headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def decode_polyline_points(encoded, precision=5):
    if not encoded:
        return []
    index = 0
    lat = 0
    lon = 0
    factor = 10 ** precision
    coords = []
    while index < len(encoded):
        result = 1
        shift = 0
        while True:
            b = ord(encoded[index]) - 63 - 1
            index += 1
            result += b << shift
            shift += 5
            if b < 0x1F:
                break
        lat += ~(result >> 1) if result & 1 else (result >> 1)

        result = 1
        shift = 0
        while True:
            b = ord(encoded[index]) - 63 - 1
            index += 1
            result += b << shift
            shift += 5
            if b < 0x1F:
                break
        lon += ~(result >> 1) if result & 1 else (result >> 1)
        coords.append((lat / factor, lon / factor))
    return coords


def point_geometry(lat, lon):
    return {
        'type': 'Point',
        'coordinates': [lon, lat],
    }


def polygon_geometry_from_points(points):
    if len(points) < 3:
        return None
    coords = [[lon, lat] for lat, lon in points]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return {
        'type': 'Polygon',
        'coordinates': [coords],
    }


def polygon_geometry_from_google_points(points):
    coords = [
        [safe_float(point.get('lng')), safe_float(point.get('lat'))]
        for point in (points or [])
        if point.get('lat') is not None and point.get('lng') is not None
    ]
    if len(coords) < 3:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return {
        'type': 'Polygon',
        'coordinates': [coords],
    }


def kubra_geometry(geom):
    rings = []
    for encoded in (geom or {}).get('a') or []:
        points = decode_polyline_points(encoded)
        if len(points) >= 3:
            rings.append(points)
    if not rings:
        return None
    if len(rings) == 1:
        return polygon_geometry_from_points(rings[0])
    polygons = []
    for ring in rings:
        polygon = polygon_geometry_from_points(ring)
        if polygon:
            polygons.append([polygon['coordinates'][0]])
    if not polygons:
        return None
    return {
        'type': 'MultiPolygon',
        'coordinates': polygons,
    }


def kubra_center(geom):
    for encoded in (geom or {}).get('p') or []:
        points = decode_polyline_points(encoded)
        if points:
            lat, lon = points[0]
            if in_florida(lat, lon):
                return lat, lon
    for encoded in (geom or {}).get('a') or []:
        points = decode_polyline_points(encoded)
        if not points:
            continue
        lat = sum(point[0] for point in points) / len(points)
        lon = sum(point[1] for point in points) / len(points)
        if in_florida(lat, lon):
            return lat, lon
    return None


def geojson_center(geometry):
    geometry_type = (geometry or {}).get('type')
    coords = (geometry or {}).get('coordinates') or []
    if geometry_type == 'Point' and len(coords) >= 2:
        lat = safe_float(coords[1])
        lon = safe_float(coords[0])
        return (lat, lon) if in_florida(lat, lon) else None
    if geometry_type == 'Polygon':
        return rings_center(coords)
    if geometry_type == 'MultiPolygon':
        return rings_center([
            ring
            for polygon in coords
            for ring in (polygon or [])
        ])
    return None


def keys_power_geometry(item):
    points = (item or {}).get('points') or {}
    coords = points.get('coordinates')
    geometry_type = points.get('type')
    if not coords:
        return None
    if geometry_type == 'Polygon':
        return {
            'type': 'Polygon',
            'coordinates': coords,
        }
    if geometry_type == 'MultiPolygon':
        return {
            'type': 'MultiPolygon',
            'coordinates': coords,
        }
    return None


def kubra_provider_state(provider):
    base = (
        'https://kubra.io/stormcenter/api/v1/stormcenters/'
        f'{provider["instance_id"]}/views/{provider["view_id"]}'
    )
    state = fetch_json_url(f'{base}/currentState')
    config = fetch_json_url(f'{base}/configuration/{state["stormcenterDeploymentId"]}')
    inner = config.get('config') or config
    return state, inner


def kubra_provider_summary(name, source_url, summary_doc):
    summary_data = (summary_doc.get('summaryFileData') or {})
    totals = ((summary_data.get('totals') or [{}])[0] or {})
    return {
        'provider': name,
        'source_url': source_url,
        'total_outages': safe_int(totals.get('total_outages')),
        'total_customers_affected': safe_int((totals.get('total_cust_a') or {}).get('val')),
        'total_customers_served': safe_int(totals.get('total_cust_s')),
        'last_updated': summary_data.get('date_generated'),
        'mappable': False,
    }


def geocode_location(query):
    key = normalized_cache_key(query)
    if not key:
        return None
    with GEOCODE_CACHE_LOCK:
        if key in GEOCODE_CACHE:
            return GEOCODE_CACHE[key]

    params = urllib.parse.urlencode({
        'SingleLine': key,
        'f': 'json',
        'outFields': 'Match_addr,Addr_type,Type',
        'maxLocations': 1,
        'outSR': 4326,
    })
    url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?' + params
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.arcgis.com/',
    })

    result = None
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=20).read())
        for candidate in data.get('candidates') or []:
            if float(candidate.get('score') or 0) < 80:
                continue
            location = candidate.get('location') or {}
            lat = float(location.get('y') or 0)
            lon = float(location.get('x') or 0)
            if in_florida(lat, lon):
                result = (lat, lon)
                break
    except Exception:
        result = None

    with GEOCODE_CACHE_LOCK:
        _evict_if_full(GEOCODE_CACHE, GEOCODE_CACHE_MAX_SIZE)
        GEOCODE_CACHE[key] = result
    return result


def parallel_geocode_queries(queries, max_workers=6):
    ordered_keys = []
    seen = set()
    for query in queries:
        key = normalized_cache_key(query)
        if key and key not in seen:
            seen.add(key)
            ordered_keys.append(key)

    if not ordered_keys:
        return {}

    if len(ordered_keys) == 1:
        key = ordered_keys[0]
        return {key: geocode_location(key)}

    futures = {
        GEOCODE_EXECUTOR.submit(geocode_location, key): key
        for key in ordered_keys[:max_workers]
    }
    pending_keys = ordered_keys[max_workers:]
    results = {}

    while futures:
        done, _ = concurrent.futures.wait(
            futures,
            return_when=concurrent.futures.FIRST_COMPLETED
        )
        for future in done:
            key = futures.pop(future)
            try:
                results[key] = future.result()
            except Exception:
                results[key] = None
            if pending_keys:
                next_key = pending_keys.pop(0)
                futures[GEOCODE_EXECUTOR.submit(geocode_location, next_key)] = next_key

    return results


def pulsepoint_secret():
    return os.environ['PULSEPOINT_SECRET']


def pulsepoint_evp_bytes_to_key(password, salt, key_len=32, iv_len=16):
    data = b''
    prev = b''
    while len(data) < key_len + iv_len:
        prev = hashlib.md5(prev + password + salt).digest()
        data += prev
    return data[:key_len], data[key_len:key_len + iv_len]


def decrypt_pulsepoint_payload(content):
    payload = json.loads(content.decode('utf-8') if isinstance(content, bytes) else content)
    ciphertext = base64.b64decode(payload['ct'])
    salt = bytes.fromhex(payload['s']) if payload.get('s') else b''
    iv = bytes.fromhex(payload['iv']) if payload.get('iv') else None
    key, derived_iv = pulsepoint_evp_bytes_to_key(pulsepoint_secret().encode(), salt)
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv or derived_iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    pad_len = padded[-1]
    plaintext = padded[:-pad_len].decode('utf-8')
    return json.loads(json.loads(plaintext))


def pulsepoint_call_info(call_type):
    return PULSEPOINT_CALL_TYPES.get(call_type or 'UNK', (call_type or 'Incident', 'Unknown'))


def pulsepoint_icon(category, description):
    if category == 'Medical':
        return 'medical.png'
    if category in { 'Fire', 'Alarm', 'Explosion' }:
        return 'fire.png'
    if category == 'Vehicle':
        return 'traffic.png'
    if description == 'Police Assist':
        return 'police.png'
    if category in { 'Aid', 'Assist', 'Investigation', 'Lockout', 'Other' }:
        return 'patrol.png'
    return 'warning.png'


def pinellas_icon(call_type, call_code, units):
    type_upper = str(call_type or '').upper()
    code_upper = str(call_code or '').upper()
    unit_text = ' '.join(
        f'{unit.get("ID", "")} {unit.get("Type", "")} {unit.get("Station", "")}'
        for unit in (units or [])
    ).upper()
    if 'MED' in type_upper or code_upper in { 'ME', 'AED' } or any(token in unit_text for token in { 'AMBULANCE', 'RESCUE', 'SQUAD' }):
        return 'medical.png'
    if any(token in type_upper for token in { 'FIRE', 'ALARM', 'SMOKE' }) or code_upper.startswith('F') or any(token in unit_text for token in { 'ENGINE', 'LADDER', 'TRUCK' }):
        return 'fire.png'
    if any(token in type_upper for token in { 'TRAFFIC', 'CRASH', 'ACCIDENT' }) or code_upper in { 'TC', 'TA' }:
        return 'traffic.png'
    if any(token in unit_text for token in { 'PATROL', 'POLICE', 'SHERIFF' }):
        return 'police.png'
    return 'warning.png'


def incident_icon(description, default='warning.png'):
    text = str(description or '').upper()
    if any(token in text for token in { 'MEDICAL', 'OVERDOSE', 'CHEST PAIN', 'STROKE', 'TRAUMA', 'HEMORRHAGE', 'BREATHING', 'FALLS', 'SICK PERSON' }):
        return 'medical.png'
    if any(token in text for token in { 'FIRE', 'SMOKE', 'WILDLAND', 'ALARM', 'EXPLOSION' }):
        return 'fire.png'
    if any(token in text for token in { 'TRAFFIC', 'CRASH', 'VEHICLE', 'TRANSPORT' }):
        return 'traffic.png'
    if any(token in text for token in { 'PATROL', 'SUSPICIOUS', 'ASSIST', 'DETAIL', 'BAKER', 'JUVENILE', 'CIVIL', 'INVESTIGATION', 'FRAUD', 'ALARM-', 'STOP', 'OFFENDER', 'WELL BEING', 'CITIZEN' }):
        return 'police.png'
    return default


def tops_icon(description):
    text = str(description or '').upper()
    if any(token in text for token in { 'TRAFFIC', 'CRASH', 'ACCIDENT', 'HIT AND RUN' }):
        return 'traffic.png'
    if any(token in text for token in { 'FIRE', 'SMOKE', 'EXPLOSION' }):
        return 'fire.png'
    return 'police.png'


def fetch_davnit_emergency():
    req = urllib.request.Request(
        'https://www.davnit.net/esmap/api/incidents/active',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read())
    features = []
    for feature in data.get('features', []):
        props = feature.get('properties') or {}
        coords = (feature.get('geometry') or {}).get('coordinates') or []
        if len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            continue
        if props.get('source') not in DAVNIT_KEEP_SOURCES or not in_florida(lat, lon):
            continue
        features.append(feature)
    return features


def fetch_pulsepoint_incidents():
    agency_ids = ','.join(PULSEPOINT_FL_AGENCIES.keys())
    url = f'https://api.pulsepoint.org/v1/webapp?resource=incidents&agencyid={urllib.parse.quote(agency_ids)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, timeout=20)
    payload = decrypt_pulsepoint_payload(resp.read())
    active = (payload.get('incidents') or {}).get('active') or []
    features = []
    for item in active:
        try:
            lat = float(item.get('Latitude') or 0)
            lon = float(item.get('Longitude') or 0)
        except (TypeError, ValueError):
            continue
        if not in_florida(lat, lon):
            continue

        agency_id = str(item.get('AgencyID') or '')
        call_type = str(item.get('PulsePointIncidentCallType') or 'UNK')
        description, category = pulsepoint_call_info(call_type)
        location = (
            item.get('FullDisplayAddress') or
            item.get('MedicalEmergencyDisplayAddress') or
            'Unknown location'
        )
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': description,
                'icon': pulsepoint_icon(category, description),
                'key': f'pp:{agency_id}:{item.get("ID")}',
                'location': location,
                'source': PULSEPOINT_FL_AGENCIES.get(agency_id, agency_id or 'PulsePoint'),
                'source_id': agency_id,
                'time': item.get('CallReceivedDateTime'),
                'category': category,
                'call_type': call_type,
            }
        })
    return features


def fetch_pinellas_emergency():
    req = urllib.request.Request(
        PINELLAS_ACTIVITY_URL,
        headers={
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://911.pinellas.gov/',
        }
    )
    resp = urllib.request.urlopen(req, timeout=20)
    data = json.loads(resp.read())
    features = []
    for item in data.get('CallInfo', []):
        try:
            lat = float(item.get('Lat') or 0)
            lon = float(item.get('Lon') or 0)
        except (TypeError, ValueError):
            continue
        if not in_florida(lat, lon):
            continue
        units = item.get('Units') or []
        description = display_text(item.get('Type') or item.get('Code') or 'Incident')
        location = item.get('Location') or item.get('Grid') or 'Unknown location'
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': description,
                'icon': pinellas_icon(item.get('Type'), item.get('Code'), units),
                'key': f'pinellas:{item.get("IncidentNo")}',
                'location': location,
                'source': 'Pinellas 911',
                'source_id': item.get('IncidentNo'),
                'time': local_time_iso(item.get('Received')) or item.get('Received'),
                'category': 'Pinellas',
                'call_type': item.get('Code') or item.get('Type'),
            }
        })
    return features


def fetch_pinellas_sheriff_calls():
    req = urllib.request.Request(
        PINELLAS_SHERIFF_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    html_text = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    rows = re.findall(
        r'<tr><td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td></tr>',
        html_text,
        re.S
    )
    records = []
    for report, when, problem, address, units in rows:
        report = strip_tags(report)
        address = strip_tags(address)
        problem = display_text(strip_tags(problem))
        query = f'{address}, Pinellas County, Florida'
        records.append({
            'report': report,
            'when': when,
            'problem': problem,
            'address': address,
            'query': query,
        })

    geocodes = parallel_geocode_queries((record['query'] for record in records))
    features = []
    for record in records:
        coords = geocodes.get(normalized_cache_key(record['query']))
        if not coords:
            continue
        lat, lon = coords
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': record['problem'] or 'Police Call',
                'icon': incident_icon(record['problem'], default='police.png'),
                'key': f'pcso:{record["report"]}',
                'location': record['address'] or 'Unknown location',
                'source': 'Pinellas Sheriff',
                'source_id': record['report'],
                'time': parse_time_iso(strip_tags(record['when']), ['%m/%d/%Y %I:%M:%S %p']) or strip_tags(record['when']),
                'category': 'Police',
                'call_type': record['problem'],
            }
        })
    return features


def fetch_marion_fire_calls():
    req = urllib.request.Request(
        MARION_FIRE_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    html_text = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    rows = re.findall(r'<tr>(.*?)</tr>', html_text, re.S)
    records = []
    for row in rows:
        cells = [strip_tags(cell) for cell in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) != 6:
            continue
        when, incident_id, call_type, units, status, location = cells
        if not incident_id:
            continue
        query = f'{location}, Marion County, Florida'
        records.append({
            'when': when,
            'incident_id': incident_id,
            'call_type': call_type,
            'location': location,
            'query': query,
        })

    geocodes = parallel_geocode_queries((record['query'] for record in records))
    features = []
    for record in records:
        coords = geocodes.get(normalized_cache_key(record['query']))
        if not coords:
            continue
        lat, lon = coords
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': display_text(record['call_type']) or 'Fire/Rescue Call',
                'icon': incident_icon(record['call_type'], default='fire.png'),
                'key': f'marion:{record["incident_id"]}',
                'location': display_text(record['location']) or 'Unknown location',
                'source': 'Marion Fire/Rescue',
                'source_id': record['incident_id'],
                'time': parse_time_iso(record['when'], ['%b %d, %H:%M']) or record['when'],
                'category': 'Fire/EMS',
                'call_type': record['call_type'],
            }
        })
    return features


def fetch_martin_fire_calls():
    req = urllib.request.Request(
        MARTIN_FIRE_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    html_text = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    match = re.search(r'Last update\s+(\d+/\d+/\d+\s+\d+:\d+:\d+)', html_text, re.I)
    last_update = match.group(1) if match else ''
    rows = re.findall(r'<tr>(.*?)</tr>', html_text, re.S)
    records = []
    for row in rows:
        cells = [strip_tags(cell) for cell in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) < 8 or not re.fullmatch(r'\d+', cells[0]):
            continue
        incident_id, unit, status, prefix, street, suffix, code, call_type = cells[:8]
        location = ' '.join(part for part in [prefix, street, suffix] if part)
        query = f'{location}, Martin County, Florida'
        records.append({
            'incident_id': incident_id,
            'code': code,
            'call_type': call_type,
            'location': location,
            'query': query,
        })

    geocodes = parallel_geocode_queries((record['query'] for record in records))
    features = []
    for record in records:
        coords = geocodes.get(normalized_cache_key(record['query']))
        if not coords:
            continue
        lat, lon = coords
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': display_text(record['call_type']) or 'Fire/Rescue Call',
                'icon': incident_icon(record['call_type'], default='medical.png'),
                'key': f'martin:{record["incident_id"]}',
                'location': display_text(record['location']) or 'Unknown location',
                'source': 'Martin Fire Rescue',
                'source_id': record['incident_id'],
                'time': parse_time_iso(last_update, ['%m/%d/%Y %H:%M:%S']) or last_update,
                'category': 'Fire/EMS',
                'call_type': record['code'] or record['call_type'],
            }
        })
    return features


def tampa_fire_grid_info(grid):
    key = str(grid or '').strip()
    if not key:
        return None
    with TAMPA_FIRE_GRID_CACHE_LOCK:
        if key in TAMPA_FIRE_GRID_CACHE:
            return TAMPA_FIRE_GRID_CACHE[key]

    if not re.fullmatch(r'[\w\-]{1,20}', key):
        return None
    where = f'LABEL = {int(key)}' if key.isdigit() and len(key) <= 3 else f"FIRE_GRID = '{key}'"
    params = urllib.parse.urlencode({
        'where': where,
        'outFields': 'LABEL,COMMUNITY,FIRESTATION,FIRE_GRID',
        'returnGeometry': 'true',
        'f': 'json',
        'outSR': 4326,
    })
    req = urllib.request.Request(
        f'{TAMPA_FIRE_GRID_QUERY_URL}?{params}',
        headers={'User-Agent': 'Mozilla/5.0'}
    )

    result = None
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=20).read())
        feature = (data.get('features') or [None])[0] or {}
        attrs = feature.get('attributes') or {}
        coords = rings_center((feature.get('geometry') or {}).get('rings'))
        if coords:
            result = {
                'coords': coords,
                'community': display_text(attrs.get('COMMUNITY')),
                'label': attrs.get('LABEL') or attrs.get('FIRE_GRID') or key,
                'station': attrs.get('FIRESTATION'),
            }
    except Exception:
        result = None

    with TAMPA_FIRE_GRID_CACHE_LOCK:
        _evict_if_full(TAMPA_FIRE_GRID_CACHE, TAMPA_FIRE_GRID_CACHE_MAX_SIZE)
        TAMPA_FIRE_GRID_CACHE[key] = result
    return result


def fetch_miami_dade_fire_calls():
    req = urllib.request.Request(
        MIAMI_DADE_FIRE_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    html_text = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    rows = re.findall(r'<tr class="(?:odd|even)"\s*>(.*?)</tr>', html_text, re.S)
    records = []
    for row in rows:
        cells = [strip_tags(cell) for cell in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) != 5:
            continue
        when, fire_code, incident_type, address, units = cells
        query = geocode_query(address, 'Miami-Dade County, Florida')
        source_id = hashlib.md5(f'{when}|{incident_type}|{address}'.encode('utf-8')).hexdigest()[:16]
        records.append({
            'when': when,
            'fire_code': fire_code,
            'incident_type': incident_type,
            'address': address,
            'query': query,
            'source_id': source_id,
        })

    geocodes = parallel_geocode_queries((record['query'] for record in records))
    features = []
    for record in records:
        coords = geocodes.get(normalized_cache_key(record['query']))
        if not coords:
            continue
        lat, lon = coords
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': display_text(record['incident_type']) or 'Fire/Rescue Call',
                'icon': incident_icon(record['incident_type'], default='fire.png'),
                'key': f'mdfr:{record["source_id"]}',
                'location': record['address'] or 'Unknown location',
                'source': 'Miami-Dade Fire Rescue',
                'source_id': record['source_id'],
                'time': local_time_iso(record['when']) or record['when'],
                'category': 'Fire/EMS',
                'call_type': record['fire_code'] or record['incident_type'],
            }
        })
    return features


def fetch_tampa_fire_calls():
    req = urllib.request.Request(
        TAMPA_FIRE_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    rows = json.loads(urllib.request.urlopen(req, timeout=20).read())
    cutoff = datetime.datetime.now(LOCAL_TZ) - datetime.timedelta(hours=TAMPA_FIRE_RECENT_HOURS)
    features = []
    for row in rows:
        dispatched = parse_time_iso(row.get('Dispatched'), ['%m/%d/%Y %I:%M:%S %p'])
        if not dispatched:
            continue
        try:
            dispatched_dt = datetime.datetime.fromisoformat(dispatched)
        except ValueError:
            continue
        if dispatched_dt < cutoff:
            continue

        grid = row.get('Grid')
        grid_info = tampa_fire_grid_info(grid)
        if not grid_info:
            continue
        lat, lon = grid_info['coords']
        location_parts = [f'Grid {grid_info.get("label") or grid}']
        if grid_info.get('community'):
            location_parts.append(grid_info['community'])
        if grid_info.get('station'):
            location_parts.append(f'Station {grid_info["station"]}')
        description = display_text(row.get('Description') or 'Fire/Rescue Call')
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': description,
                'icon': incident_icon(description, default='fire.png'),
                'key': f'tfr:{row.get("Incident")}',
                'location': ' · '.join(part for part in location_parts if part),
                'source': 'Tampa Fire Rescue',
                'source_id': row.get('Incident'),
                'time': dispatched,
                'category': 'Fire/EMS',
                'call_type': row.get('Description'),
            }
        })
    return features


def fetch_jax_sheriff_calls():
    req = urllib.request.Request(
        JAX_SHERIFF_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    html_text = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    rows = re.findall(r"<tr class='closedCall'>(.*?)</tr>", html_text, re.S)
    records = []
    for row in rows[:JAX_SHERIFF_MAX_CALLS]:
        cells = [strip_tags(cell) for cell in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) < 5:
            continue
        incident_id, dispatched, address, signal, description = cells[:5]
        if not incident_id or not address or str(description).upper() == 'CANCEL':
            continue
        query = geocode_query(address, 'Jacksonville, Florida')
        records.append({
            'incident_id': incident_id,
            'dispatched': dispatched,
            'address': address,
            'signal': signal,
            'description': description,
            'query': query,
        })

    geocodes = parallel_geocode_queries((record['query'] for record in records))
    features = []
    for record in records:
        coords = geocodes.get(normalized_cache_key(record['query']))
        if not coords:
            continue
        lat, lon = coords
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': display_text(record['description']) or 'Police Call',
                'icon': incident_icon(record['description'], default='police.png'),
                'key': f'jax:{record["incident_id"]}',
                'location': record['address'],
                'source': 'Jacksonville Sheriff (Completed)',
                'source_id': record['incident_id'],
                'time': parse_time_iso(record['dispatched'], ['%m/%d/%Y %H:%M']) or record['dispatched'],
                'category': 'Police',
                'call_type': record['signal'] or record['description'],
            }
        })
    return features


def fetch_clearwater_police_calls():
    req = urllib.request.Request(
        CLEARWATER_POLICE_CALLS_URL,
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    data = json.loads(urllib.request.urlopen(req, timeout=20).read())
    records = []
    for row in data.get('data') or []:
        address = display_text(row.get('Address'))
        description = display_text(row.get('Online_Description') or 'Police Call')
        query = geocode_query(address, 'Clearwater, Florida')
        records.append({
            'row': row,
            'address': address,
            'description': description,
            'query': query,
        })

    geocodes = parallel_geocode_queries((record['query'] for record in records))
    features = []
    for record in records:
        row = record['row']
        coords = geocodes.get(normalized_cache_key(record['query']))
        if not coords:
            continue
        lat, lon = coords
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': record['description'],
                'icon': incident_icon(record['description'], default='police.png'),
                'key': f'clearwater:{row.get("Master_Incident_Number")}',
                'location': record['address'] or 'Unknown location',
                'source': 'Clearwater Police',
                'source_id': row.get('Master_Incident_Number'),
                'time': parse_time_iso(row.get('Response_Date'), ['%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S']) or row.get('Response_Date'),
                'category': 'Police',
                'call_type': row.get('Online_Description'),
            }
        })
    return features


def fetch_tops_incidents():
    params = urllib.parse.urlencode({
        'where': '1=1',
        'outFields': 'EventDate,IncidentTypeCode,IncidentTypeDescription,EventHeadLine,EventAddress,InitialPriorityKey,CommonPlace,OBJECTID',
        'returnGeometry': 'true',
        'f': 'json',
    })
    req = urllib.request.Request(
        f'{TOPS_ACTIVE_INCIDENTS_URL}?{params}',
        headers={
            'User-Agent': 'Mozilla/5.0',
            'Referer': TOPS_REFERER,
        }
    )
    resp = urllib.request.urlopen(req, timeout=20)
    data = json.loads(resp.read())
    features = []
    for feature in data.get('features', []):
        attrs = feature.get('attributes') or {}
        geom = feature.get('geometry') or {}
        try:
            x = float(geom.get('x') or 0)
            y = float(geom.get('y') or 0)
        except (TypeError, ValueError):
            continue
        lat, lon = web_mercator_to_latlon(x, y)
        if not in_florida(lat, lon):
            continue
        address = attrs.get('EventAddress') or 'Unknown location'
        commonplace = attrs.get('CommonPlace')
        location = f'{address} · {commonplace}' if commonplace and commonplace not in address else address
        description = display_text(attrs.get('IncidentTypeDescription') or attrs.get('IncidentTypeCode') or 'Incident')
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat],
            },
            'properties': {
                'description': description,
                'icon': tops_icon(attrs.get('IncidentTypeDescription')),
                'key': f'tops:{attrs.get("OBJECTID")}',
                'location': location,
                'source': 'Tallahassee / Leon TOPS',
                'source_id': attrs.get('OBJECTID'),
                'time': tops_time_iso(attrs.get('EventDate')) or attrs.get('EventDate'),
                'category': 'Police',
                'call_type': attrs.get('IncidentTypeCode'),
            }
        })
    return features


EMERGENCY_SOURCE_FETCHERS = (
    ('davnit', fetch_davnit_emergency),
    ('pulsepoint', fetch_pulsepoint_incidents),
    ('pinellas', fetch_pinellas_emergency),
    ('pinellas_sheriff', fetch_pinellas_sheriff_calls),
    ('marion', fetch_marion_fire_calls),
    ('martin', fetch_martin_fire_calls),
    ('miami_dade', fetch_miami_dade_fire_calls),
    ('tampa_fire', fetch_tampa_fire_calls),
    ('jax', fetch_jax_sheriff_calls),
    ('clearwater', fetch_clearwater_police_calls),
    ('tops', fetch_tops_incidents),
)


def build_emergency_content():
    def load_source(name, fetcher):
        return name, list(fetcher())

    source_results = {}
    errors = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(EMERGENCY_SOURCE_FETCHERS)) as executor:
        future_map = {
            executor.submit(load_source, name, fetcher): name
            for name, fetcher in EMERGENCY_SOURCE_FETCHERS
        }
        for future in concurrent.futures.as_completed(future_map):
            name = future_map[future]
            try:
                _, source_results[name] = future.result()
            except Exception as exc:
                errors.append(f'{name}: {exc}')

    features_by_key = {}
    for name, _ in EMERGENCY_SOURCE_FETCHERS:
        for feature in source_results.get(name, []):
            key = (feature.get('properties') or {}).get('key')
            if key:
                features_by_key[key] = feature

    if not features_by_key and errors:
        raise ValueError('; '.join(errors))

    body = {
        'type': 'FeatureCollection',
        'features': list(features_by_key.values()),
        'last_updated': time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime()),
    }
    return json.dumps(body).encode(), errors


def refresh_emergency_cache_sync():
    content, errors = build_emergency_content()
    with EMERGENCY_CACHE_LOCK:
        EMERGENCY_CACHE['body'] = content
        EMERGENCY_CACHE['expires_at'] = time.time() + EMERGENCY_CACHE_TTL
        EMERGENCY_CACHE['last_error'] = '; '.join(errors) if errors else None
    return content


def refresh_emergency_cache_async():
    with EMERGENCY_CACHE_LOCK:
        if EMERGENCY_CACHE['refreshing']:
            return False
        EMERGENCY_CACHE['refreshing'] = True

    def worker():
        try:
            refresh_emergency_cache_sync()
        except Exception as exc:
            with EMERGENCY_CACHE_LOCK:
                EMERGENCY_CACHE['last_error'] = str(exc)
        finally:
            with EMERGENCY_CACHE_LOCK:
                EMERGENCY_CACHE['refreshing'] = False

    threading.Thread(target=worker, name='emergency-cache-refresh', daemon=True).start()
    return True


def florida_aircraft_from_items(items):
    aircraft = []
    for item in items or []:
        try:
            lat = float(item.get('lat'))
            lon = float(item.get('lon'))
        except (TypeError, ValueError):
            continue
        if not in_florida(lat, lon):
            continue
        normalized = dict(item)
        normalized['lat'] = lat
        normalized['lon'] = lon
        aircraft.append(normalized)
    return aircraft


def fetch_adsb_aircraft_query(lat, lon, dist):
    url = f'https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, timeout=20)
    data = json.loads(resp.read())
    items = data.get('ac') or data.get('aircraft') or []
    return data, florida_aircraft_from_items(items)


def merge_aircraft_items(*groups):
    merged = {}
    for group in groups:
        for item in group or []:
            key = str(item.get('hex') or '').strip().lower()
            if not key:
                key = hashlib.md5(
                    f'{item.get("flight")}|{item.get("r")}|{item.get("lat")}|{item.get("lon")}'.encode('utf-8')
                ).hexdigest()[:16]
            merged[key] = item
    return list(merged.values())


def build_aircraft_content():
    primary_data, primary_aircraft = fetch_adsb_aircraft_query(*AIRCRAFT_PRIMARY_QUERY)
    combined_aircraft = list(primary_aircraft)
    errors = []

    if len(primary_aircraft) < AIRCRAFT_MIN_RELIABLE_COUNT:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(AIRCRAFT_FALLBACK_QUERIES)) as executor:
            futures = {
                executor.submit(fetch_adsb_aircraft_query, *query): query
                for query in AIRCRAFT_FALLBACK_QUERIES
            }
            for future in concurrent.futures.as_completed(futures):
                try:
                    _, aircraft = future.result()
                    combined_aircraft = merge_aircraft_items(combined_aircraft, aircraft)
                except Exception as exc:
                    query = futures[future]
                    errors.append(f'{query}: {exc}')

    payload = dict(primary_data)
    payload.pop('ac', None)
    payload['aircraft'] = combined_aircraft
    payload['total'] = len(combined_aircraft)
    payload['source'] = 'adsb.lol'
    content = json.dumps(payload).encode()
    return content, len(combined_aircraft), errors


def refresh_aircraft_cache_sync():
    content, count, errors = build_aircraft_content()
    now = time.time()
    with AIRCRAFT_CACHE_LOCK:
        fallback_body = AIRCRAFT_CACHE['body']
        fallback_count = AIRCRAFT_CACHE['last_good_count']
        fallback_stale_until = AIRCRAFT_CACHE['stale_until']

        # If the upstream briefly reports an implausibly low count, keep the last good picture.
        if (
            count < AIRCRAFT_MIN_RELIABLE_COUNT
            and fallback_body
            and fallback_count >= AIRCRAFT_MIN_RELIABLE_COUNT
            and now < fallback_stale_until
        ):
            AIRCRAFT_CACHE['expires_at'] = now + 10
            AIRCRAFT_CACHE['last_error'] = f'low-count refresh ({count})'
            return fallback_body

        AIRCRAFT_CACHE['body'] = content
        AIRCRAFT_CACHE['expires_at'] = now + AIRCRAFT_CACHE_TTL
        AIRCRAFT_CACHE['stale_until'] = now + AIRCRAFT_CACHE_MAX_STALE
        AIRCRAFT_CACHE['last_error'] = '; '.join(errors) if errors else None
        AIRCRAFT_CACHE['last_good_count'] = count
    return content


def refresh_aircraft_cache_async():
    with AIRCRAFT_CACHE_LOCK:
        if AIRCRAFT_CACHE['refreshing']:
            return False
        AIRCRAFT_CACHE['refreshing'] = True

    def worker():
        try:
            refresh_aircraft_cache_sync()
        except Exception as exc:
            with AIRCRAFT_CACHE_LOCK:
                AIRCRAFT_CACHE['last_error'] = str(exc)
        finally:
            with AIRCRAFT_CACHE_LOCK:
                AIRCRAFT_CACHE['refreshing'] = False

    threading.Thread(target=worker, name='aircraft-cache-refresh', daemon=True).start()
    return True


def fetch_kubra_power_outages(provider_key, provider):
    state, config = kubra_provider_state(provider)
    data_root = state.get('data', {}).get('interval_generation_data')
    interval_layers = ((config.get('layers') or {}).get('data') or {}).get('interval_generation_data') or []
    summary_config = (((config.get('summary') or {}).get('data') or {}).get('interval_generation_data') or {})
    summary_source = summary_config.get('source')
    thematic_sources = []
    for layer in interval_layers:
        if layer.get('type') == 'THEMATIC_LAYER_V2':
            source = layer.get('source') or []
            if source:
                thematic_sources.append(source[0])

    provider_summary = {
        'provider': provider['name'],
        'source_url': provider['source_url'],
        'total_outages': 0,
        'total_customers_affected': 0,
        'total_customers_served': 0,
        'last_updated': None,
        'mappable': False,
    }

    if summary_source and data_root:
        summary_doc = fetch_json_url(f'https://kubra.io/{data_root}/{summary_source}')
        provider_summary = kubra_provider_summary(provider['name'], provider['source_url'], summary_doc)

    if not (data_root and thematic_sources):
        return [], provider_summary

    thematic_doc = None
    for thematic_source in thematic_sources:
        try:
            thematic_doc = fetch_json_url(f'https://kubra.io/{data_root}/{thematic_source}')
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                continue
            raise

    if not thematic_doc:
        return [], provider_summary

    features = []
    for item in thematic_doc.get('file_data') or []:
        desc = item.get('desc') or {}
        customers_affected = safe_int((desc.get('cust_a') or {}).get('val'))
        if customers_affected <= 0:
            continue
        geometry = kubra_geometry(item.get('geom') or {})
        center = kubra_center(item.get('geom') or {})
        if not geometry and center:
            geometry = point_geometry(center[0], center[1])
        if not geometry:
            continue

        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': {
                'key': f'power:{provider_key}:{item.get("id") or item.get("title")}',
                'provider': provider['name'],
                'provider_key': provider_key,
                'source_url': provider['source_url'],
                'kind': 'area',
                'area_name': desc.get('name') or item.get('title') or provider['name'],
                'customers_affected': customers_affected,
                'customers_served': safe_int(desc.get('cust_s')),
                'outages': safe_int(desc.get('n_out')),
                'percent_customers_affected': safe_float((desc.get('percent_cust_a') or {}).get('val')),
                'etr': desc.get('etr') if not str(desc.get('etr') or '').startswith('ETR-') else None,
                'start_time': desc.get('start_time'),
                'updated_at': provider_summary.get('last_updated'),
            }
        })

    provider_summary['mappable'] = True
    return features, provider_summary


def fetch_duke_power_outages():
    summary_doc = fetch_json_url(DUKE_POWER_SUMMARY_URL, headers=DUKE_POWER_HEADERS)
    outages_doc = fetch_json_url(DUKE_POWER_OUTAGES_URL, headers=DUKE_POWER_HEADERS)
    summary_data = summary_doc.get('data') or {}
    outages = (outages_doc.get('data') or [])
    provider_summary = {
        'provider': 'Duke Energy Florida',
        'source_url': 'https://www.duke-energy.com/outages',
        'total_outages': safe_int(summary_data.get('activeOutages')),
        'total_customers_affected': safe_int(summary_data.get('totalCustomersAffected')),
        'total_customers_served': 0,
        'last_updated': summary_data.get('lastUpdated'),
        'mappable': True,
    }

    detail_enabled = len(outages) <= DUKE_POWER_DETAIL_LIMIT
    features = []
    for item in outages:
        detail = None
        source_id = str(item.get('sourceEventNumber') or '').strip()
        if detail_enabled and source_id:
            try:
                detail = fetch_json_url(
                    DUKE_POWER_DETAIL_URL.format(source_id=urllib.parse.quote(source_id)),
                    headers=DUKE_POWER_HEADERS
                ).get('data') or {}
            except Exception:
                detail = None

        data = detail or item
        lat = safe_float(data.get('deviceLatitudeLocation'))
        lon = safe_float(data.get('deviceLongitudeLocation'))
        if not in_florida(lat, lon):
            continue

        polygon_points = data.get('trfPolygonXyLoc') or data.get('convexHull') or []
        geometry = polygon_geometry_from_google_points(polygon_points)
        if not geometry:
            geometry = point_geometry(lat, lon)

        county_names = [
            str(county.get('name') or '').strip()
            for county in (data.get('countiesAffected') or [])
            if county.get('name')
        ]
        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': {
                'key': f'power:duke:{source_id}',
                'provider': 'Duke Energy Florida',
                'provider_key': 'duke',
                'source_url': 'https://www.duke-energy.com/outages',
                'kind': 'point',
                'area_name': ', '.join(county_names) or data.get('operationCenterName') or 'Florida outage',
                'customers_affected': safe_int(data.get('customersAffectedSum') or item.get('customersAffectedNumber')),
                'customers_served': 0,
                'outages': 1,
                'status': data.get('crewStatTxt'),
                'reason': data.get('causeDescription') or data.get('outageCause') or item.get('outageCause'),
                'etr': data.get('estimatedRestorationTime'),
                'start_time': data.get('startTime') or data.get('outageCreationTime'),
                'updated_at': provider_summary.get('last_updated'),
            }
        })
    return features, provider_summary


def fetch_teco_power_outages():
    config = fetch_json_url(TECO_POWER_CONFIG_URL)
    tiles_doc = fetch_json_url(TECO_POWER_TILES_URL, data={
        'size': 10000,
        'query': {
            'bool': {
                'must': {'match_all': {}},
                'filter': {
                    'geo_bounding_box': {
                        'polygonCenter': {
                            'top_left': {
                                'lat': FL_BOUNDS['max_lat'],
                                'lon': FL_BOUNDS['min_lon'],
                            },
                            'bottom_right': {
                                'lat': FL_BOUNDS['min_lat'],
                                'lon': FL_BOUNDS['max_lon'],
                            },
                        }
                    }
                }
            }
        },
        'sort': [{'updateTime': 'asc'}, {'incidentId': 'asc'}],
        '_source': [
            'updateTime',
            'status',
            'reason',
            'customerCount',
            'polygonCenter',
            'incidentId',
            'polygonPointsGoogle',
            'estimatedTimeOfRestoration',
        ],
    })

    hits = (((tiles_doc.get('hits') or {}).get('hits') or []))
    total = safe_int((((tiles_doc.get('hits') or {}).get('total') or {}).get('value')))
    provider_summary = {
        'provider': 'Tampa Electric',
        'source_url': TECO_POWER_SOURCE_URL,
        'total_outages': total,
        'total_customers_affected': safe_int((((tiles_doc.get('aggregations') or {}).get('customerCountSum') or {}).get('value'))),
        'total_customers_served': 0,
        'last_updated': ((tiles_doc.get('_tiles') or {}).get('generated')) or config.get('lastDateTime'),
        'mappable': True,
    }

    features = []
    for hit in hits:
        source = hit.get('_source') or {}
        center = source.get('polygonCenter') or []
        if len(center) < 2:
            continue
        lon = safe_float(center[0])
        lat = safe_float(center[1])
        if not in_florida(lat, lon):
            continue

        geometry = polygon_geometry_from_google_points(source.get('polygonPointsGoogle'))
        if not geometry:
            geometry = point_geometry(lat, lon)

        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': {
                'key': f'power:teco:{source.get("incidentId")}',
                'provider': 'Tampa Electric',
                'provider_key': 'teco',
                'source_url': TECO_POWER_SOURCE_URL,
                'kind': 'point',
                'area_name': source.get('incidentId') or 'Tampa Electric outage',
                'customers_affected': safe_int(source.get('customerCount')),
                'customers_served': 0,
                'outages': 1,
                'status': source.get('status'),
                'reason': source.get('reason'),
                'etr': source.get('estimatedTimeOfRestoration'),
                'start_time': None,
                'updated_at': source.get('updateTime') or provider_summary.get('last_updated'),
            }
        })
    return features, provider_summary


def fetch_keys_power_outages():
    summary_doc = fetch_json_url(KEYS_POWER_SUMMARY_URL, headers=KEYS_POWER_HEADERS)
    outages_doc = fetch_json_url(KEYS_POWER_OUTAGES_URL, headers=KEYS_POWER_HEADERS)
    polygons_doc = fetch_json_url(KEYS_POWER_POLYGONS_URL, headers=KEYS_POWER_HEADERS)

    polygons_by_id = {}
    for item in polygons_doc or []:
        outage_id = item.get('outageRecId')
        if not outage_id:
            continue
        geometry = keys_power_geometry(item)
        if geometry:
            polygons_by_id[str(outage_id)] = geometry

    active_outages = [
        item for item in (outages_doc or [])
        if not item.get('isPlanned')
    ]
    customers_served = safe_int(summary_doc.get('customersServed'))
    provider_summary = {
        'provider': 'Keys Energy Services',
        'source_url': KEYS_POWER_SOURCE_URL,
        'total_outages': len(active_outages),
        'total_customers_affected': safe_int(summary_doc.get('customersOutNow')),
        'total_customers_served': customers_served,
        'last_updated': summary_doc.get('updateTime'),
        'mappable': False,
    }

    features = []
    for item in active_outages:
        outage_id = str(item.get('outageRecId') or item.get('outageId') or '').strip()
        point = item.get('outagePoint') or {}
        lat = safe_float(point.get('lat'))
        lon = safe_float(point.get('lng'))
        geometry = polygons_by_id.get(outage_id)
        if geometry and not in_florida(lat, lon):
            center = geojson_center(geometry)
            if center:
                lat, lon = center
        if geometry is None and in_florida(lat, lon):
            geometry = point_geometry(lat, lon)
        if not geometry or not in_florida(lat, lon):
            continue

        customers_affected = safe_int(item.get('customersOutNow'))
        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': {
                'key': f'power:keys:{outage_id or len(features)}',
                'provider': 'Keys Energy Services',
                'provider_key': 'keys',
                'source_url': KEYS_POWER_SOURCE_URL,
                'kind': 'area' if geometry.get('type') != 'Point' else 'point',
                'area_name': item.get('outageName') or item.get('address') or 'Keys outage',
                'customers_affected': customers_affected,
                'customers_served': customers_served,
                'outages': 1,
                'percent_customers_affected': (
                    (customers_affected / customers_served) * 100.0
                    if customers_served > 0 else 0.0
                ),
                'status': item.get('outageWorkStatus'),
                'reason': item.get('cause'),
                'etr': item.get('estimatedTimeOfRestoral'),
                'start_time': item.get('outageStartTime'),
                'updated_at': item.get('outageModifiedTime') or provider_summary.get('last_updated'),
            }
        })

    provider_summary['mappable'] = bool(features)
    return features, provider_summary


def _parse_fl511_tooltip_html(text):
    """Extract structured fields from FL511 tooltip HTML, returning a plain dict."""
    def inner_text(s):
        return re.sub(r'<[^>]+>', '', s).strip() if s else None

    name_m = re.search(r'<td[^>]*>\s*<b[^>]*>(.*?)</b>', text, re.S)
    msg_m = re.search(r'<td[^>]+class=["\']msgContent["\'][^>]*>(.*?)</td>', text, re.S)
    if not msg_m:
        msg_m = re.search(r'<td[^>]+colspan=["\']2["\'][^>]*>(.*?)</td>', text, re.S)
    sev_m = re.search(r'<th[^>]*>\s*Severity\s*</th>\s*<td[^>]*>(.*?)</td>', text, re.S | re.I)
    ts_m = re.search(
        r'<td[^>]*>\s*([A-Z][a-z]{2}\s+\d{1,2}\s+\d{4},\s+\d{1,2}:\d{2}\s+[AP]M)\s*</td>', text
    )
    return {
        'name':      inner_text(name_m.group(1)) if name_m else None,
        'msg':       inner_text(msg_m.group(1))  if msg_m  else None,
        'severity':  inner_text(sev_m.group(1))  if sev_m  else None,
        'timestamp': ts_m.group(1).strip()        if ts_m   else None,
    }


def _evict_if_full(cache, max_size):
    """Remove the oldest entry when the cache is at capacity. Must be called under the cache's lock."""
    if len(cache) >= max_size:
        cache.pop(next(iter(cache)))


def check_rate_limit(ip, path):
    limit = RATE_LIMITS.get(path, RATE_LIMIT_DEFAULT)
    now = time.time()
    key = (ip, path)
    with _RATE_LIMIT_LOCK:
        state = _RATE_LIMIT_STATE.get(key)
        if state is None or (now - state['window_start']) >= RATE_LIMIT_WINDOW:
            _RATE_LIMIT_STATE[key] = {'count': 1, 'window_start': now}
            if len(_RATE_LIMIT_STATE) > 5000:
                cutoff = now - RATE_LIMIT_WINDOW
                for k in [k for k, v in _RATE_LIMIT_STATE.items() if v['window_start'] < cutoff]:
                    del _RATE_LIMIT_STATE[k]
            return True
        if state['count'] >= limit:
            return False
        state['count'] += 1
        return True


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'FloridaMap'
    sys_version = ''
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code >= 400 and not DEBUG:
            message = http.HTTPStatus(code).phrase
            explain = None
        super().send_error(code, message, explain)

    def _write_bytes(self, status, content, content_type, cache_control='no-store', allow_origin=None):
        if isinstance(content, str):
            content = content.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        if allow_origin:
            self.send_header('Access-Control-Allow-Origin', allow_origin)
        self.send_header('Cache-Control', cache_control)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _log_exception(self, context, exc):
        stamp = datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        print(f'[{stamp}] {context}: {exc}', flush=True)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Allow', 'GET, HEAD, OPTIONS')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_HEAD(self):
        self._dispatch_request(head_only=True)

    def do_GET(self):
        self._dispatch_request(head_only=False)

    def _dispatch_request(self, head_only=False):
        if not allowed_request_host(self.headers.get('Host')):
            self.send_error(400, 'Invalid host'); return

        parsed = urllib.parse.urlparse(self.path)

        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip, parsed.path):
            self.send_error(429, 'Too Many Requests'); return

        if parsed.path == '/healthz':
            self._handle_healthz(parsed)
        elif parsed.path == '/video-token':
            self._handle_video_token(parsed)
        elif parsed.path.startswith('/stream/'):
            self._handle_stream_proxy(parsed)
        elif parsed.path == '/tile':
            self._handle_tile(parsed)
        elif parsed.path == '/emergency':
            self._handle_emergency(parsed)
        elif parsed.path == '/power-outages':
            self._handle_power_outages(parsed)
        elif parsed.path == '/sensors':
            self._handle_sensors(parsed)
        elif parsed.path == '/temperature-stations':
            self._handle_temperature_stations(parsed)
        elif parsed.path == '/lpr':
            self._handle_lpr(parsed)
        elif parsed.path == '/aircraft':
            self._handle_aircraft(parsed)
        elif parsed.path == '/registry':
            self._handle_registry(parsed)
        elif parsed.path.startswith('/fl511/'):
            self._handle_fl511_layer(parsed)
        elif parsed.path == '/fl511tooltip':
            self._handle_fl511_tooltip(parsed)
        else:
            self._handle_static(parsed)

    def _write_page(self, status, filename, cache_control='no-cache'):
        with open(file_path(filename), 'rb') as handle:
            content = handle.read()
        self._write_bytes(status, content, self.guess_type(filename), cache_control=cache_control)

    def _respond_not_found(self):
        try:
            self._write_page(404, '404.html')
        except FileNotFoundError:
            self.send_error(404, 'Not found')
        except Exception as e:
            self._log_exception('404-page', e)
            self.send_error(404, 'Not found')

    def _handle_static(self, parsed):
        target = public_static_target(parsed.path)
        if not target:
            self._respond_not_found(); return
        try:
            no_cache_exts = ('.html', '.js')
            cache_control = 'no-cache' if target.endswith(no_cache_exts) else 'public, max-age=86400'
            self._write_page(200, target, cache_control=cache_control)
        except FileNotFoundError:
            self._respond_not_found()
        except Exception as e:
            self._log_exception('static', e)
            self.send_error(500, str(e))

    def _handle_healthz(self, parsed):
        payload = {
            'status': 'ok',
            'service': 'floridamap-proxy',
            'time': datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        }
        body = json.dumps(payload).encode()
        self._write_bytes(200, body, 'application/json', cache_control='no-store')

    def _handle_video_token(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        cam_id = params.get('id', [None])[0]
        if not valid_numeric_id(cam_id):
            self.send_error(400, 'Missing id'); return
        try:
            proxied_url = self._get_proxied_stream_url(cam_id)
            body = json.dumps({'url': proxied_url}).encode()
            self._write_bytes(200, body, 'application/json')
        except Exception as e:
            self._log_exception('video-token', e)
            self.send_error(500, str(e))

    def _handle_registry(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        icao = params.get('icao', [None])[0]
        if not valid_icao(icao):
            self.send_error(400, 'Missing icao'); return
        key = str(icao).strip().lower()
        now = time.time()
        with REGISTRY_CACHE_LOCK:
            cached = REGISTRY_CACHE.get(key)
        if cached and now < cached['expires_at']:
            self._write_bytes(200, cached['content'], 'application/json')
            return
        url = f'https://api.adsbdb.com/v0/aircraft/{icao}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=10)
            content = resp.read()
            with REGISTRY_CACHE_LOCK:
                _evict_if_full(REGISTRY_CACHE, REGISTRY_CACHE_MAX_SIZE)
                REGISTRY_CACHE[key] = {'content': content, 'expires_at': now + REGISTRY_CACHE_TTL}
            self._write_bytes(200, content, 'application/json')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                content = json.dumps({'response': {'aircraft': None}}).encode()
                with REGISTRY_CACHE_LOCK:
                    _evict_if_full(REGISTRY_CACHE, REGISTRY_CACHE_MAX_SIZE)
                    REGISTRY_CACHE[key] = {'content': content, 'expires_at': now + REGISTRY_CACHE_NEGATIVE_TTL}
                self._write_bytes(200, content, 'application/json')
                return
            self._log_exception('registry', e)
            self.send_error(502)
        except Exception as e:
            self._log_exception('registry', e)
            self.send_error(502)

    def _handle_fl511_layer(self, parsed):
        # Proxy FL511 map layer icon data (cameras, signs, incidents, etc.)
        # Path: /fl511/{LayerName}  →  https://fl511.com/map/mapIcons/{LayerName}
        layer = parsed.path[len('/fl511/'):]
        if not layer.isalpha():
            self.send_error(400, 'Invalid layer'); return
        url = f'https://fl511.com/map/mapIcons/{layer}'
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://fl511.com/map',
                'Accept': 'application/json',
                'Accept-Encoding': 'identity'  # ask for uncompressed
            })
            resp = urllib.request.urlopen(req, timeout=15)
            content = resp.read()
            # Decompress if server still sends gzip
            if content[:2] == b'\x1f\x8b':
                import gzip
                content = gzip.decompress(content)
            self._write_bytes(200, content, 'application/json')
        except Exception as e:
            self._log_exception('fl511-layer', e)
            self.send_error(502, str(e))

    def _handle_fl511_tooltip(self, parsed):
        # Proxy FL511 tooltip — parse HTML server-side, return JSON to avoid serving raw HTML.
        # /fl511tooltip?layer=MessageSigns&id=12345
        params = urllib.parse.parse_qs(parsed.query)
        layer = params.get('layer', [None])[0]
        item_id = params.get('id', [None])[0]
        if not layer or not valid_numeric_id(item_id):
            self.send_error(400, 'Missing layer or id'); return
        if not layer.isalpha():
            self.send_error(400, 'Invalid layer'); return
        url = f'https://fl511.com/tooltip/{layer}/{item_id}?lang=en'
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://fl511.com/map',
                'Accept': 'text/html,application/xhtml+xml'
            })
            resp = urllib.request.urlopen(req, timeout=10)
            raw = resp.read().decode('utf-8', errors='replace')
            info = _parse_fl511_tooltip_html(raw)
            self._write_bytes(200, json.dumps(info).encode(), 'application/json')
        except Exception as e:
            self._log_exception('fl511-tooltip', e)
            self.send_error(502)

    def _handle_aircraft(self, parsed):
        try:
            now = time.time()
            with AIRCRAFT_CACHE_LOCK:
                cached_body = AIRCRAFT_CACHE['body']
                expires_at = AIRCRAFT_CACHE['expires_at']
                stale_until = AIRCRAFT_CACHE['stale_until']

            if cached_body and now < expires_at:
                content = cached_body
            elif cached_body and now < stale_until:
                refresh_aircraft_cache_async()
                content = cached_body
            else:
                content = refresh_aircraft_cache_sync()

            self._write_bytes(200, content, 'application/json')
        except Exception as e:
            with AIRCRAFT_CACHE_LOCK:
                fallback_body = AIRCRAFT_CACHE['body']
                fallback_stale_until = AIRCRAFT_CACHE['stale_until']
            if fallback_body and time.time() < fallback_stale_until:
                self._write_bytes(200, fallback_body, 'application/json')
                return
            self._log_exception('aircraft', e)
            self.send_error(502, str(e))

    def _handle_lpr(self, parsed):
        try:
            with open(file_path('lpr.json'), 'rb') as f:
                content = f.read()
            self._write_bytes(200, content, 'application/json')
        except Exception as e:
            self._log_exception('lpr', e)
            self.send_error(500, str(e))

    def _handle_sensors(self, parsed):
        try:
            url = (
                'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services'
                '/Real_Time_Traffic_Volume_and_Speed_Current_All_Directions_TDA'
                '/FeatureServer/0/query'
                '?where=LATITUDE+BETWEEN+24.4+AND+31.1+AND+LNGITUDE+BETWEEN+-87.7+AND+-79.9'
                '&outFields=LATITUDE,LNGITUDE,CURAVSPD,MAXSPEEDR,LOCALNAM,IDSTR'
                '&f=json&resultRecordCount=5000'
            )
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=15)
            data = resp.read()
            if data[:2] == b'\x1f\x8b':
                import gzip
                data = gzip.decompress(data)
            body = json.dumps(json.loads(data)).encode()
            self._write_bytes(200, body, 'application/json')
        except Exception as e:
            self._log_exception('sensors', e)
            self.send_error(502, str(e))

    def _handle_emergency(self, parsed):
        try:
            now = time.time()
            with EMERGENCY_CACHE_LOCK:
                cached_body = EMERGENCY_CACHE['body']
                expires_at = EMERGENCY_CACHE['expires_at']

            if cached_body and now < expires_at:
                content = cached_body
            elif cached_body:
                refresh_emergency_cache_async()
                content = cached_body
            else:
                content = refresh_emergency_cache_sync()

            self._write_bytes(200, content, 'application/json')
        except Exception as e:
            self._log_exception('emergency', e)
            self.send_error(502, str(e))

    def _handle_temperature_stations(self, parsed):
        try:
            now = time.time()
            with TEMPERATURE_CACHE_LOCK:
                cached_body = TEMPERATURE_CACHE['body']
                expires_at = TEMPERATURE_CACHE['expires_at']
                refreshing = TEMPERATURE_CACHE['refreshing']

            if cached_body and now < expires_at:
                self._write_bytes(200, cached_body, 'application/json')
                return

            if cached_body and refreshing:
                self._write_bytes(200, cached_body, 'application/json')
                return

            with TEMPERATURE_CACHE_LOCK:
                if TEMPERATURE_CACHE['refreshing']:
                    body = TEMPERATURE_CACHE['body']
                    if body:
                        self._write_bytes(200, body, 'application/json')
                        return
                TEMPERATURE_CACHE['refreshing'] = True

            try:
                url = 'https://mesonet.agron.iastate.edu/api/1/currents.geojson?network=FL_ASOS'
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'FloridaMap/1.0 (floridamap.app)',
                    'Accept': 'application/json',
                })
                resp = urllib.request.urlopen(req, timeout=15)
                raw = resp.read()
                if raw[:2] == b'\x1f\x8b':
                    import gzip
                    raw = gzip.decompress(raw)
                iem_data = json.loads(raw)

                # Re-shape into a leaner GeoJSON FeatureCollection
                features = []
                for feat in iem_data.get('features', []):
                    props = feat.get('properties', {})
                    geom = feat.get('geometry', {})
                    coords = geom.get('coordinates')
                    if not coords or len(coords) < 2:
                        continue
                    tmpf = props.get('tmpf')
                    if tmpf is None:
                        continue
                    try:
                        tmpf = float(tmpf)
                    except (TypeError, ValueError):
                        continue
                    dwpf = props.get('dwpf')
                    relh = props.get('relh')
                    sknt = props.get('sknt')
                    drct = props.get('drct')
                    features.append({
                        'type': 'Feature',
                        'geometry': {'type': 'Point', 'coordinates': [coords[0], coords[1]]},
                        'properties': {
                            'station': props.get('station', ''),
                            'name': props.get('name', ''),
                            'tmpf': round(tmpf, 1),
                            'dwpf': round(float(dwpf), 1) if dwpf is not None else None,
                            'relh': round(float(relh), 1) if relh is not None else None,
                            'sknt': round(float(sknt), 1) if sknt is not None else None,
                            'drct': int(drct) if drct is not None else None,
                            'utc_valid': props.get('utc_valid'),
                        }
                    })

                out = json.dumps({'type': 'FeatureCollection', 'features': features}).encode()
                new_expires = now + TEMPERATURE_CACHE_TTL
                with TEMPERATURE_CACHE_LOCK:
                    TEMPERATURE_CACHE['body'] = out
                    TEMPERATURE_CACHE['expires_at'] = new_expires
                    TEMPERATURE_CACHE['refreshing'] = False
                    TEMPERATURE_CACHE['last_error'] = None
                self._write_bytes(200, out, 'application/json')
            except Exception as inner_e:
                with TEMPERATURE_CACHE_LOCK:
                    TEMPERATURE_CACHE['refreshing'] = False
                    TEMPERATURE_CACHE['last_error'] = str(inner_e)
                raise
        except Exception as e:
            self._log_exception('temperature-stations', e)
            self.send_error(502, str(e))

    def _handle_power_outages(self, parsed):
        try:
            now = time.time()
            with POWER_OUTAGE_CACHE_LOCK:
                cached_body = POWER_OUTAGE_CACHE['body']
                expires_at = POWER_OUTAGE_CACHE['expires_at']
                refreshing = POWER_OUTAGE_CACHE['refreshing']

            if cached_body and now < expires_at:
                self._write_bytes(200, cached_body, 'application/json')
                return

            if cached_body and refreshing:
                self._write_bytes(200, cached_body, 'application/json')
                return

            with POWER_OUTAGE_CACHE_LOCK:
                if POWER_OUTAGE_CACHE['refreshing']:
                    stale = POWER_OUTAGE_CACHE['body']
                    if stale:
                        self._write_bytes(200, stale, 'application/json')
                        return
                POWER_OUTAGE_CACHE['refreshing'] = True

            try:
                features = []
                providers = []
                errors = []

                try:
                    duke_features, duke_summary = fetch_duke_power_outages()
                    features.extend(duke_features)
                    providers.append(duke_summary)
                except Exception as e:
                    errors.append(f'duke: {e}')

                try:
                    teco_features, teco_summary = fetch_teco_power_outages()
                    features.extend(teco_features)
                    providers.append(teco_summary)
                except Exception as e:
                    errors.append(f'teco: {e}')

                try:
                    keys_features, keys_summary = fetch_keys_power_outages()
                    features.extend(keys_features)
                    providers.append(keys_summary)
                except Exception as e:
                    errors.append(f'keys: {e}')

                for provider_key, provider in KUBRA_POWER_PROVIDERS.items():
                    try:
                        provider_features, provider_summary = fetch_kubra_power_outages(provider_key, provider)
                        features.extend(provider_features)
                        providers.append(provider_summary)
                    except Exception as e:
                        errors.append(f'{provider_key}: {e}')

                if not features and not providers and errors:
                    raise ValueError('; '.join(errors))

                body = {
                    'type': 'FeatureCollection',
                    'features': features,
                    'providers': providers,
                    'last_updated': time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime()),
                }
                content = json.dumps(body).encode()
                with POWER_OUTAGE_CACHE_LOCK:
                    POWER_OUTAGE_CACHE['body'] = content
                    POWER_OUTAGE_CACHE['expires_at'] = time.time() + POWER_OUTAGE_CACHE_TTL
                    POWER_OUTAGE_CACHE['last_error'] = None
                    POWER_OUTAGE_CACHE['refreshing'] = False
                self._write_bytes(200, content, 'application/json')
            except Exception as e:
                with POWER_OUTAGE_CACHE_LOCK:
                    POWER_OUTAGE_CACHE['refreshing'] = False
                    POWER_OUTAGE_CACHE['last_error'] = str(e)
                raise
        except Exception as e:
            self._log_exception('power-outages', e)
            self.send_error(502)

    def _handle_tile(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        x = safe_int_param(params.get('x', [None])[0], minimum=0)
        y = safe_int_param(params.get('y', [None])[0], minimum=0)
        z = safe_int_param(params.get('z', [None])[0], minimum=0, maximum=22)
        if x is None or y is None or z is None:
            self.send_error(400, 'Missing x/y/z'); return
        url = f'https://tiles.ibi511.com/Geoservice/GetTrafficTile?x={x}&y={y}&z={z}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=10)
            content = resp.read()
            content_type = resp.headers.get('Content-Type', 'image/png')
            if content_type not in ('image/png', 'image/jpeg', 'image/webp'):
                content_type = 'image/png'
            self._write_bytes(200, content, content_type, cache_control='public, max-age=60')
        except Exception as e:
            self._log_exception('tile', e)
            self.send_error(502, str(e))

    def _handle_stream_proxy(self, parsed):
        # /stream/dis-se11.divas.cloud:8200/chan-376_h/index.m3u8?token=...
        # Strip the leading /stream/
        rest = parsed.path[len('/stream/'):]
        parsed_upstream = urllib.parse.urlsplit(f'https://{rest}')
        if parsed_upstream.username or parsed_upstream.password or not allowed_stream_host(parsed_upstream.hostname):
            self.send_error(403, 'Invalid stream host'); return
        if not parsed_upstream.path.startswith('/'):
            self.send_error(400, 'Invalid stream path'); return
        upstream_url = urllib.parse.urlunsplit((
            'https',
            parsed_upstream.netloc,
            parsed_upstream.path,
            parsed_upstream.query,
            parsed_upstream.fragment,
        ))
        if parsed.query:
            upstream_url += '?' + parsed.query

        try:
            req = urllib.request.Request(upstream_url, headers={
                'Referer': FL511_REFERER,
                'Origin': 'https://fl511.com',
                'User-Agent': 'Mozilla/5.0'
            })
            resp = urllib.request.urlopen(req, timeout=15)
            content = resp.read()
            content_type = resp.headers.get('Content-Type', 'application/octet-stream')

            # Rewrite m3u8 content so relative URLs go through our proxy
            if 'm3u8' in content_type or b'#EXTM3U' in content[:10]:
                content = self._rewrite_m3u8(content, upstream_url, parsed.query)
                content_type = 'application/vnd.apple.mpegurl'

            self._write_bytes(200, content, content_type, cache_control='no-store')
        except Exception as e:
            self._log_exception('stream-proxy', e)
            self.send_error(502, str(e))

    def _rewrite_m3u8(self, content, upstream_url, qs):
        """Rewrite relative URLs in m3u8 to go through /stream/ proxy."""
        base = upstream_url.rsplit('/', 1)[0]
        # Extract base host+path for constructing proxy URLs
        up_parsed = urllib.parse.urlparse(base)
        host_path = up_parsed.netloc + up_parsed.path

        lines = content.decode('utf-8').splitlines()
        out = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith('#'):
                # It's a URI line — make it absolute via our proxy
                if stripped.startswith('http'):
                    p = urllib.parse.urlparse(stripped)
                    if not allowed_stream_host(p.hostname):
                        continue
                    proxy_path = f'/stream/{p.netloc}{p.path}'
                    q = p.query or qs
                    out.append(f'{proxy_path}?{q}' if q else proxy_path)
                else:
                    # Relative URL — combine with base
                    q = urllib.parse.urlparse(stripped).query or qs
                    seg_name = stripped.split('?')[0]
                    out.append(f'/stream/{host_path}/{seg_name}?{q}' if q else f'/stream/{host_path}/{seg_name}')
            else:
                out.append(line)
        return '\n'.join(out).encode('utf-8')

    def _get_proxied_stream_url(self, cam_id):
        # Step 1: get FL511 token
        req = urllib.request.Request(
            f'https://fl511.com/Camera/GetVideoUrl?imageId={cam_id}',
            headers={'Referer': 'https://fl511.com/map', 'User-Agent': 'Mozilla/5.0'}
        )
        resp = urllib.request.urlopen(req, timeout=10)
        token_data = json.load(resp)

        if not isinstance(token_data, dict):
            video_url = token_data
            suffix = ''
        else:
            # Step 2: get base video URL from camera tooltip (contains data-videourl attribute)
            import re as _re
            tip_req = urllib.request.Request(
                f'https://fl511.com/tooltip/Cameras/{cam_id}?lang=en',
                headers={'Referer': 'https://fl511.com/map', 'User-Agent': 'Mozilla/5.0'}
            )
            tip_resp = urllib.request.urlopen(tip_req, timeout=10)
            tip_html = tip_resp.read().decode(errors='ignore')
            m = _re.search(r'data-videourl="([^"]+)"', tip_html)
            if not m:
                raise ValueError(f'No video URL found in tooltip for camera {cam_id}')
            video_url = m.group(1)

            # Step 3: exchange token for secure suffix
            body = json.dumps(token_data).encode()
            req2 = urllib.request.Request(
                'https://divas.cloud/VDS-API/SecureTokenUri/GetSecureTokenUriBySourceId',
                data=body,
                headers={
                    'Content-Type': 'application/json',
                    'Referer': FL511_REFERER,
                    'Origin': 'https://fl511.com',
                    'User-Agent': 'Mozilla/5.0'
                },
                method='POST'
            )
            resp2 = urllib.request.urlopen(req2, timeout=10)
            suffix = resp2.read().decode().strip().strip('"')

        # Build proxied URL: /stream/{host}{path}?{token}
        p = urllib.parse.urlparse(video_url)
        qs = urllib.parse.urlparse(video_url + suffix).query or suffix.lstrip('?')
        proxied = f'/stream/{p.netloc}{p.path}?{qs}' if qs else f'/stream/{p.netloc}{p.path}'
        return proxied


class ProductionHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128


if __name__ == '__main__':
    refresh_emergency_cache_async()
    refresh_aircraft_cache_async()
    server = ProductionHTTPServer((HOST, PORT), Handler)
    print(f'Serving on http://{HOST}:{PORT}')
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print('Keyboard interrupt received, exiting.', flush=True)
    finally:
        server.server_close()
