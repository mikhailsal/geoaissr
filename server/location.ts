/** Finds the place a round starts at. The parts live in `server/location/`. */
export { createFakeLocationService } from './location/fake.ts';
export type { FetchLike } from './location/metadata.ts';
export {
  EmptyMapRegionError,
  createLocationService,
  type LocationService,
  type RoundLocationRequest,
} from './location/service.ts';
