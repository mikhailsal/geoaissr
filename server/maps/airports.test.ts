import { expect, test } from 'bun:test';
import { haversineDistanceKm } from '../../shared/score.ts';
import { createLocationService } from '../location.ts';
import {
  AIRPORT_SNAP_RADIUS_M,
  AIRPORT_ZONE_KM,
  airportCountry,
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

test('a round takes its country from the airport, with the regions id when the regions know it', () => {
  expect(airportCountry('DK')).toEqual({ id: 'DNK', nameRu: 'Дания' });
  // Singapore has no polygon in the regions dataset.
  expect(airportCountry('SG')).toEqual({ id: 'iso:SG', nameRu: 'Сингапур' });
});

/** Street View metadata double: answers every lookup with a panorama `shiftLat` degrees north. */
function metadataService(shiftLat: number, seed: number) {
  const requests: URLSearchParams[] = [];
  const svc = createLocationService({
    serverKey: 'test-key',
    rng: mulberry32(seed),
    fetchImpl: (url) => {
      const params = new URL(url).searchParams;
      requests.push(params);
      const [lat = 0, lng = 0] = (params.get('location') ?? '').split(',').map(Number);
      const body = {
        status: 'OK',
        pano_id: `pano-${requests.length}`,
        copyright: '© Google',
        location: { lat: lat + shiftLat, lng },
      };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    },
  });
  return { svc, requests };
}

test('an airport in a country without a polygon is not named after a played neighbour', async () => {
  // Every country but Singapore is played, Malaysia among them. The nearest polygon to a
  // Singapore panorama is Malaysia's.
  const played = getAirportCountryGroups()
    .filter((group) => group.iso !== 'SG')
    .map((group) => airportCountry(group.iso).id);
  const { svc, requests } = metadataService(0, 3);

  const target = await svc.prepareRoundLocation({ region: 'airports', excludeCountryIds: played });
  expect(requests.length).toBe(1);
  expect(target.countryId).toBe('iso:SG');
  expect(target.countryNameRu).toBe('Сингапур');
});

test('airports map gives up after 90 lookups when no panorama is inside a zone', async () => {
  // Every answer is about 33 km north of the probe.
  const { svc, requests } = metadataService(0.3, 5);

  const outcome = await svc
    .prepareRoundLocation({ region: 'airports', excludeCountryIds: [] })
    .then(
      () => 'resolved',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
  expect(outcome).toContain('рядом с аэропортом за 90 попыток');
  expect(requests.length).toBe(90);
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

/** Street View metadata double that answers lookup number n with `answers[n]`, then echoes the probe. */
function scriptedService(answers: ((probe: { lat: number; lng: number }) => Response)[]) {
  let calls = 0;
  const svc = createLocationService({
    serverKey: 'test-key',
    rng: mulberry32(13),
    fetchImpl: (url) => {
      const [lat = 0, lng = 0] = (new URL(url).searchParams.get('location') ?? '')
        .split(',')
        .map(Number);
      const answer = answers[calls];
      calls += 1;
      if (answer) return Promise.resolve(answer({ lat, lng }));
      const body = {
        status: 'OK',
        pano_id: `pano-${calls}`,
        copyright: '© Google',
        location: { lat, lng },
      };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    },
  });
  return { svc, calls: () => calls };
}

// Value: protects=a Google key or quota error fails the airports round at once with its code; fails_when=the GeoError is swallowed and the loop retries;
// why_new=existing airports tests only cover answers that parse; seam=none; no_claim=real Google responses (fetch double; unit only)
test('airports map fails the round with the GeoError of a denied lookup instead of retrying', async () => {
  const { svc, calls } = scriptedService([() => new Response('denied', { status: 403 })]);

  const err = await svc.prepareRoundLocation({ region: 'airports', excludeCountryIds: [] }).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  expect((err as { code?: string }).code).toBe('GEO_GOOGLE_KEY_DENIED');
  expect(calls()).toBe(1);
});

// Value: protects=a failed lookup or a ZERO_RESULTS answer costs one attempt and the next valid answer is accepted; fails_when=such a failure aborts the round or is accepted;
// why_new=the existing tests never make a lookup throw or return an invalid payload; seam=none; no_claim=real Google responses (fetch double; unit only)
test('airports map skips a failed lookup and a ZERO_RESULTS answer, then accepts a valid one', async () => {
  const fail = (): Response => {
    throw new Error('network down');
  };
  const zero = (): Response =>
    new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), { status: 200 });
  // The first attempt burns both fetch tries of the retry wrapper.
  const { svc, calls } = scriptedService([fail, fail, zero]);

  const target = await svc.prepareRoundLocation({ region: 'airports', excludeCountryIds: [] });
  expect(calls()).toBe(4);
  expect(target.panoId).toBe('pano-4');
  expect(nearestAirportKm(target)).toBeLessThanOrEqual(AIRPORT_ZONE_KM);
});
