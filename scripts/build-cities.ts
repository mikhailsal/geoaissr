import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  encodeRing,
  type CitiesDataset,
  type CityCentreRecord,
} from '../server/maps/cities-format.ts';
import {
  PLACE_FLAG_DISTRICT,
  PLACE_RECORD_LENGTH,
  type PlacesDataset,
} from '../server/maps/places-format.ts';
import { pointInRing } from '../shared/regions.ts';
import { haversineDistanceKm } from '../shared/score.ts';
import { loadDatasetBytes, parseBuilderArgs, writeDatasetFile } from './lib/dataset-io.ts';
import { mollweideToLatLng, parseGpkgGeometry } from './lib/gpkg.ts';
import { readZipEntry } from './lib/zip.ts';

/** GHSL Urban Centre Database R2024A V1.2, European Commission JRC, CC BY 4.0. */
const SOURCE_URL =
  'https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_THEME_GLOBE_R2024A/GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A/V1-2/GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A_V1_2.zip';
const TABLE = 'GHSL_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A';
export const MIN_CENTRE_POPULATION = 500_000;
/**
 * An outline whose largest known place is smaller than this is dense countryside, not a city:
 * about 70 such centres sit in India, Bangladesh and the Nile valley.
 */
export const MIN_CORE_POPULATION = 150_000;
/** Google has no street-level coverage in mainland China. */
const NO_COVERAGE_ISO = new Set(['CN']);
/** A real build keeps over 800 centres; far fewer means a broken input. */
const MIN_EXPECTED_CENTRES = 500;

type LngLat = [number, number];

export interface UrbanCentreInput {
  name: string;
  population: number;
  /** Outer rings of the dense area as `[lng, lat]` degrees. */
  rings: LngLat[][];
}

interface KnownPlace {
  iso: string;
  lat: number;
  lng: number;
  population: number;
  district: boolean;
}

export interface CitiesBuildStats {
  considered: number;
  kept: number;
  droppedNoCity: number;
  droppedNoCoverage: number;
}

export function flattenPlaces(dataset: PlacesDataset): KnownPlace[] {
  const all: KnownPlace[] = [];
  for (const [iso, flat] of Object.entries(dataset.places)) {
    for (let i = 0; i + PLACE_RECORD_LENGTH <= flat.length; i += PLACE_RECORD_LENGTH) {
      all.push({
        iso,
        lat: flat[i] ?? 0,
        lng: flat[i + 1] ?? 0,
        population: flat[i + 2] ?? 0,
        district: ((flat[i + 4] ?? 0) & PLACE_FLAG_DISTRICT) !== 0,
      });
    }
  }
  return all;
}

function ringBbox(rings: readonly LngLat[][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** A place this close to the outline still belongs to it: outlines follow 1 km grid cells. */
const CORE_PLACE_MARGIN_KM = 3;

/** Where a place stands to an outline: inside it, within the margin around it, or apart. */
function standingToOutline(
  place: KnownPlace,
  rings: readonly LngLat[][],
): 'inside' | 'near' | null {
  let near = false;
  for (const ring of rings) {
    if (pointInRing(place.lng, place.lat, ring)) return 'inside';
    near ||= ring.some(
      ([lng, lat]) => haversineDistanceKm(place, { lat, lng }) <= CORE_PLACE_MARGIN_KM,
    );
  }
  return near ? 'near' : null;
}

/** A city of its own before a borough, then the more populous of the two. */
function isBetterCore(best: KnownPlace | null, place: KnownPlace): boolean {
  if (!best) return true;
  if (best.district !== place.district) return best.district;
  return place.population > best.population;
}

/**
 * The core city of an outline: a city big enough that lies inside it, otherwise the best place
 * inside it or within the margin. The margin alone would hand an outline to a bigger city just
 * across its edge, which may be in another country (Johor Bahru for the north of Singapore).
 */
function findCorePlace(
  rings: readonly LngLat[][],
  places: readonly KnownPlace[],
): KnownPlace | null {
  const [minLng, minLat, maxLng, maxLat] = ringBbox(rings);
  // About 3 km in degrees of latitude; wider in longitude, where a degree is shorter.
  const padLat = CORE_PLACE_MARGIN_KM / 111;
  const padLng = padLat / Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  let inside: KnownPlace | null = null;
  let best: KnownPlace | null = null;
  for (const place of places) {
    if (place.lng < minLng - padLng || place.lng > maxLng + padLng) continue;
    if (place.lat < minLat - padLat || place.lat > maxLat + padLat) continue;
    const standing = standingToOutline(place, rings);
    if (standing === null) continue;
    if (isBetterCore(best, place)) best = place;
    const bigEnough = place.population >= MIN_CORE_POPULATION;
    if (standing === 'inside' && bigEnough && isBetterCore(inside, place)) inside = place;
  }
  return inside ?? best;
}

/**
 * Keeps the urban centres a round can start in: 500 thousand people or more, with a real city
 * inside and with street-level coverage in the country of that city.
 */
export function buildCities(
  centres: readonly UrbanCentreInput[],
  places: readonly KnownPlace[],
  minExpected = MIN_EXPECTED_CENTRES,
): { dataset: CitiesDataset; stats: CitiesBuildStats } {
  const stats: CitiesBuildStats = {
    considered: 0,
    kept: 0,
    droppedNoCity: 0,
    droppedNoCoverage: 0,
  };
  const records: CityCentreRecord[] = [];
  for (const centre of centres) {
    if (!(centre.population >= MIN_CENTRE_POPULATION)) continue;
    stats.considered += 1;
    const rings = centre.rings.filter((ring) => ring.length >= 4);
    const core = findCorePlace(rings, places);
    if (!core || core.population < MIN_CORE_POPULATION) {
      stats.droppedNoCity += 1;
      continue;
    }
    if (NO_COVERAGE_ISO.has(core.iso)) {
      stats.droppedNoCoverage += 1;
      continue;
    }
    records.push({
      name: centre.name,
      iso: core.iso,
      pop: Math.round(centre.population / 1000) * 1000,
      core: [core.lat, core.lng],
      rings: rings.map((ring) => encodeRing(ring)),
    });
  }
  stats.kept = records.length;
  if (records.length < minExpected) {
    throw new Error(
      `Only ${records.length} urban centres were kept, expected at least ${minExpected}`,
    );
  }
  records.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name) || a.core[0] - b.core[0]);
  return {
    dataset: {
      version: 1,
      source:
        'GHSL Urban Centre Database R2024A V1.2 (European Commission JRC, CC BY 4.0), doi:10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd; core cities from GeoNames (CC BY 4.0)',
      centres: records,
    },
    stats,
  };
}

/** Reads every urban centre with its outline, turned from Mollweide metres into degrees. */
export function readUrbanCentres(gpkgPath: string): UrbanCentreInput[] {
  const db = new Database(gpkgPath, { readonly: true });
  try {
    const rows = db
      .query(`select GC_UCN_MAI_2025 as name, GC_POP_TOT_2025 as population, geom from "${TABLE}"`)
      .all() as { name: string | null; population: number | null; geom: Uint8Array | null }[];
    return rows.flatMap((row) => {
      if (!row.geom || typeof row.population !== 'number') return [];
      const rings = parseGpkgGeometry(row.geom).flatMap((polygon) => {
        const outer = polygon[0];
        if (!outer) return [];
        return [
          outer.map(([x, y]): LngLat => {
            const { lat, lng } = mollweideToLatLng(x, y);
            return [lng, lat];
          }),
        ];
      });
      return [{ name: row.name ?? '', population: row.population, rings }];
    });
  } finally {
    db.close();
  }
}

/** `bun:sqlite` opens files only, so an archive is unpacked into a private temporary folder. */
async function withGeoPackage<T>(
  args: Record<string, string>,
  use: (gpkgPath: string) => T,
): Promise<T> {
  if (args.gpkg) return use(args.gpkg);
  const zip = await loadDatasetBytes({
    localPath: args.zip,
    url: SOURCE_URL,
    label: 'GHSL UCDB archive',
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'geoaissr-ucdb-'));
  try {
    const gpkgPath = path.join(dir, 'ucdb.gpkg');
    writeFileSync(
      gpkgPath,
      readZipEntry(zip, (name) => name.endsWith('.gpkg')),
    );
    return use(gpkgPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = parseBuilderArgs(process.argv.slice(2), ['gpkg', 'zip']);
  const placesPath = path.resolve(import.meta.dir, '../server/maps/places.data.json');
  const places = flattenPlaces(JSON.parse(readFileSync(placesPath, 'utf8')) as PlacesDataset);
  const centres = await withGeoPackage(args, readUrbanCentres);
  const { dataset, stats } = buildCities(centres, places);
  const outPath = path.resolve(import.meta.dir, '../server/maps/cities.data.json');
  writeDatasetFile(outPath, dataset);
  console.log('Generated', outPath, JSON.stringify(stats));
}
