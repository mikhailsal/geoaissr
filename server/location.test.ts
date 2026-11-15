import { expect, test } from 'bun:test';
import { findCountryAtPoint } from '../shared/regions.ts';
import { GeoError } from './errors.ts';
import { createFakeLocationService, createLocationService } from './location.ts';

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

  const target = await svc.prepareRoundLocation({ region: 'europe', excludeCountryIds: [] });
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
    await svc.prepareRoundLocation({ region: 'world', excludeCountryIds: [] });
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(GeoError);
  expect((thrown as GeoError).code).toBe('GEO_GOOGLE_KEY_DENIED');
  expect(calls).toBe(1);
});

test('fake location service avoids excluded countries', async () => {
  const fake = createFakeLocationService();
  const r1 = await fake.prepareRoundLocation({ region: 'world', excludeCountryIds: [] });
  const r2 = await fake.prepareRoundLocation({
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
    region: 'europe',
    excludeCountryIds: [france?.id ?? ''],
  });
  expect(calls).toBe(3);
  expect(target.panoId).toBe('berlin');
  expect(target.countryNameRu).toBe('Германия');
});
