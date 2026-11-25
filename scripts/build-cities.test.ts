import { expect, test } from 'bun:test';
import { decodeRing, encodeRing } from '../server/maps/cities-format.ts';
import { PLACE_FLAG_DISTRICT, type PlacesDataset } from '../server/maps/places-format.ts';
import {
  MIN_CENTRE_POPULATION,
  MIN_CORE_POPULATION,
  buildCities,
  flattenPlaces,
  type UrbanCentreInput,
} from './build-cities.ts';

type LngLat = [number, number];

/** A closed square ring of `size` degrees whose south-west corner is at lng, lat. */
function square(lng: number, lat: number, size = 0.1): LngLat[] {
  return [
    [lng, lat],
    [lng + size, lat],
    [lng + size, lat + size],
    [lng, lat + size],
    [lng, lat],
  ];
}

function centre(name: string, population: number, lng = 10, lat = 50): UrbanCentreInput {
  return { name, population, rings: [square(lng, lat)] };
}

/** One place record: latitude, longitude, population, elevation, flags. */
function dataset(places: Record<string, number[]>): PlacesDataset {
  return { version: 1, source: 'test', places };
}

const place = (lat: number, lng: number, pop: number, flags = 0): number[] => [
  lat,
  lng,
  pop,
  0,
  flags,
];

const run = (centres: UrbanCentreInput[], places: Record<string, number[]>) =>
  buildCities(centres, flattenPlaces(dataset(places)), 0);

// Value: protects=flattenPlaces unpacks the flat list with the district flag; fails_when=the record stride or flag bit changes;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GeoNames data (inline fixture)
test('flattenPlaces unpacks records and the district flag', () => {
  const flat = flattenPlaces(
    dataset({
      DE: [...place(1, 2, 300), ...place(3, 4, 500, PLACE_FLAG_DISTRICT)],
      FR: place(5, 6, 700, 1),
    }),
  );
  expect(flat).toEqual([
    { iso: 'DE', lat: 1, lng: 2, population: 300, district: false },
    { iso: 'DE', lat: 3, lng: 4, population: 500, district: true },
    { iso: 'FR', lat: 5, lng: 6, population: 700, district: false },
  ]);
});

// Value: protects=a big centre with a core city is kept with iso, core and rounded population; fails_when=the core data comes from the wrong place or pop is not rounded;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities keeps a centre with a core city inside', () => {
  const { dataset: out, stats } = run([centre('Alpha', 812_499)], {
    DE: place(50.05, 10.05, 400_000),
  });
  expect(out.centres).toHaveLength(1);
  const record = out.centres[0];
  expect(record?.iso).toBe('DE');
  expect(record?.core).toEqual([50.05, 10.05]);
  expect(record?.pop).toBe(812_000);
  expect(record?.rings).toEqual([encodeRing(square(10, 50))]);
  expect(stats).toEqual({ considered: 1, kept: 1, droppedNoCity: 0, droppedNoCoverage: 0 });
});

// Value: protects=a centre under 500 thousand is not considered at all; fails_when=the population threshold is lowered;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities ignores a centre under the population threshold', () => {
  const { dataset: out, stats } = run([centre('Small', MIN_CENTRE_POPULATION - 1)], {
    DE: place(50.05, 10.05, 400_000),
  });
  expect(out.centres).toEqual([]);
  expect(stats.considered).toBe(0);
  expect(stats.droppedNoCity).toBe(0);
});

// Value: protects=a centre whose largest place is small, or that has no place, is dropped and counted; fails_when=the core population floor is removed;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities drops a centre without a big enough core city', () => {
  const small = run([centre('Rural', 900_000)], {
    IN: place(50.05, 10.05, MIN_CORE_POPULATION - 1),
  });
  expect(small.dataset.centres).toEqual([]);
  expect(small.stats).toMatchObject({ considered: 1, droppedNoCity: 1 });
  const none = run([centre('Empty', 900_000)], { IN: place(10, 10, 900_000) });
  expect(none.stats).toMatchObject({ considered: 1, droppedNoCity: 1, kept: 0 });
  const exact = run([centre('Edge', 900_000)], { DE: place(50.05, 10.05, MIN_CORE_POPULATION) });
  expect(exact.stats.kept).toBe(1);
});

// Value: protects=centres whose core city is in a no-coverage country are dropped and counted separately; fails_when=the coverage filter is removed;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities drops a centre whose core is in a country without coverage', () => {
  const { dataset: out, stats } = run([centre('Chinese', 900_000)], {
    CN: place(50.05, 10.05, 5_000_000),
  });
  expect(out.centres).toEqual([]);
  expect(stats).toMatchObject({ considered: 1, droppedNoCoverage: 1, droppedNoCity: 0 });
});

// Value: protects=a city of its own beats a bigger borough as the core; fails_when=the district preference is removed;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities prefers a non-district place over a bigger district', () => {
  const { dataset: out } = run([centre('Alpha', 900_000)], {
    DE: [
      ...place(50.02, 10.02, 2_000_000, PLACE_FLAG_DISTRICT),
      ...place(50.08, 10.08, 300_000),
      ...place(50.04, 10.04, 200_000),
    ],
  });
  expect(out.centres[0]?.core).toEqual([50.08, 10.08]);
});

// Value: protects=a place about 1 km outside the ring counts as core and one 20 km away does not; fails_when=the margin is removed or widened a lot;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities counts a place just outside the ring but not a far one', () => {
  const near = run([centre('Near', 900_000)], { DE: place(49.99, 9.99, 400_000) });
  expect(near.stats.kept).toBe(1);
  const far = run([centre('Far', 900_000)], { DE: place(50.3, 10.3, 400_000) });
  expect(far.stats).toMatchObject({ kept: 0, droppedNoCity: 1 });
});

// Value: protects=output is sorted by population, largest first; fails_when=the sort is removed or reversed;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities sorts centres by population descending', () => {
  const { dataset: out } = run(
    [
      centre('Mid', 700_000, 10, 50),
      centre('Big', 3_000_000, 20, 40),
      centre('Low', 600_000, 30, 30),
    ],
    {
      DE: [...place(50.05, 10.05, 300_000), ...place(40.05, 20.05, 900_000)],
      FR: place(30.05, 30.05, 200_000),
    },
  );
  expect(out.centres.map((c) => c.name)).toEqual(['Big', 'Mid', 'Low']);
});

// Value: protects=too few kept centres is an error; fails_when=the minimum check is removed;
// why_new=there was no cities builder test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('buildCities throws when fewer centres than expected are kept', () => {
  const places = flattenPlaces(dataset({ DE: place(50.05, 10.05, 400_000) }));
  expect(() => buildCities([centre('Alpha', 900_000)], places, 2)).toThrow(
    'Only 1 urban centres were kept, expected at least 2',
  );
  expect(() => buildCities([centre('Alpha', 900_000)], places)).toThrow('expected at least');
});

// Value: protects=ring packing round-trips to 3 decimals, drops repeats after rounding and holds integers only; fails_when=the scale, delta coding or de-duplication changes;
// why_new=there was no ring codec test at all; seam=none; no_claim=real GHSL data (inline fixture)
test('encodeRing and decodeRing round trip with integers only', () => {
  const ring: LngLat[] = [
    [10.1234, 50.5678],
    [10.12341, 50.56779],
    [10.2, 50.5],
    [-1.0004, -0.6],
    [10.1234, 50.5678],
  ];
  const flat = encodeRing(ring);
  expect(flat.every((n) => Number.isInteger(n))).toBe(true);
  expect(flat).toEqual([10123, 50568, 77, -68, -11200, -51100, 11123, 51168]);
  expect(decodeRing(flat)).toEqual([
    [10.123, 50.568],
    [10.2, 50.5],
    [-1, -0.6],
    [10.123, 50.568],
  ]);
});
