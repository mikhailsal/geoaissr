import { haversineDistanceKm, type LatLng } from '../../shared/score.ts';
import rawData from './places.data.json' with { type: 'json' };
import {
  PLACE_FLAG_CAPITAL,
  PLACE_FLAG_DISTRICT,
  PLACE_RECORD_LENGTH,
  type PlacesDataset,
} from './places-format.ts';

/** A settlement of 15 thousand people or more (GeoNames), or a smaller national capital. */
export interface Place extends LatLng {
  iso: string;
  population: number;
  /** Metres above sea level. */
  elevation: number;
  capital: boolean;
  /** A named part of a bigger place (a borough), not a city of its own. */
  district: boolean;
}

function unpackPlaces(dataset: PlacesDataset): Map<string, Place[]> {
  const byIso = new Map<string, Place[]>();
  for (const [iso, flat] of Object.entries(dataset.places)) {
    const list: Place[] = [];
    for (let i = 0; i + PLACE_RECORD_LENGTH <= flat.length; i += PLACE_RECORD_LENGTH) {
      const flags = flat[i + 4] ?? 0;
      list.push({
        iso,
        lat: flat[i] ?? 0,
        lng: flat[i + 1] ?? 0,
        population: flat[i + 2] ?? 0,
        elevation: flat[i + 3] ?? 0,
        capital: (flags & PLACE_FLAG_CAPITAL) !== 0,
        district: (flags & PLACE_FLAG_DISTRICT) !== 0,
      });
    }
    byIso.set(iso, list);
  }
  return byIso;
}

const PLACES_BY_ISO = unpackPlaces(rawData as PlacesDataset);
export const ALL_PLACES: readonly Place[] = [...PLACES_BY_ISO.values()].flat();

/** Places of one country, largest first. */
export function placesOfIso(iso: string): readonly Place[] {
  return PLACES_BY_ISO.get(iso) ?? [];
}

export function placeIsoCodes(): string[] {
  return [...PLACES_BY_ISO.keys()];
}

/**
 * How far the built-up area of a settlement reaches from its centre, in km. Fitted to the
 * outlines of the urban centres dataset: about 1 km for 15 thousand people, 2.6 km for
 * 100 thousand, 7 km for a million, 19 km for ten million.
 */
export function settlementRadiusKm(population: number): number {
  return 0.0174 * Math.pow(Math.max(1000, population), 0.435);
}

const CELL_DEG = 1;
const grid = new Map<string, Place[]>();
for (const place of ALL_PLACES) {
  const key = `${Math.floor(place.lat / CELL_DEG)}:${Math.floor(place.lng / CELL_DEG)}`;
  const cell = grid.get(key);
  if (cell) cell.push(place);
  else grid.set(key, [place]);
}

/** Every place within `maxKm` of a point, nearest first. */
export function placesNear(pos: LatLng, maxKm: number): { place: Place; km: number }[] {
  const latCells = Math.ceil(maxKm / 111) + 1;
  const cosLat = Math.max(0.05, Math.cos((pos.lat * Math.PI) / 180));
  const lngCells = Math.min(180, Math.ceil(maxKm / (111 * cosLat)) + 1);
  const latCell = Math.floor(pos.lat / CELL_DEG);
  const lngCell = Math.floor(pos.lng / CELL_DEG);
  const found: { place: Place; km: number }[] = [];
  for (let dLat = -latCells; dLat <= latCells; dLat += 1) {
    for (let dLng = -lngCells; dLng <= lngCells; dLng += 1) {
      // Longitude cells wrap around the antimeridian: -180..179.
      const wrapped = ((((lngCell + dLng + 180) % 360) + 360) % 360) - 180;
      for (const place of grid.get(`${latCell + dLat}:${wrapped}`) ?? []) {
        const km = haversineDistanceKm(pos, place);
        if (km <= maxKm) found.push({ place, km });
      }
    }
  }
  return found.sort((a, b) => a.km - b.km);
}
