import { isMapAvailable } from '../../shared/map-availability.ts';
import type { MapId } from '../../shared/maps.ts';
import type { RegionId } from '../../shared/region-ids.ts';
import { getCountryOfRegion, polygonsInRegion, sampleWeightedItem } from '../../shared/regions.ts';
import type { LatLng } from '../../shared/score.ts';
import type { RoundTarget } from '../engine/types.ts';
import { countryForIso, isPlaceInRegion, isoCodesOfCountryIds } from '../maps/countries.ts';
import { labelCountryIso } from '../maps/country-label.ts';
import { getCoveredCountries, isCountryCovered } from '../maps/coverage.ts';
import { NORTH_MIN_LAT, getNorthCountries } from '../maps/north.ts';
import { ALL_PLACES, placesOfIso } from '../maps/places.ts';
import { getRetroCountries } from '../maps/retro.ts';
import { seededRng } from '../maps/rng.ts';
import {
  getSourceGroups,
  isSourceMapId,
  type RoundSource,
  type SourceMapId,
} from '../maps/sources.ts';
import { EmptyMapRegionError, type LocationService, type RoundLocationRequest } from './service.ts';

interface FakeScene extends LatLng {
  panoId: string;
  iso: string;
  fakeSceneIndex: number;
}

/** Drawn scenes of the fake mode. The order matters: the first round of a match is Moscow. */
const FAKE_SCENES: readonly FakeScene[] = [
  { panoId: 'fake-moscow', lat: 55.7558, lng: 37.6173, iso: 'RU', fakeSceneIndex: 0 },
  { panoId: 'fake-paris', lat: 48.8566, lng: 2.3522, iso: 'FR', fakeSceneIndex: 1 },
  { panoId: 'fake-tokyo', lat: 35.6762, lng: 139.6503, iso: 'JP', fakeSceneIndex: 2 },
  { panoId: 'fake-rio', lat: -22.9068, lng: -43.1729, iso: 'BR', fakeSceneIndex: 3 },
  { panoId: 'fake-sydney', lat: -33.8688, lng: 151.2093, iso: 'AU', fakeSceneIndex: 4 },
  { panoId: 'fake-cairo', lat: 30.0444, lng: 31.2357, iso: 'EG', fakeSceneIndex: 5 },
  { panoId: 'fake-nyc', lat: 40.7128, lng: -74.006, iso: 'US', fakeSceneIndex: 6 },
];

function sceneAt(iso: string, pos: LatLng, round: number): FakeScene {
  return {
    panoId: `fake-${iso.toLowerCase()}-${round}`,
    lat: pos.lat,
    lng: pos.lng,
    iso,
    fakeSceneIndex: round % FAKE_SCENES.length,
  };
}

/** A country without a drawn scene plays at its largest known settlement. */
function scenesOfRegion(region: RegionId, round: number): FakeScene[] {
  const drawn = FAKE_SCENES.filter((scene) => isPlaceInRegion(scene.iso, scene, region));
  if (drawn.length > 0) return drawn;
  const country = getCountryOfRegion(region);
  if (!country) return [];
  const place = placesOfIso(country.iso)[0];
  if (place) return [sceneAt(country.iso, place, round)];
  const bbox = polygonsInRegion(country, region)[0]?.bbox ?? [0, 0, 0, 0];
  return [
    sceneAt(country.iso, { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 }, round),
  ];
}

/** Northern settlements of the region, largest first; a real point for every round. */
function northScenes(region: RegionId, round: number): FakeScene[] {
  if (getNorthCountries(region).length === 0) return [];
  const towns = ALL_PLACES.filter(
    (place) => place.lat >= NORTH_MIN_LAT && isPlaceInRegion(place.iso, place, region),
  ).sort((a, b) => b.population - a.population);
  if (towns.length > 0) return towns.slice(0, 12).map((place) => sceneAt(place.iso, place, round));
  const entry = getNorthCountries(region)[0];
  const bbox = entry?.polygons[0]?.bbox;
  if (!entry || !bbox) return [];
  const centre = { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 };
  return [sceneAt(entry.country.iso, centre, round)];
}

/** Drawn scenes of the retro countries, or the largest settlement of each of them. */
function retroScenes(region: RegionId, round: number): FakeScene[] {
  const countries = getRetroCountries(region);
  const ids = new Set(countries.map((entry) => entry.country.id));
  const drawn = FAKE_SCENES.filter(
    (scene) => ids.has(countryForIso(scene.iso).id) && isPlaceInRegion(scene.iso, scene, region),
  );
  if (drawn.length > 0) return drawn;
  return countries.flatMap((entry) => {
    const place = placesOfIso(entry.country.iso).find((p) => isPlaceInRegion(p.iso, p, region));
    return place ? [sceneAt(entry.country.iso, place, round)] : [];
  });
}

function pickUnplayed(scenes: readonly FakeScene[], played: ReadonlySet<string>, round: number) {
  return scenes.find((scene) => !played.has(scene.iso)) ?? scenes[round % scenes.length];
}

/**
 * Where a fake round of a source starts: its centre, or a probe of it when the centre lies
 * outside the source's own zone (the core of a city can stand just off its dense outline). The
 * probe is one the live map would label with the country of the source: the outline of Gisenyi
 * runs on into Goma, across the border.
 */
function fakePosition(source: RoundSource, rng: () => number): LatLng {
  if (source.accepts(source.centre)) return source.centre;
  for (let i = 0; i < 20; i += 1) {
    const probe = source.probe(rng);
    if (source.accepts(probe) && labelCountryIso(source, probe) === source.iso) return probe;
  }
  return source.centre;
}

/** A real place of a point map, picked the way the live service picks one, with a fixed seed. */
function sourceScene(
  map: SourceMapId,
  region: RegionId,
  played: ReadonlySet<string>,
  rng: () => number,
  round: number,
): FakeScene | undefined {
  const groups = getSourceGroups(map, region);
  if (groups.length === 0) return undefined;
  const open = groups.filter((group) => !played.has(group.iso));
  const group = sampleWeightedItem(open.length > 0 ? open : groups, rng);
  const source = sampleWeightedItem(group.sources, rng);
  return sceneAt(source.iso, fakePosition(source, rng), round);
}

function pickScene(
  input: RoundLocationRequest,
  rng: () => number,
  round: number,
): FakeScene | undefined {
  const played = isoCodesOfCountryIds(input.excludeCountryIds);
  if (isSourceMapId(input.map)) return sourceScene(input.map, input.region, played, rng, round);
  if (input.map === 'north') return pickUnplayed(northScenes(input.region, round), played, round);
  if (input.map === 'retro') return pickUnplayed(retroScenes(input.region, round), played, round);
  // The standard and wild maps keep to countries with Street View coverage, as the live maps do.
  if (!isMapAvailable(input.map, input.region)) return undefined;
  return coveredScene(input, played, round);
}

/** A scene of the standard or wild map: in a country with coverage, as on the live maps. */
function coveredScene(
  input: RoundLocationRequest,
  played: ReadonlySet<string>,
  round: number,
): FakeScene | undefined {
  const kinds = input.map === 'wild' ? (['open'] as const) : (['town', 'open'] as const);
  const isCovered = (id: string): boolean => kinds.some((kind) => isCountryCovered(id, kind));
  const drawn = scenesOfRegion(input.region, round).filter((scene) =>
    isCovered(countryForIso(scene.iso).id),
  );
  if (drawn.length > 0) return pickUnplayed(drawn, played, round);
  // No drawn scene in a covered country of the region: play at a settlement of one.
  for (const kind of kinds) {
    for (const { country } of getCoveredCountries(input.region, kind)) {
      const place = placesOfIso(country.iso)[0];
      if (place) return sceneAt(country.iso, place, round);
    }
  }
  return undefined;
}

function toTarget(scene: FakeScene, map: MapId, region: RegionId): RoundTarget {
  const country = countryForIso(scene.iso);
  return {
    panoId: scene.panoId,
    lat: scene.lat,
    lng: scene.lng,
    countryId: country.id,
    countryNameRu: country.nameRu,
    map,
    region,
    fakeSceneIndex: scene.fakeSceneIndex,
  };
}

/**
 * The location service of `--fake` mode: no network. Every map and region still gives a real
 * place of that map and region, so the lobby settings can be tried without Google keys.
 */
export function createFakeLocationService(): LocationService {
  const rng = seededRng(20261125);
  let round = 0;
  return {
    prepareRoundLocation(input) {
      const scene = pickScene(input, rng, round);
      round += 1;
      if (!scene) return Promise.reject(new EmptyMapRegionError(input.map, input.region));
      return Promise.resolve(toTarget(scene, input.map, input.region));
    },
    queryMetadata(lat, lng) {
      return Promise.resolve({
        status: 'OK',
        pano_id: 'fake-pano',
        copyright: '© Google',
        location: { lat, lng },
      });
    },
  };
}
