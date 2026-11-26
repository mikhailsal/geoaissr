import { expect, test } from 'bun:test';
import {
  filterRegionOptions,
  listRegionOptions,
  normalizeSearch,
  type RegionOption,
} from './region-options';

function regions(options: readonly RegionOption[]): string[] {
  return options.map((option) => option.region);
}

// Value: protects=the picker lists only the countries the map can play, keeps every area (greyed
// when empty) and never drops the chosen region; fails_when=unplayable countries come back as
// rows, or a saved choice the map lost disappears from the list; why_new=the list was built in the
// template of a native select; seam=listRegionOptions (non-test caller: RegionPicker.svelte);
// no_claim=which countries a scan finds playable (the dataset decides).
test('lists the countries a map plays, every area, and always the chosen region', () => {
  const north = listRegionOptions('north', 'country:FIN');
  expect(regions(north).slice(0, 7)).toEqual([
    'world',
    'europe',
    'asia',
    'north_america',
    'south_america',
    'africa',
    'oceania',
  ]);
  expect(north.find((option) => option.region === 'africa')?.available).toBe(false);
  expect(north.find((option) => option.region === 'europe')?.available).toBe(true);
  expect(regions(north)).toContain('country:FIN');
  expect(regions(north)).not.toContain('country:BRA');
  expect(north.filter((option) => option.kind === 'country').every((o) => o.available)).toBe(true);

  const lost = listRegionOptions('north', 'country:BRA');
  expect(lost.find((option) => option.region === 'country:BRA')).toMatchObject({
    label: 'Бразилия',
    available: false,
  });
  // A country without Street View coverage is not offered on the standard map.
  const standard = regions(listRegionOptions('standard', 'world'));
  expect(standard).not.toContain('country:CHN');
  expect(standard).not.toContain('country:PRK');
  expect(standard).toContain('country:FRA');
});

// Value: protects=typing narrows the list by any part of a name, names and words that start with
// the text come first, case and «ё» do not matter; fails_when=a typed query misses a country or
// buries the obvious match; why_new=the native select had no text filter; seam=filterRegionOptions
// (non-test caller: RegionPicker.svelte); no_claim=keyboard handling in the browser (e2e).
test('filters by typed text: word starts first, case and «ё» ignored', () => {
  const make = (label: string): RegionOption => ({
    region: `country:${label}`,
    label,
    kind: 'country',
    available: true,
  });
  const options = ['Австралия', 'Южная Корея', 'Корейка', 'Скоре', 'Королёв'].map(make);
  const labels = (query: string): string[] =>
    filterRegionOptions(options, query).map((o) => o.label);
  expect(labels('')).toHaveLength(5);
  expect(labels('  ')).toHaveLength(5);
  expect(labels('кор')).toEqual(['Южная Корея', 'Корейка', 'Королёв', 'Скоре']);
  expect(labels('КОРОЛЕВ')).toEqual(['Королёв']);
  expect(labels('королё')).toEqual(['Королёв']);
  expect(labels('яя')).toEqual([]);
  expect(normalizeSearch('  Ёж ')).toBe('еж');
});
