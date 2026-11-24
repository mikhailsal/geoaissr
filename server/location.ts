import {
  findCountryAtPoint,
  getWeightedCountriesForRegion,
  samplePointInPolygon,
  sampleWeightedItem,
  type RegionPolygon,
  type WeightedCountry,
} from '../shared/regions.ts';
import { isPointMapId, type PointMapId, type RegionId } from '../shared/storage-schemas.ts';
import type { RoundTarget } from './engine/types.ts';
import { GeoError } from './errors.ts';
import {
  AIRPORT_SNAP_RADIUS_M,
  airportCountryId,
  airportCountryNameRu,
  getAirportCountryGroups,
  isInsideAirportZone,
  isoCodesOfCountryIds,
  sampleAirportProbe,
} from './maps/airports.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface SvMetadataResponse {
  status: string;
  pano_id?: string;
  copyright?: string;
  location?: { lat: number; lng: number };
  error_message?: string;
}

export interface LocationService {
  prepareRoundLocation: (opts: {
    region: RegionId;
    excludeCountryIds: readonly string[];
  }) => Promise<RoundTarget>;
  queryMetadata: (lat: number, lng: number, radius?: number) => Promise<SvMetadataResponse | null>;
}

function pickWeightedPolygon(entry: WeightedCountry, rng: () => number): RegionPolygon {
  if (entry.polygons.length === 1 && entry.polygons[0]) {
    return entry.polygons[0];
  }
  return sampleWeightedItem(
    entry.polygons.map((p) => ({ poly: p, weight: Math.max(0.01, p.area) })),
    rng,
  ).poly;
}

async function fetchMetadataWithRetry(
  url: string,
  fetchImpl: FetchLike,
): Promise<SvMetadataResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
      if (res.status === 403) {
        throw new GeoError({
          code: 'GEO_GOOGLE_KEY_DENIED',
          causeDetail: 'Google Street View Metadata API returned HTTP 403',
        });
      }
      if (res.status === 429) {
        throw new GeoError({
          code: 'GEO_GOOGLE_QUOTA',
          causeDetail: 'Google Street View Metadata API returned HTTP 429',
        });
      }
      if (res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return (await res.json()) as SvMetadataResponse;
    } catch (err) {
      if (err instanceof GeoError) throw err;
      lastError = err;
    }
  }
  throw new Error(
    lastError instanceof Error ? lastError.message : 'Street View metadata request failed',
  );
}

function validateMetadataPayload(data: SvMetadataResponse): {
  panoId: string;
  lat: number;
  lng: number;
} | null {
  if (data.status === 'REQUEST_DENIED') {
    throw new GeoError({
      code: 'GEO_GOOGLE_KEY_DENIED',
      causeDetail: data.error_message ?? 'Street View Metadata REQUEST_DENIED',
    });
  }
  if (data.status === 'OVER_DAILY_LIMIT' || data.status === 'OVER_QUERY_LIMIT') {
    throw new GeoError({
      code: 'GEO_GOOGLE_QUOTA',
      causeDetail: data.error_message ?? `Street View Metadata ${data.status}`,
    });
  }
  if (data.status !== 'OK' || !data.pano_id || !data.location) {
    return null;
  }
  if (!Number.isFinite(data.location.lat) || !Number.isFinite(data.location.lng)) {
    return null;
  }
  if (typeof data.copyright !== 'string' || !/google/i.test(data.copyright)) {
    return null;
  }
  return { panoId: data.pano_id, lat: data.location.lat, lng: data.location.lng };
}

const AIRPORT_MAX_ATTEMPTS = 90;

/** Finds a panorama inside the 5 km zone of an airport with scheduled service. */
async function prepareAirportLocation(
  input: { region: PointMapId; excludeCountryIds: readonly string[] },
  deps: { queryMetadata: LocationService['queryMetadata']; rng: () => number },
): Promise<RoundTarget> {
  const playedIso = isoCodesOfCountryIds(input.excludeCountryIds);
  const groups = getAirportCountryGroups(playedIso);
  const allowedIso = new Set(groups.map((group) => group.iso));
  for (let attempt = 0; attempt < AIRPORT_MAX_ATTEMPTS; attempt += 1) {
    const pick = sampleAirportProbe(groups, deps.rng);
    const raw = await deps
      .queryMetadata(pick.probe.lat, pick.probe.lng, AIRPORT_SNAP_RADIUS_M)
      .catch((err: unknown) => {
        if (err instanceof GeoError) throw err;
        return null;
      });
    if (!raw) continue;
    const valid = validateMetadataPayload(raw);
    if (!valid || !isInsideAirportZone(pick.airport, valid)) continue;
    const country = findCountryAtPoint({ lat: valid.lat, lng: valid.lng });
    // An airport near a border can snap into a country already played in this match.
    if (country && playedIso.has(country.iso) && !allowedIso.has(country.iso)) continue;
    return {
      panoId: valid.panoId,
      lat: valid.lat,
      lng: valid.lng,
      countryId: country?.id ?? airportCountryId(pick.iso),
      countryNameRu: country?.nameRu ?? airportCountryNameRu(pick.iso),
      region: input.region,
      fakeSceneIndex: 0,
    };
  }
  throw new Error(
    `Не удалось найти уличную панораму Google рядом с аэропортом за ${AIRPORT_MAX_ATTEMPTS} попыток`,
  );
}

export function createLocationService(opts: {
  serverKey: string;
  fetchImpl?: FetchLike;
  rng?: () => number;
}): LocationService {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const rng = opts.rng ?? Math.random;

  async function queryMetadata(
    lat: number,
    lng: number,
    radius = 5000,
  ): Promise<SvMetadataResponse | null> {
    const params = new URLSearchParams({
      location: `${lat.toFixed(6)},${lng.toFixed(6)}`,
      radius: String(radius),
      source: 'outdoor',
      key: opts.serverKey,
    });
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
    return fetchMetadataWithRetry(url, fetchImpl);
  }

  async function prepareRoundLocation(input: {
    region: RegionId;
    excludeCountryIds: readonly string[];
  }): Promise<RoundTarget> {
    const { region } = input;
    if (isPointMapId(region)) {
      return prepareAirportLocation({ ...input, region }, { queryMetadata, rng });
    }
    const exclude = new Set(input.excludeCountryIds);
    for (let series = 0; series < 3; series += 1) {
      const candidates = getWeightedCountriesForRegion(region, exclude);
      const allowedIds = new Set(candidates.map((c) => c.country.id));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const picked = sampleWeightedItem(candidates, rng);
        const poly = pickWeightedPolygon(picked, rng);
        const samplePos = samplePointInPolygon(poly, rng);
        const raw = await queryMetadata(samplePos.lat, samplePos.lng, 5000).catch(
          (err: unknown) => {
            if (err instanceof GeoError) throw err;
            return null;
          },
        );
        if (!raw) continue;
        const valid = validateMetadataPayload(raw);
        if (!valid) continue;
        const resolvedCountry = findCountryAtPoint({ lat: valid.lat, lng: valid.lng });
        // The snapped pano can sit across a border: outside the region or in a country already played.
        if (resolvedCountry && !allowedIds.has(resolvedCountry.id)) continue;
        return {
          panoId: valid.panoId,
          lat: valid.lat,
          lng: valid.lng,
          countryId: resolvedCountry?.id ?? picked.country.id,
          countryNameRu: resolvedCountry?.nameRu ?? picked.country.nameRu,
          region: input.region,
          fakeSceneIndex: 0,
        };
      }
    }
    throw new Error(
      `Не удалось найти уличную панораму Google в регионе «${input.region}» за 90 попыток`,
    );
  }

  return { prepareRoundLocation, queryMetadata };
}

const FAKE_SCENES: ReadonlyArray<Omit<RoundTarget, 'region'>> = [
  {
    panoId: 'fake-moscow',
    lat: 55.7558,
    lng: 37.6173,
    countryId: '643-eu',
    countryNameRu: 'Россия',
    fakeSceneIndex: 0,
  },
  {
    panoId: 'fake-paris',
    lat: 48.8566,
    lng: 2.3522,
    countryId: '250',
    countryNameRu: 'Франция',
    fakeSceneIndex: 1,
  },
  {
    panoId: 'fake-tokyo',
    lat: 35.6762,
    lng: 139.6503,
    countryId: '392',
    countryNameRu: 'Япония',
    fakeSceneIndex: 2,
  },
  {
    panoId: 'fake-rio',
    lat: -22.9068,
    lng: -43.1729,
    countryId: '076',
    countryNameRu: 'Бразилия',
    fakeSceneIndex: 3,
  },
  {
    panoId: 'fake-sydney',
    lat: -33.8688,
    lng: 151.2093,
    countryId: '036',
    countryNameRu: 'Австралия',
    fakeSceneIndex: 4,
  },
  {
    panoId: 'fake-cairo',
    lat: 30.0444,
    lng: 31.2357,
    countryId: '818',
    countryNameRu: 'Египет',
    fakeSceneIndex: 5,
  },
  {
    panoId: 'fake-nyc',
    lat: 40.7128,
    lng: -74.006,
    countryId: '840',
    countryNameRu: 'США',
    fakeSceneIndex: 6,
  },
];

export function createFakeLocationService(): LocationService {
  let cursor = 0;
  return {
    async prepareRoundLocation({ region, excludeCountryIds }) {
      const pool =
        region === 'world'
          ? FAKE_SCENES
          : FAKE_SCENES.filter((s) => !excludeCountryIds.includes(s.countryId));
      const list = pool.length > 0 ? pool : FAKE_SCENES;
      const picked =
        list.find((s) => !excludeCountryIds.includes(s.countryId)) ?? list[cursor % list.length];
      cursor += 1;
      const fallback = FAKE_SCENES[0];
      const base = picked ??
        fallback ?? {
          panoId: 'fake-moscow',
          lat: 55.7558,
          lng: 37.6173,
          countryId: '643-eu',
          countryNameRu: 'Россия',
          fakeSceneIndex: 0,
        };
      return Promise.resolve({ ...base, region });
    },
    async queryMetadata(lat, lng) {
      return Promise.resolve({
        status: 'OK',
        pano_id: 'fake-pano',
        copyright: '© Google',
        location: { lat, lng },
      });
    },
  };
}
