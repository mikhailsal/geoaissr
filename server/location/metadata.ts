import type { LatLng } from '../../shared/score.ts';
import { GeoError } from '../errors.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SvMetadataResponse {
  status: string;
  pano_id?: string;
  copyright?: string;
  location?: { lat: number; lng: number };
  /** Month the panorama was shot, `YYYY-MM`. Absent for some panoramas. */
  date?: string;
  error_message?: string;
}

/** A panorama a round can start at. */
export interface PanoFix extends LatLng {
  panoId: string;
  /** Year the panorama was shot, or null when Google does not say. */
  year: number | null;
}

/** After this many lookups in a row that never reached Google, the round is given up. */
export const MAX_TRANSPORT_FAILURES = 3;

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
      const data = (await res.json()) as SvMetadataResponse;
      // Google's server error: the same request may succeed when sent again. It is not "no
      // panorama here", so it never counts as a miss of a round or of a coverage scan.
      if (data.status === 'UNKNOWN_ERROR') {
        lastError = new Error('Street View Metadata UNKNOWN_ERROR');
        continue;
      }
      return data;
    } catch (err) {
      if (err instanceof GeoError) throw err;
      lastError = err;
    }
  }
  throw new Error(
    lastError instanceof Error ? lastError.message : 'Street View metadata request failed',
  );
}

function parseYear(date: string | undefined): number | null {
  const year = Number((date ?? '').slice(0, 4));
  return Number.isInteger(year) && year > 2000 ? year : null;
}

/** Keeps only an official Google panorama with a usable position. */
export function validateMetadataPayload(data: SvMetadataResponse): PanoFix | null {
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
  return {
    panoId: data.pano_id,
    lat: data.location.lat,
    lng: data.location.lng,
    year: parseYear(data.date),
  };
}

export interface MetadataClient {
  /** One raw lookup. Throws when Google could not be reached. */
  query: (lat: number, lng: number, radius?: number) => Promise<SvMetadataResponse | null>;
  /**
   * A lookup for the samplers: the panorama near a point, or null when there is none. A lookup
   * that never reached Google also gives null, until `MAX_TRANSPORT_FAILURES` of them in a row
   * end the search with `GEO_GOOGLE_UNREACHABLE`.
   */
  find: (pos: LatLng, radiusM: number) => Promise<PanoFix | null>;
  /** Requests sent so far, the second try of a lookup included; for the sampling tool. */
  lookupCount: () => number;
}

export function createMetadataClient(opts: {
  serverKey: string;
  fetchImpl?: FetchLike;
}): MetadataClient {
  const send: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  let requests = 0;
  // Counted where a request leaves: a lookup that is tried twice is two requests.
  const fetchImpl: FetchLike = (u, init) => {
    requests += 1;
    return send(u, init);
  };
  let failuresInRow = 0;

  async function query(lat: number, lng: number, radius = 5000): Promise<SvMetadataResponse> {
    const params = new URLSearchParams({
      location: `${lat.toFixed(6)},${lng.toFixed(6)}`,
      radius: String(radius),
      source: 'outdoor',
      key: opts.serverKey,
    });
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
    return fetchMetadataWithRetry(url, fetchImpl);
  }

  async function find(pos: LatLng, radiusM: number): Promise<PanoFix | null> {
    let raw: SvMetadataResponse;
    try {
      raw = await query(pos.lat, pos.lng, radiusM);
    } catch (err) {
      if (err instanceof GeoError) throw err;
      failuresInRow += 1;
      if (failuresInRow >= MAX_TRANSPORT_FAILURES) {
        failuresInRow = 0;
        throw new GeoError({
          code: 'GEO_GOOGLE_UNREACHABLE',
          causeDetail: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }
    failuresInRow = 0;
    return validateMetadataPayload(raw);
  }

  return { query, find, lookupCount: () => requests };
}
