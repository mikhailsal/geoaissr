import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';
import { placesNear } from './places.ts';

/** A settlement of another country must be this close to a panorama to claim it. */
const BORDER_PLACE_KM = 3;
/** ...and this much closer than anything of the place's own country. */
const CLEARLY_CLOSER = 0.6;

/**
 * The country of a panorama found around a known place. It is the place's own country, unless a
 * settlement of another country is clearly closer: an airport on a border (Gibraltar and
 * La Línea) or a city that grew across one (Lille and Mouscron). The answer is an ISO code.
 */
export function labelCountryIso(place: { iso: string; centre: LatLng }, pano: LatLng): string {
  const near = placesNear(pano, BORDER_PLACE_KM);
  const nearest = near[0];
  if (!nearest || nearest.place.iso === place.iso) return place.iso;
  const ownPlaceKm = near.find((entry) => entry.place.iso === place.iso)?.km ?? Infinity;
  const ownKm = Math.min(ownPlaceKm, haversineDistanceKm(place.centre, pano));
  return nearest.km <= CLEARLY_CLOSER * ownKm ? nearest.place.iso : place.iso;
}
