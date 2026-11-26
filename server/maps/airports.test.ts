import { expect, test } from 'bun:test';
import { haversineDistanceKm } from '../../shared/score.ts';
import { createLocationService } from '../location.ts';
import { AIRPORTS_BY_ISO, AIRPORT_SNAP_RADIUS_M, AIRPORT_ZONE_KM } from './airports.ts';
import { countryForIso, isoCodesOfCountryIds } from './countries.ts';
import { seededRng as mulberry32 } from './rng.ts';
import { getSourceGroups } from './sources.ts';

/** The airports of the whole world, grouped by country. */
function airportGroups() {
  return getSourceGroups('airports', 'world');
}

function nearestAirportKm(pos: { lat: number; lng: number }): number {
  let best = Infinity;
  for (const group of airportGroups()) {
    for (const airport of group.sources) {
      best = Math.min(best, haversineDistanceKm(pos, airport.centre));
    }
  }
  return best;
}

test('airports dataset holds valid coordinates for more than 3000 airports', () => {
  const groups = airportGroups();
  const all = groups.flatMap((group) => group.sources.map((airport) => airport.centre));
  expect(Object.values(AIRPORTS_BY_ISO).flat().length).toBeGreaterThan(3000);
  // The map leaves out the airports of countries without any Street View coverage.
  expect(all.length).toBeGreaterThan(2500);
  expect(groups.some((group) => group.iso === 'CN')).toBe(false);
  expect(groups.some((group) => group.iso === 'HK')).toBe(true);
  expect(groups.every((group) => /^[A-Z]{2}$/.test(group.iso))).toBe(true);
  expect(all.every(({ lat, lng }) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180)).toBe(true);
});

test('country weights grow slower than the airport count', () => {
  const groups = airportGroups();
  const total = groups.reduce((sum, group) => sum + group.weight, 0);
  const usa = groups.find((group) => group.iso === 'US');
  expect(usa).toBeDefined();
  expect((usa?.weight ?? total) / total).toBeLessThan(0.08);
});

test('countries already played are skipped, unless nothing else is left', async () => {
  const played = isoCodesOfCountryIds(['USA', 'iso:SG']);
  expect([...played].sort()).toEqual(['SG', 'US']);
  const { svc } = metadataService(0, 17);
  for (let i = 0; i < 40; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'airports',
      region: 'world',
      excludeCountryIds: ['USA', 'iso:SG'],
    });
    expect(['USA', 'iso:SG']).not.toContain(target.countryId);
  }
  const everything = airportGroups().map((group) => countryForIso(group.iso).id);
  const target = await svc.prepareRoundLocation({
    map: 'airports',
    region: 'world',
    excludeCountryIds: everything,
  });
  expect(everything).toContain(target.countryId);
});

test('probes stay inside the airport zone and lean towards the airport', () => {
  const rng = mulberry32(7);
  const airports = airportGroups().flatMap((group) => group.sources);
  let near = 0;
  for (let i = 0; i < 400; i += 1) {
    const airport = airports[Math.floor(rng() * airports.length)];
    if (!airport) throw new Error('no airport');
    const distance = haversineDistanceKm(airport.centre, airport.probe(rng));
    expect(distance).toBeLessThanOrEqual(AIRPORT_ZONE_KM * 1.01);
    if (distance <= AIRPORT_ZONE_KM / 2) near += 1;
  }
  expect(near).toBeGreaterThan(160);
  const any = airports[0];
  // About 5.6 km north of the airport: outside its zone.
  expect(any?.accepts({ lat: any.centre.lat + 0.05, lng: any.centre.lng })).toBe(false);
});

test('a round takes its country from the airport, with the regions id when the regions know it', () => {
  expect(countryForIso('DK')).toEqual({ id: 'DNK', nameRu: 'Дания' });
  // Singapore has no polygon in the regions dataset.
  expect(countryForIso('SG')).toEqual({ id: 'iso:SG', nameRu: 'Сингапур' });
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
  const played = airportGroups()
    .filter((group) => group.iso !== 'SG')
    .map((group) => countryForIso(group.iso).id);
  const { svc, requests } = metadataService(0, 3);

  const target = await svc.prepareRoundLocation({
    map: 'airports',
    region: 'world',
    excludeCountryIds: played,
  });
  expect(requests.length).toBe(1);
  expect(target.countryId).toBe('iso:SG');
  expect(target.countryNameRu).toBe('Сингапур');
});

test('airports map gives up after 90 lookups when no panorama is inside a zone', async () => {
  // Every answer is about 33 km north of the probe.
  const { svc, requests } = metadataService(0.3, 5);

  const outcome = await svc
    .prepareRoundLocation({ map: 'airports', region: 'world', excludeCountryIds: [] })
    .then(
      () => 'resolved',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
  expect(outcome).toContain('карта «Аэропорты мира», регион «Весь мир», 90 попыток');
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

  const target = await svc.prepareRoundLocation({
    map: 'airports',
    region: 'world',
    excludeCountryIds: [],
  });
  expect(requests.length).toBe(2);
  expect(requests[0]?.get('radius')).toBe(String(AIRPORT_SNAP_RADIUS_M));
  expect(target.panoId).toBe('pano-2');
  expect(target.map).toBe('airports');
  expect(target.region).toBe('world');
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

  const err = await svc
    .prepareRoundLocation({ map: 'airports', region: 'world', excludeCountryIds: [] })
    .then(
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

  const target = await svc.prepareRoundLocation({
    map: 'airports',
    region: 'world',
    excludeCountryIds: [],
  });
  expect(calls()).toBe(4);
  expect(target.panoId).toBe('pano-4');
  expect(nearestAirportKm(target)).toBeLessThanOrEqual(AIRPORT_ZONE_KM);
});
