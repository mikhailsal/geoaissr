import { expect, test } from 'bun:test';
import { findCountryAtPoint } from '../shared/regions.ts';
import { GeoError } from './errors.ts';
import { createFakeLocationService, createLocationService } from './location.ts';
import { TOWN_ROUND_SHARE } from './location/service.ts';
import { panoAt, serviceWithDouble } from './location/test-helpers.ts';
import { placesNear, settlementRadiusKm } from './maps/places.ts';
import { SETTLEMENT_SNAP_RADIUS_M } from './maps/sources.ts';

test('location service filters out non-Google copyright photospheres and accepts official Google panos', async () => {
  let calls = 0;
  const svc = createLocationService({
    serverKey: 'test-key',
    rng: () => 0.42,
    fetchImpl: () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'OK',
              pano_id: 'user-sphere',
              copyright: '© John Doe Community',
              location: { lat: 48.85, lng: 2.35 },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'OK',
            pano_id: 'official-google-pano',
            copyright: '© 2026 Google',
            location: { lat: 48.8566, lng: 2.3522 },
          }),
          { status: 200 },
        ),
      );
    },
  });

  const target = await svc.prepareRoundLocation({
    map: 'wild',
    region: 'europe',
    excludeCountryIds: [],
  });
  expect(calls).toBe(2);
  expect(target.panoId).toBe('official-google-pano');
  expect(target.countryNameRu).toBe('Франция');
});

test('location service aborts immediately on REQUEST_DENIED without exhausting 90 attempts', async () => {
  let calls = 0;
  const svc = createLocationService({
    serverKey: 'bad-key',
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'API not activated' }),
          { status: 200 },
        ),
      );
    },
  });

  let thrown: unknown;
  try {
    await svc.prepareRoundLocation({ map: 'wild', region: 'world', excludeCountryIds: [] });
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(GeoError);
  expect((thrown as GeoError).code).toBe('GEO_GOOGLE_KEY_DENIED');
  expect(calls).toBe(1);
});

test('fake location service avoids excluded countries', async () => {
  const fake = createFakeLocationService();
  const r1 = await fake.prepareRoundLocation({
    map: 'standard',
    region: 'world',
    excludeCountryIds: [],
  });
  const r2 = await fake.prepareRoundLocation({
    map: 'standard',
    region: 'world',
    excludeCountryIds: [r1.countryId],
  });
  expect(r2.countryId).not.toBe(r1.countryId);
});

function okPano(id: string, lat: number, lng: number): Response {
  return new Response(
    JSON.stringify({ status: 'OK', pano_id: id, copyright: '© Google', location: { lat, lng } }),
    { status: 200 },
  );
}

test('location service resamples when the snapped pano lands in an excluded or off-region country', async () => {
  const france = findCountryAtPoint({ lat: 48.8566, lng: 2.3522 });
  expect(france).not.toBeNull();
  const answers = [
    okPano('paris', 48.8566, 2.3522), // excluded (already played)
    okPano('tokyo', 35.6762, 139.6503), // outside Europe
    okPano('berlin', 52.52, 13.405),
  ];
  let calls = 0;
  const svc = createLocationService({
    serverKey: 'test-key',
    rng: () => 0.42,
    fetchImpl: () => Promise.resolve(answers[Math.min(calls++, answers.length - 1)] as Response),
  });
  const target = await svc.prepareRoundLocation({
    map: 'wild',
    region: 'europe',
    excludeCountryIds: [france?.id ?? ''],
  });
  expect(calls).toBe(3);
  expect(target.panoId).toBe('berlin');
  expect(target.countryNameRu).toBe('Германия');
});

// The four tests above run on the wild map: it is the sampler they were written for.
test('the wild map keeps the old sampler: every lookup is a random point with a 5 km radius', async () => {
  const { svc, requests } = serviceWithDouble({ seed: 3 });
  for (let i = 0; i < 12; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'wild',
      region: 'world',
      excludeCountryIds: [],
    });
    expect(target.map).toBe('wild');
  }
  expect(requests.every((request) => request.radius === 5000)).toBe(true);
});

function isInSettlement(pos: { lat: number; lng: number }): boolean {
  return placesNear(pos, 40).some(
    (entry) => entry.km <= settlementRadiusKm(entry.place.population) + 1,
  );
}

// Value: protects=about half of the standard map's rounds start in a settlement and the rest on open land; fails_when=the town share is dropped, doubled or decided per attempt;
// why_new=the standard map had one sampler before; seam=none; no_claim=real Street View coverage (metadata double answers at the probe)
test('the standard map starts about half of its rounds in a settlement', async () => {
  const { svc } = serviceWithDouble({ seed: 11 });
  let inTown = 0;
  const rounds = 200;
  for (let i = 0; i < rounds; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'standard',
      region: 'world',
      excludeCountryIds: [],
    });
    if (isInSettlement(target)) inTown += 1;
  }
  expect(inTown / rounds).toBeGreaterThan(TOWN_ROUND_SHARE - 0.12);
  expect(inTown / rounds).toBeLessThan(TOWN_ROUND_SHARE + 0.12);
});

// Value: protects=a one-country region keeps every round of the standard map in that country; fails_when=the country region is ignored by the town or the land roll;
// why_new=regions were continents only; seam=none; no_claim=real Street View coverage (metadata double)
test('a one-country region keeps every standard round in that country', async () => {
  const { svc } = serviceWithDouble({ seed: 5 });
  const played: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    const target = await svc.prepareRoundLocation({
      map: 'standard',
      region: 'country:JPN',
      excludeCountryIds: played,
    });
    played.push(target.countryId);
    expect(target.countryId).toBe('JPN');
    expect(target.region).toBe('country:JPN');
    expect(target.lat).toBeGreaterThan(24);
    expect(target.lat).toBeLessThan(46);
  }
});

// Value: protects=a town round is rejected when the panorama is outside the town's built-up radius; fails_when=the town roll accepts any panorama Google snaps to;
// why_new=the town roll is new; seam=none; no_claim=real Street View coverage (metadata double)
test('a town round drops a panorama that is far from the town', async () => {
  // The first two answers are about 33 km north of the probe: outside any settlement radius.
  const { svc, requests } = serviceWithDouble({
    seed: 7,
    answer: (probe, lookup) =>
      lookup <= 2 ? panoAt({ lat: probe.lat + 0.3, lng: probe.lng }) : panoAt(probe),
  });
  const target = await svc.prepareRoundLocation({
    map: 'standard',
    region: 'country:FRA',
    excludeCountryIds: [],
  });
  // The first draw of seed 7 decides for a town round, so the search radius is the settlement one.
  expect(requests[0]?.radius).toBe(SETTLEMENT_SNAP_RADIUS_M);
  expect(requests.length).toBe(3);
  expect(isInSettlement(target)).toBe(true);
});
