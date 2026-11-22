import type { LocationService } from '../../server/location.ts';
import { destinationPoint, type PanoPoint } from '../../server/bots/road-walk.ts';
import { haversineDistanceKm } from '../../shared/score.ts';

/**
 * Test fixture: a road network made of panorama points, answered the way the Street View
 * metadata endpoint answers — the panorama nearest to the asked point, within the radius.
 */

export const ORIGIN = { lat: 50, lng: 10 };

/** Panoramas every `spacingM` along a bearing, starting `spacingM` after `from`. */
export function leg(
  prefix: string,
  from: { lat: number; lng: number },
  headingDeg: number,
  lengthM: number,
  spacingM: number,
): PanoPoint[] {
  const points: PanoPoint[] = [];
  for (let d = spacingM; d <= lengthM + 0.001; d += spacingM) {
    const p = destinationPoint(from.lat, from.lng, headingDeg, d / 1000);
    points.push({ panoId: `${prefix}${points.length + 1}`, lat: p.lat, lng: p.lng });
  }
  return points;
}

/** The start panorama of every fixture road. */
export const START: PanoPoint = { panoId: 'start', ...ORIGIN };

export interface FixtureRoad {
  service: LocationService;
  /** Every metadata lookup made, in order. */
  calls: Array<{ lat: number; lng: number; radius: number }>;
}

export function roadService(
  panos: readonly PanoPoint[],
  opts: { foreign?: ReadonlySet<string> } = {},
): FixtureRoad {
  const calls: FixtureRoad['calls'] = [];
  const service: LocationService = {
    prepareRoundLocation: () => Promise.reject(new Error('not used by the walk')),
    queryMetadata: (lat, lng, radius = 5000) => {
      calls.push({ lat, lng, radius });
      let best: PanoPoint | null = null;
      let bestM = Infinity;
      for (const pano of panos) {
        const m = haversineDistanceKm({ lat, lng }, pano) * 1000;
        if (m <= radius && m < bestM) {
          best = pano;
          bestM = m;
        }
      }
      if (!best) return Promise.resolve({ status: 'ZERO_RESULTS' });
      return Promise.resolve({
        status: 'OK',
        pano_id: best.panoId,
        location: { lat: best.lat, lng: best.lng },
        copyright: opts.foreign?.has(best.panoId) ? '© A contributor' : '© Google',
      });
    },
  };
  return { service, calls };
}
