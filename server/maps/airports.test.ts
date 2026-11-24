import { expect, test } from 'bun:test';
import { haversineDistanceKm } from '../../shared/score.ts';
import { createLocationService } from '../location.ts';
import {
  AIRPORT_SNAP_RADIUS_M,
  AIRPORT_ZONE_KM,
  airportCountryNameRu,
  getAirportCountryGroups,
  isInsideAirportZone,
  isoCodesOfCountryIds,
  sampleAirportProbe,
} from './airports.ts';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nearestAirportKm(pos: { lat: number; lng: number }): number {
  let best = Infinity;
  for (const group of getAirportCountryGroups()) {
    for (const [lat, lng] of group.airports) {
      best = Math.min(best, haversineDistanceKm(pos, { lat, lng }));
    }
  }
  return best;
}

test('airports dataset holds valid coordinates for more than 3000 airports', () => {
  const groups = getAirportCountryGroups();
  const all = groups.flatMap((group) => group.airports);
  expect(all.length).toBeGreaterThan(3000);
  expect(groups.every((group) => /^[A-Z]{2}$/.test(group.iso))).toBe(true);
  expect(all.every(([lat, lng]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180)).toBe(true);
});

test('country weights grow slower than the airport count', () => {
  const groups = getAirportCountryGroups();
  const total = groups.reduce((sum, group) => sum + group.weight, 0);
  const usa = groups.find((group) => group.iso === 'US');
  expect(usa).toBeDefined();
  expect((usa?.weight ?? total) / total).toBeLessThan(0.08);
});

test('countries already played are skipped, unless nothing else is left', () => {
  const played = isoCodesOfCountryIds(['USA', 'iso:SG']);
  expect([...played].sort()).toEqual(['SG', 'US']);
  const groups = getAirportCountryGroups(played);
  expect(groups.some((group) => group.iso === 'US' || group.iso === 'SG')).toBe(false);
  const everything = new Set(getAirportCountryGroups().map((group) => group.iso));
  expect(getAirportCountryGroups(everything).length).toBe(everything.size);
});

test('probes stay inside the airport zone and lean towards the airport', () => {
  const rng = mulberry32(7);
  const groups = getAirportCountryGroups();
  let near = 0;
  for (let i = 0; i < 400; i += 1) {
    const pick = sampleAirportProbe(groups, rng);
    const distance = haversineDistanceKm(pick.airport, pick.probe);
    expect(distance).toBeLessThanOrEqual(AIRPORT_ZONE_KM * 1.01);
    if (distance <= AIRPORT_ZONE_KM / 2) near += 1;
  }
  expect(near).toBeGreaterThan(160);
  expect(isInsideAirportZone({ lat: 0, lng: 0 }, { lat: 0.05, lng: 0 })).toBe(false);
});

test('a country without a polygon gets its Russian name from the ISO code', () => {
  expect(airportCountryNameRu('SG')).toBe('Сингапур');
});

test('airports map rejects a panorama outside the zone and accepts one inside it', async () => {
  const requests: URLSearchParams[] = [];
  const svc = createLocationService({
    serverKey: 'test-key',
    rng: mulberry32(11),
    fetchImpl: (url) => {
      const params = new URL(url).searchParams;
      requests.push(params);
      const [lat = 0, lng = 0] = (params.get('location') ?? '').split(',').map(Number);
      // The first answer snaps about 33 km north of the probe: outside any 5 km zone around it.
      const location = requests.length === 1 ? { lat: lat + 0.3, lng } : { lat, lng };
      const body = {
        status: 'OK',
        pano_id: `pano-${requests.length}`,
        copyright: '© Google',
        location,
      };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    },
  });

  const target = await svc.prepareRoundLocation({ region: 'airports', excludeCountryIds: [] });
  expect(requests.length).toBe(2);
  expect(requests[0]?.get('radius')).toBe(String(AIRPORT_SNAP_RADIUS_M));
  expect(target.panoId).toBe('pano-2');
  expect(target.region).toBe('airports');
  expect(target.countryNameRu.length).toBeGreaterThan(0);
  expect(nearestAirportKm(target)).toBeLessThanOrEqual(AIRPORT_ZONE_KM);
});
