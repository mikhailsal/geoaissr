import path from 'node:path';
import { writeDatasetFile } from './lib/dataset-io.ts';

/** OurAirports publishes its data into the public domain: https://ourairports.com/data/ */
const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const KEPT_TYPES = new Set(['large_airport', 'medium_airport']);

export interface AirportsDataset {
  version: 1;
  source: string;
  /** ISO 3166-1 alpha-2 country code to `[lat, lng]` pairs, both sorted for stable diffs. */
  airports: Record<string, [number, number][]>;
}

/** RFC 4180 reader: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field: the download is cut short');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function roundCoord(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A real download keeps over 3000 airports; far fewer means a broken or cut file. */
const MIN_EXPECTED_AIRPORTS = 2000;

/** Keeps large and medium airports with scheduled passenger service. */
export function buildAirports(
  csvText: string,
  minExpected = MIN_EXPECTED_AIRPORTS,
): AirportsDataset {
  const [header, ...rows] = parseCsv(csvText);
  if (!header) throw new Error('OurAirports CSV is empty');
  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`OurAirports CSV has no "${name}" column`);
    return index;
  };
  const typeAt = column('type');
  const latAt = column('latitude_deg');
  const lngAt = column('longitude_deg');
  const isoAt = column('iso_country');
  const scheduledAt = column('scheduled_service');

  const byIso = new Map<string, [number, number][]>();
  for (const row of rows) {
    if (!KEPT_TYPES.has(row[typeAt] ?? '') || row[scheduledAt] !== 'yes') continue;
    const iso = (row[isoAt] ?? '').toUpperCase();
    // A blank cell must not turn into 0: Number('') is 0, so check the text first.
    const rawLat = (row[latAt] ?? '').trim();
    const rawLng = (row[lngAt] ?? '').trim();
    if (rawLat === '' || rawLng === '') continue;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!/^[A-Z]{2}$/.test(iso) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const list = byIso.get(iso) ?? [];
    list.push([roundCoord(lat), roundCoord(lng)]);
    byIso.set(iso, list);
  }

  const total = [...byIso.values()].reduce((sum, list) => sum + list.length, 0);
  if (total < minExpected) {
    throw new Error(
      `OurAirports CSV holds ${total} usable airports, expected at least ${minExpected}`,
    );
  }
  const airports: Record<string, [number, number][]> = {};
  for (const iso of [...byIso.keys()].sort()) {
    airports[iso] = (byIso.get(iso) ?? []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  return {
    version: 1,
    source: 'OurAirports (public domain), https://ourairports.com/data/',
    airports,
  };
}

/** Always downloads: a cached copy in a shared temp folder could be stale or planted. */
async function loadCsv(): Promise<string> {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Failed to fetch OurAirports CSV: HTTP ${res.status}`);
  return res.text();
}

if (import.meta.main) {
  const data = buildAirports(await loadCsv());
  const outPath = path.resolve(import.meta.dir, '../server/maps/airports.data.json');
  writeDatasetFile(outPath, data);
  const total = Object.values(data.airports).reduce((sum, list) => sum + list.length, 0);
  console.log(
    'Generated',
    outPath,
    'airports:',
    total,
    'countries:',
    Object.keys(data.airports).length,
  );
}
