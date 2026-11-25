import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeRingsDiagonalKm } from '../shared/region-geometry.ts';
import type { AreaRegionId, ContinentId } from '../shared/region-ids.ts';
import { WORLD_DIAGONAL_KM } from '../shared/score.ts';

type LngLat = [number, number];
type Ring = LngLat[];
type PolyContinent = ContinentId;

interface RawFeature {
  properties: {
    ADMIN?: string;
    ISO_A2?: string;
    ISO_A2_EH?: string;
    ADM0_A3?: string;
    CONTINENT?: string;
    NAME_RU?: string;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface CompactPolygon {
  region: PolyContinent;
  bbox: [number, number, number, number];
  area: number;
  ring: LngLat[];
}

export interface CompactCountry {
  id: string;
  iso: string;
  nameRu: string;
  polygons: CompactPolygon[];
}

export interface RegionsDataset {
  version: 1;
  diagonalsKm: Record<AreaRegionId, number>;
  countries: CompactCountry[];
}

const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const CONTINENT_TO_REGION: Record<string, PolyContinent | undefined> = {
  Europe: 'europe',
  Asia: 'asia',
  'North America': 'north_america',
  'South America': 'south_america',
  Africa: 'africa',
  Oceania: 'oceania',
};

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function ringSignedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring.at(i);
    const b = ring.at((i + 1) % ring.length);
    if (!a || !b) continue;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function polygonCentroid(ring: Ring): LngLat {
  let sx = 0;
  let sy = 0;
  const count = Math.max(1, ring.length - 1);
  for (let i = 0; i < count; i += 1) {
    const pt = ring.at(i);
    if (!pt) continue;
    sx += pt[0];
    sy += pt[1];
  }
  return [sx / count, sy / count];
}

function ringBbox(ring: Ring): [number, number, number, number] {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [roundCoord(minLng), roundCoord(minLat), roundCoord(maxLng), roundCoord(maxLat)];
}

function clipRingHalfPlane(ring: Ring, keepLeftOf60: boolean): Ring {
  const bound = 60;
  const inside = (pt: LngLat) => (keepLeftOf60 ? pt[0] <= bound : pt[0] >= bound);
  const intersect = (a: LngLat, b: LngLat): LngLat => {
    const dx = b[0] - a[0];
    if (Math.abs(dx) < 1e-9) return [bound, a[1]];
    const t = (bound - a[0]) / dx;
    return [bound, roundCoord(a[1] + t * (b[1] - a[1]))];
  };
  const open = ring.length > 1 ? ring.slice(0, -1) : ring;
  const out: Ring = [];
  for (let i = 0; i < open.length; i += 1) {
    const curr = open.at(i);
    const prev = open.at((i - 1 + open.length) % open.length);
    if (!curr || !prev) continue;
    const currIn = inside(curr);
    const prevIn = inside(prev);
    if (currIn !== prevIn) out.push(intersect(prev, curr));
    if (currIn) out.push([roundCoord(curr[0]), roundCoord(curr[1])]);
  }
  const firstOut = out.at(0);
  if (out.length >= 3 && firstOut) out.push(firstOut);
  return out;
}

function classifyPolygonRegion(
  iso: string,
  baseRegion: PolyContinent,
  ring: Ring,
): Array<{ region: PolyContinent; ring: Ring }> {
  const [cLng, cLat] = polygonCentroid(ring);
  if (iso === 'RU') {
    const maxLng = Math.max(...ring.map((p) => p[0]));
    const minLng = Math.min(...ring.map((p) => p[0]));
    if (minLng < -100 || minLng >= 60) return [{ region: 'asia', ring }];
    if (maxLng <= 60) return [{ region: 'europe', ring }];
    const west = clipRingHalfPlane(ring, true);
    const east = clipRingHalfPlane(ring, false);
    const split: Array<{ region: PolyContinent; ring: Ring }> = [];
    if (west.length >= 4) split.push({ region: 'europe', ring: west });
    if (east.length >= 4) split.push({ region: 'asia', ring: east });
    return split;
  }
  if (iso === 'FR' && cLng < -30 && cLat < 15) {
    return [{ region: 'south_america', ring }];
  }
  if (cLat < -60) return [];
  return [{ region: baseRegion, ring }];
}

function convertFeature(f: RawFeature): CompactCountry | null {
  const baseRegion = CONTINENT_TO_REGION[f.properties.CONTINENT ?? ''];
  if (!baseRegion) return null;
  const iso = (
    f.properties.ISO_A2_EH && f.properties.ISO_A2_EH !== '-99'
      ? f.properties.ISO_A2_EH
      : f.properties.ISO_A2 && f.properties.ISO_A2 !== '-99'
        ? f.properties.ISO_A2
        : (f.properties.ADM0_A3 ?? 'XX')
  ).toUpperCase();
  const id = (f.properties.ADM0_A3 ?? iso).toUpperCase();
  const nameRu = f.properties.NAME_RU ?? f.properties.ADMIN ?? id;

  const rawPolys =
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates as number[][][]]
      : (f.geometry.coordinates as number[][][][]);

  const polygons: CompactPolygon[] = [];
  for (const poly of rawPolys) {
    const outer: Ring = (poly[0] ?? []).map((pt) => [
      roundCoord(pt[0] ?? 0),
      roundCoord(pt[1] ?? 0),
    ]);
    if (outer.length < 4) continue;
    for (const piece of classifyPolygonRegion(iso, baseRegion, outer)) {
      const midLat = polygonCentroid(piece.ring)[1];
      const cosFactor = Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
      const area = Math.round(ringSignedArea(piece.ring) * cosFactor * 10000) / 10000;
      if (area <= 0) continue;
      polygons.push({ region: piece.region, bbox: ringBbox(piece.ring), area, ring: piece.ring });
    }
  }
  if (polygons.length === 0) return null;
  return { id, iso, nameRu, polygons };
}

async function loadRawGeoJson(): Promise<{ features: RawFeature[] }> {
  const cachePath = '/tmp/ne_110m.geojson';
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as { features: RawFeature[] };
  }
  const res = await fetch(NE_URL);
  if (!res.ok) throw new Error(`Failed to fetch Natural Earth GeoJSON: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(cachePath, text);
  return JSON.parse(text) as { features: RawFeature[] };
}

export async function buildRegions(): Promise<RegionsDataset> {
  const raw = await loadRawGeoJson();
  const countries = raw.features.map(convertFeature).filter((c): c is CompactCountry => c !== null);

  const regionBuckets: Record<PolyContinent, CompactPolygon[]> = {
    europe: [],
    asia: [],
    north_america: [],
    south_america: [],
    africa: [],
    oceania: [],
  };
  for (const country of countries) {
    for (const poly of country.polygons) {
      regionBuckets[poly.region].push(poly);
    }
  }

  const diagonalsKm: Record<AreaRegionId, number> = {
    world: WORLD_DIAGONAL_KM,
    europe: computeRingsDiagonalKm(regionBuckets.europe.map((p) => p.ring)),
    asia: computeRingsDiagonalKm(regionBuckets.asia.map((p) => p.ring)),
    north_america: computeRingsDiagonalKm(regionBuckets.north_america.map((p) => p.ring)),
    south_america: computeRingsDiagonalKm(regionBuckets.south_america.map((p) => p.ring)),
    africa: computeRingsDiagonalKm(regionBuckets.africa.map((p) => p.ring)),
    oceania: computeRingsDiagonalKm(regionBuckets.oceania.map((p) => p.ring)),
  };

  return { version: 1, diagonalsKm, countries };
}

if (import.meta.main) {
  const data = await buildRegions();
  const outPath = path.resolve(import.meta.dir, '../shared/regions.data.json');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(data)}\n`);
  console.log(
    'Generated',
    outPath,
    'countries:',
    data.countries.length,
    'diagonalsKm:',
    data.diagonalsKm,
  );
}
