import { Loader } from '@googlemaps/js-api-loader';
import { ASPHALT_900_HEX, PAPER_HEX } from '$shared/colors';

export interface LoadedGoogleMaps {
  coreLib: google.maps.CoreLibrary;
  mapsLib: google.maps.MapsLibrary;
  streetViewLib: google.maps.StreetViewLibrary;
}

export interface PinOverlaySpec {
  id: string;
  lat: number;
  lng: number;
  fillHex: string;
  inkHex: string;
  label: string;
  isAi?: boolean;
  isTarget?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

const LIGHT_MAP_STYLES: google.maps.MapTypeStyle[] = [
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.business',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
];

let cachedPromise: Promise<LoadedGoogleMaps> | null = null;
let cachedKey = '';
const authFailureListeners = new Set<(message: string) => void>();

function installAuthFailureHook(): void {
  const win = window as Window & { gm_authFailure?: () => void };
  win.gm_authFailure = () => {
    const msg =
      'Ошибка авторизации ключа Google Maps JS (проверьте ключ и HTTP referrer ограничения)';
    for (const cb of authFailureListeners) {
      cb(msg);
    }
  };
}

export function subscribeMapsAuthFailure(cb: (message: string) => void): () => void {
  authFailureListeners.add(cb);
  return () => {
    authFailureListeners.delete(cb);
  };
}

export function loadGoogleMapsLibraries(apiKey: string): Promise<LoadedGoogleMaps> {
  if (cachedPromise && cachedKey === apiKey) {
    return cachedPromise;
  }
  installAuthFailureHook();
  cachedKey = apiKey;
  const loader = new Loader({
    apiKey,
    version: 'weekly',
    language: 'ru',
  });
  cachedPromise = Promise.all([
    loader.importLibrary('core'),
    loader.importLibrary('maps'),
    loader.importLibrary('streetView'),
  ])
    .then(([coreLib, mapsLib, streetViewLib]) => ({ coreLib, mapsLib, streetViewLib }))
    .catch((err: unknown) => {
      cachedPromise = null;
      throw err;
    });
  return cachedPromise;
}

export function buildLightMapOptions(
  center = { lat: 20, lng: 10 },
  zoom = 2,
): google.maps.MapOptions {
  return {
    center,
    zoom,
    minZoom: 1,
    maxZoom: 19,
    clickableIcons: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'greedy',
    styles: LIGHT_MAP_STYLES,
  };
}

function buildPinElement(spec: PinOverlaySpec): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = spec.label;
  btn.ariaLabel = spec.label || 'Метка';
  btn.style.position = 'absolute';
  btn.style.transform = 'translate(-50%, -50%)';
  btn.style.padding = '0';
  btn.style.cursor = spec.onClick ? 'pointer' : 'default';
  if (spec.isTarget) {
    btn.style.width = '24px';
    btn.style.height = '24px';
    btn.style.borderRadius = '999px';
    btn.style.background = '#FFD23F';
    btn.style.color = ASPHALT_900_HEX;
    btn.style.border = `2.5px solid ${ASPHALT_900_HEX}`;
    btn.style.fontWeight = '800';
    btn.textContent = '★';
  } else {
    const size = spec.selected ? '28px' : '22px';
    btn.style.width = size;
    btn.style.height = size;
    btn.style.borderRadius = spec.isAi ? '5px' : '999px';
    btn.style.background = spec.fillHex;
    btn.style.color = spec.inkHex;
    btn.style.border = `2px solid ${spec.selected ? PAPER_HEX : ASPHALT_900_HEX}`;
    btn.style.fontWeight = '700';
    btn.style.fontSize = '11px';
    btn.textContent = spec.label ? spec.label.slice(0, 1).toUpperCase() : '';
  }
  if (spec.onClick) {
    const clickCb = spec.onClick;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      clickCb();
    });
  }
  return btn;
}

function createPinOverlay(
  libs: LoadedGoogleMaps,
  map: google.maps.Map,
  spec: PinOverlaySpec,
): google.maps.OverlayView {
  let el: HTMLButtonElement | null = null;
  class PinOverlay extends libs.mapsLib.OverlayView {
    override onAdd(): void {
      el = buildPinElement(spec);
      const panes = this.getPanes();
      panes?.overlayMouseTarget.appendChild(el);
    }
    override draw(): void {
      if (!el) return;
      const projection = this.getProjection();
      const pt = projection.fromLatLngToDivPixel(new libs.coreLib.LatLng(spec.lat, spec.lng));
      if (!pt) return;
      el.style.left = `${pt.x}px`;
      el.style.top = `${pt.y}px`;
    }
    override onRemove(): void {
      el?.remove();
      el = null;
    }
  }
  const overlay = new PinOverlay();
  overlay.setMap(map);
  return overlay;
}

const cachedMaps = new Map<
  'guess' | 'results',
  {
    host: HTMLDivElement;
    map: google.maps.Map;
    overlays: Array<google.maps.OverlayView | google.maps.Polyline>;
  }
>();
let cachedPano: { host: HTMLDivElement; pano: google.maps.StreetViewPanorama } | null = null;

export interface GoogleGuessMapController {
  resetView: () => void;
  setPin: (spec: PinOverlaySpec | null) => void;
  setClickHandler: (cb: ((lat: number, lng: number) => void) | null) => void;
  triggerResize: () => void;
}

export async function mountReusableGuessMap(
  apiKey: string,
  container: HTMLElement,
): Promise<GoogleGuessMapController> {
  const libs = await loadGoogleMapsLibraries(apiKey);
  let entry = cachedMaps.get('guess');
  if (!entry) {
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    const map = new libs.mapsLib.Map(host, buildLightMapOptions());
    entry = { host, map, overlays: [] };
    cachedMaps.set('guess', entry);
  }
  container.replaceChildren(entry.host);
  libs.coreLib.event.trigger(entry.map, 'resize');

  let clickListener: google.maps.MapsEventListener | null = null;
  return {
    resetView: () => {
      entry.map.setCenter({ lat: 20, lng: 10 });
      entry.map.setZoom(2);
    },
    setPin: (spec) => {
      for (const o of entry.overlays) o.setMap(null);
      entry.overlays = spec ? [createPinOverlay(libs, entry.map, spec)] : [];
    },
    setClickHandler: (cb) => {
      clickListener?.remove();
      libs.coreLib.event.clearListeners(entry.map, 'click');
      clickListener = cb
        ? entry.map.addListener('click', (ev: google.maps.MapMouseEvent) => {
            if (ev.latLng) cb(ev.latLng.lat(), ev.latLng.lng());
          })
        : null;
    },
    triggerResize: () => {
      libs.coreLib.event.trigger(entry.map, 'resize');
    },
  };
}

export interface GoogleResultsMapController {
  render: (
    target: { lat: number; lng: number; label: string },
    pins: readonly PinOverlaySpec[],
    selectedId: string | null,
  ) => void;
  triggerResize: () => void;
}

export async function mountReusableResultsMap(
  apiKey: string,
  container: HTMLElement,
): Promise<GoogleResultsMapController> {
  const libs = await loadGoogleMapsLibraries(apiKey);
  let entry = cachedMaps.get('results');
  if (!entry) {
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    const map = new libs.mapsLib.Map(host, buildLightMapOptions());
    entry = { host, map, overlays: [] };
    cachedMaps.set('results', entry);
  }
  container.replaceChildren(entry.host);
  libs.coreLib.event.trigger(entry.map, 'resize');

  return {
    render: (target, pins, selectedId) => {
      for (const o of entry.overlays) o.setMap(null);
      entry.overlays = [];
      const bounds = new libs.coreLib.LatLngBounds();
      const targetPos = { lat: target.lat, lng: target.lng };
      bounds.extend(targetPos);

      for (const pin of pins) {
        const pos = { lat: pin.lat, lng: pin.lng };
        bounds.extend(pos);
        const line = new libs.mapsLib.Polyline({
          map: entry.map,
          path: [targetPos, pos],
          geodesic: true,
          strokeColor: pin.fillHex,
          strokeOpacity: selectedId === pin.id ? 1 : 0.72,
          strokeWeight: selectedId === pin.id ? 4 : 2,
        });
        entry.overlays.push(line, createPinOverlay(libs, entry.map, pin));
      }

      entry.overlays.push(
        createPinOverlay(libs, entry.map, {
          id: '__target__',
          lat: target.lat,
          lng: target.lng,
          fillHex: '',
          inkHex: '',
          label: target.label,
          isTarget: true,
        }),
      );
      entry.map.fitBounds(bounds, 48);
    },
    triggerResize: () => {
      libs.coreLib.event.trigger(entry.map, 'resize');
    },
  };
}

export async function mountReusableStreetView(
  apiKey: string,
  container: HTMLElement,
): Promise<google.maps.StreetViewPanorama> {
  const libs = await loadGoogleMapsLibraries(apiKey);
  if (cachedPano) {
    container.replaceChildren(cachedPano.host);
    libs.coreLib.event.trigger(cachedPano.pano, 'resize');
    return cachedPano.pano;
  }
  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '100%';
  container.replaceChildren(host);
  const pano = new libs.streetViewLib.StreetViewPanorama(host, {
    addressControl: false,
    showRoadLabels: false,
    enableCloseButton: false,
    fullscreenControl: false,
  });
  cachedPano = { host, pano };
  return pano;
}
