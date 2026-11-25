import type { LatLng } from '../../shared/score.ts';
import { seededRng } from '../maps/rng.ts';
import { createLocationService, type LocationService } from './service.ts';

/** What the Street View metadata double answers for one lookup; a thrown error is a dead network. */
export type MetadataAnswer = (probe: LatLng, lookup: number) => Record<string, unknown>;

export function panoAt(pos: LatLng, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'OK',
    pano_id: `pano-${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}`,
    copyright: '© Google',
    location: { lat: pos.lat, lng: pos.lng },
    ...extra,
  };
}

/**
 * A location service over a metadata double. By default every lookup finds a panorama exactly
 * at the probe, so a round is found at the first attempt and shows where the sampler aimed.
 */
export function serviceWithDouble(
  opts: {
    seed?: number;
    answer?: MetadataAnswer;
  } = {},
): { svc: LocationService; requests: { probe: LatLng; radius: number }[] } {
  const requests: { probe: LatLng; radius: number }[] = [];
  const answer = opts.answer ?? ((probe) => panoAt(probe));
  const svc = createLocationService({
    serverKey: 'test-key',
    rng: seededRng(opts.seed ?? 1),
    fetchImpl: (url) => {
      const params = new URL(url).searchParams;
      const [lat = 0, lng = 0] = (params.get('location') ?? '').split(',').map(Number);
      const probe = { lat, lng };
      requests.push({ probe, radius: Number(params.get('radius')) });
      const body = answer(probe, requests.length);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    },
  });
  return { svc, requests };
}
