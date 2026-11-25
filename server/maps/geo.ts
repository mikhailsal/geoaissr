import { normalizeLongitude } from '../../shared/bot-tools.ts';
import type { LatLng } from '../../shared/score.ts';

const EARTH_RADIUS_KM = 6371;
/** Street View has nothing at the poles, and a probe exactly on one has no longitude. */
const MAX_PROBE_LAT = 89.9;

/**
 * The point at a distance and a compass bearing from an origin, along a great circle. The
 * longitude is wrapped into -180..180 and the latitude kept off the poles, so a probe near the
 * antimeridian or in the far north is still a valid coordinate.
 */
export function offsetPoint(origin: LatLng, distanceKm: number, bearingRad: number): LatLng {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const sinLat2 =
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRad);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  const lat = Math.max(-MAX_PROBE_LAT, Math.min(MAX_PROBE_LAT, (lat2 * 180) / Math.PI));
  return { lat, lng: normalizeLongitude((lng2 * 180) / Math.PI) };
}

/**
 * A random point within a radius of a centre. With `evenDistance` the distance is uniform, so
 * half of the points land within half the radius (close to the centre); otherwise the points
 * cover the disc evenly.
 */
export function randomPointAround(
  centre: LatLng,
  radiusKm: number,
  rng: () => number,
  evenDistance = false,
): LatLng {
  const share = rng();
  const distanceKm = radiusKm * (evenDistance ? share : Math.sqrt(share));
  return offsetPoint(centre, distanceKm, rng() * 2 * Math.PI);
}

const KM_PER_DEGREE = (EARTH_RADIUS_KM * Math.PI) / 180;

/**
 * Distance from a point to the segment between two points, in km. Flat maths around the point:
 * right for segments and distances of a few km, which is what an outline's edge is.
 */
export function distanceToSegmentKm(pos: LatLng, from: LatLng, to: LatLng): number {
  const kmPerLng = KM_PER_DEGREE * Math.cos((pos.lat * Math.PI) / 180);
  const ax = normalizeLongitude(from.lng - pos.lng) * kmPerLng;
  const ay = (from.lat - pos.lat) * KM_PER_DEGREE;
  const dx = normalizeLongitude(to.lng - from.lng) * kmPerLng;
  const dy = (to.lat - from.lat) * KM_PER_DEGREE;
  const lengthSq = dx * dx + dy * dy;
  const along = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
  return Math.hypot(ax + along * dx, ay + along * dy);
}
