import path from 'node:path';
import {
  PLACE_FLAG_CAPITAL,
  PLACE_FLAG_DISTRICT,
  PLACE_RECORD_LENGTH,
  type PlacesDataset,
} from '../server/maps/places-format.ts';
import { loadDatasetBytes, parseBuilderArgs, writeDatasetFile } from './lib/dataset-io.ts';
import { readZipEntry } from './lib/zip.ts';

/** GeoNames publishes its gazetteer under CC BY 4.0: https://www.geonames.org/export/ */
const SOURCE_URL = 'https://download.geonames.org/export/dump/cities15000.zip';
/** Abandoned, destroyed and historical places are not somewhere a round can start. */
const SKIPPED_FEATURE_CODES = new Set(['PPLH', 'PPLQ', 'PPLW']);
const MIN_POPULATION = 15_000;
/** A real download holds over 30 thousand places; far fewer means a broken file. */
const MIN_EXPECTED_PLACES = 20_000;

interface PlaceRow {
  iso: string;
  lat: number;
  lng: number;
  population: number;
  elevation: number;
  flags: number;
}

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function parsePlaceRow(line: string): PlaceRow | null {
  const cells = line.split('\t');
  const featureCode = cells[7] ?? '';
  const iso = (cells[8] ?? '').toUpperCase();
  // A blank cell must not turn into 0: Number('') is 0, so check the text first.
  const rawLat = (cells[4] ?? '').trim();
  const rawLng = (cells[5] ?? '').trim();
  if (rawLat === '' || rawLng === '' || !/^[A-Z]{2}$/.test(iso)) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  if (SKIPPED_FEATURE_CODES.has(featureCode)) return null;
  const population = Number(cells[14] ?? '');
  const isCapital = featureCode === 'PPLC';
  if (!Number.isFinite(population) || (population < MIN_POPULATION && !isCapital)) return null;
  // The `elevation` cell is mostly blank; `dem` (a terrain model reading) is always filled.
  const elevation = Number(cells[16] ?? '');
  const flags =
    (isCapital ? PLACE_FLAG_CAPITAL : 0) | (featureCode === 'PPLX' ? PLACE_FLAG_DISTRICT : 0);
  return {
    iso,
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    population: Math.round(population),
    elevation: Number.isFinite(elevation) ? Math.round(elevation) : 0,
    flags,
  };
}

/** Turns the tab-separated `cities15000.txt` into the compact per-country list the server reads. */
export function buildPlaces(text: string, minExpected = MIN_EXPECTED_PLACES): PlacesDataset {
  const byIso = new Map<string, PlaceRow[]>();
  let total = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const row = parsePlaceRow(line);
    if (!row) continue;
    const list = byIso.get(row.iso) ?? [];
    list.push(row);
    byIso.set(row.iso, list);
    total += 1;
  }
  if (total < minExpected) {
    throw new Error(`GeoNames file holds ${total} usable places, expected at least ${minExpected}`);
  }
  const places: Record<string, number[]> = {};
  for (const iso of [...byIso.keys()].sort()) {
    const rows = (byIso.get(iso) ?? []).sort(
      (a, b) => b.population - a.population || a.lat - b.lat || a.lng - b.lng,
    );
    places[iso] = rows.flatMap((r) => [r.lat, r.lng, r.population, r.elevation, r.flags]);
  }
  return {
    version: 1,
    source: 'GeoNames cities15000 (CC BY 4.0), https://www.geonames.org/',
    places,
  };
}

if (import.meta.main) {
  const args = parseBuilderArgs(process.argv.slice(2), ['zip']);
  const zip = await loadDatasetBytes({
    localPath: args.zip,
    url: SOURCE_URL,
    label: 'GeoNames cities15000.zip',
  });
  const text = new TextDecoder().decode(readZipEntry(zip, (name) => name === 'cities15000.txt'));
  const data = buildPlaces(text);
  const outPath = path.resolve(import.meta.dir, '../server/maps/places.data.json');
  writeDatasetFile(outPath, data);
  const total = Object.values(data.places).reduce(
    (sum, list) => sum + list.length / PLACE_RECORD_LENGTH,
    0,
  );
  console.log(
    'Generated',
    outPath,
    'places:',
    total,
    'countries:',
    Object.keys(data.places).length,
  );
}
