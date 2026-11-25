import { expect, test } from 'bun:test';
import {
  PLACE_FLAG_CAPITAL,
  PLACE_FLAG_DISTRICT,
  PLACE_RECORD_LENGTH,
} from '../server/maps/places-format.ts';
import { buildPlaces } from './build-places.ts';

interface PlaceFields {
  lat?: string;
  lng?: string;
  code?: string;
  iso?: string;
  pop?: number;
  dem?: number;
}

/** One GeoNames cities15000 line: 19 tab-separated columns. */
function line(f: PlaceFields): string {
  const cells = Array.from({ length: 19 }, () => '');
  cells[0] = '1';
  cells[1] = 'Name';
  cells[4] = f.lat ?? '10';
  cells[5] = f.lng ?? '20';
  cells[7] = f.code ?? 'PPL';
  cells[8] = f.iso ?? 'DE';
  cells[14] = String(f.pop ?? 20000);
  cells[16] = String(f.dem ?? 0);
  return cells.join('\t');
}

const build = (...lines: string[]): Record<string, number[]> =>
  buildPlaces(lines.join('\n'), 0).places;

// Value: protects=the flat five-number layout, rounding, population order and country order; fails_when=any of them changes;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces writes five numbers per place sorted by population and ISO code', () => {
  const places = build(
    line({ iso: 'FR', lat: '48.85661', lng: '2.35222', pop: 30000, dem: 35 }),
    line({ iso: 'DE', lat: '52.5', lng: '13.4', pop: 20000, dem: 34 }),
    line({ iso: 'DE', lat: '48.1', lng: '11.5', pop: 90000, dem: 519 }),
  );
  expect(Object.keys(places)).toEqual(['DE', 'FR']);
  expect(places['DE']).toEqual([48.1, 11.5, 90000, 519, 0, 52.5, 13.4, 20000, 34, 0]);
  expect(places['FR']).toEqual([48.857, 2.352, 30000, 35, 0]);
  expect(places['FR']?.length).toBe(PLACE_RECORD_LENGTH);
});

// Value: protects=capitals are flagged and kept below 15000 people while ordinary small places are dropped; fails_when=the capital exemption or flag is lost;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces flags capitals and keeps small ones', () => {
  const places = build(
    line({ code: 'PPLC', pop: 3000, lat: '1', lng: '1' }),
    line({ code: 'PPL', pop: 14999, lat: '2', lng: '2' }),
    line({ code: 'PPL', pop: 15000, lat: '3', lng: '3' }),
  );
  expect(places['DE']).toEqual([3, 3, 15000, 0, 0, 1, 1, 3000, 0, PLACE_FLAG_CAPITAL]);
});

// Value: protects=the PPLX district gets its flag; fails_when=the flag is not set or leaks to other codes;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces flags districts', () => {
  const places = build(
    line({ code: 'PPLX', pop: 50000, lat: '1', lng: '1' }),
    line({ code: 'PPLA', pop: 40000, lat: '2', lng: '2' }),
  );
  expect(places['DE']).toEqual([1, 1, 50000, 0, PLACE_FLAG_DISTRICT, 2, 2, 40000, 0, 0]);
});

// Value: protects=abandoned, destroyed and historical places are skipped; fails_when=a skipped feature code is allowed through;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces skips PPLH, PPLQ and PPLW', () => {
  const places = build(
    line({ code: 'PPLH' }),
    line({ code: 'PPLQ' }),
    line({ code: 'PPLW' }),
    line({ code: 'PPL', lat: '5', lng: '5' }),
  );
  expect(places['DE']).toEqual([5, 5, 20000, 0, 0]);
});

// Value: protects=blank coordinates never become 0,0; fails_when=the blank-text check is removed;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces skips a row with a blank latitude or longitude', () => {
  const places = build(
    line({ lat: '' }),
    line({ lng: '' }),
    line({ lat: '  ' }),
    line({ lat: '7', lng: '8' }),
  );
  expect(places['DE']).toEqual([7, 8, 20000, 0, 0]);
});

// Value: protects=out-of-range coordinates and bad country codes are skipped; fails_when=either guard is removed;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces skips out-of-range coordinates and a bad country code', () => {
  const places = build(
    line({ lat: '91' }),
    line({ lng: '-181' }),
    line({ lat: 'abc' }),
    line({ iso: '' }),
    line({ iso: 'DEU' }),
    line({ iso: 'fr', lat: '9', lng: '9' }),
  );
  expect(Object.keys(places)).toEqual(['FR']);
  expect(places['FR']).toEqual([9, 9, 20000, 0, 0]);
});

// Value: protects=elevation is read from the dem column and a blank dem becomes 0; fails_when=the wrong column is used;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces takes the elevation from the dem column', () => {
  const withElevation = line({ lat: '1', lng: '1', dem: 1234 }).split('\t');
  withElevation[15] = '77';
  const blankDem = line({ lat: '2', lng: '2' }).split('\t');
  blankDem[16] = '';
  const places = build(withElevation.join('\t'), blankDem.join('\t'));
  expect(places['DE']).toEqual([1, 1, 20000, 1234, 0, 2, 2, 20000, 0, 0]);
});

// Value: protects=a file with too few usable places is rejected; fails_when=the minimum check is removed;
// why_new=there was no places builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('buildPlaces throws when fewer places than expected are usable', () => {
  expect(() => buildPlaces(line({}), 2)).toThrow('1 usable places, expected at least 2');
  expect(() => buildPlaces(line({}))).toThrow('expected at least');
  expect(buildPlaces(line({}), 1).version).toBe(1);
});
