// Map view: Leaflet + CARTO basemap, loaded the first time the map is opened.
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/";
const SRI = {
  css: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
  js: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
};
const LISBON = [38.7139, -9.1394];

let loading = null, map = null, layer = null, tiles = null, fitKey = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: LEAFLET + "leaflet.css", integrity: SRI.css, crossOrigin: "" });
    const js = Object.assign(document.createElement("script"), { src: LEAFLET + "leaflet.js", integrity: SRI.js, crossOrigin: "" });
    js.onload = () => resolve(window.L);
    js.onerror = () => { loading = null; css.remove(); js.remove(); reject(new Error("Leaflet failed to load")); };
    document.head.append(css, js);
  });
  return loading;
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
function setTiles(L) {
  const style = isDark() ? "dark_all" : "light_all";
  if (tiles && tiles.options.style === style) return;
  if (tiles) tiles.remove();
  tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    style, subdomains: "abcd", maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
}

/**
 * Draw bars on the map.
 * items: [{ id, lat, lng, label, html, hot }]: label is plain text for the pin, html is the popup (already escaped).
 * key: when it changes, the map re-fits to the pins (e.g. a new area filter).
 */
export async function drawMap(el, items, key) {
  const L = await loadLeaflet();
  if (!map) {
    map = L.map(el, { zoomControl: true, scrollWheelZoom: true }).setView(LISBON, 13);
    layer = L.layerGroup().addTo(map);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTiles(L));
  }
  setTiles(L);
  map.invalidateSize();

  const openId = layer.getLayers().find((m) => m.isPopupOpen())?.options.vid;
  layer.clearLayers();
  for (const it of items) {
    const icon = L.divIcon({ className: "pin" + (it.hot ? " hot" : ""), html: `<span>${it.label}</span>`, iconSize: null, iconAnchor: [0, 0], popupAnchor: [0, -30] });
    const m = L.marker([it.lat, it.lng], { icon, vid: it.id, title: it.title, riseOnHover: true }).bindPopup(it.html, { maxWidth: 260 });
    layer.addLayer(m);
    if (it.id === openId) m.openPopup();
  }
  if (key !== fitKey && items.length) {
    fitKey = key;
    if (items.length === 1) map.setView([items[0].lat, items[0].lng], 16);
    else map.fitBounds(items.map((i) => [i.lat, i.lng]), { padding: [40, 40], maxZoom: 16 });
  }
}

export function closeMapPopup() { if (map) map.closePopup(); }
