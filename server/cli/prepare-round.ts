import type { MapId } from '../../shared/maps.ts';
import type { RegionId } from '../../shared/region-ids.ts';
import type { RoomState, RoundTarget } from '../engine/types.ts';
import type { LocationService } from '../location.ts';

export interface PrepareRoundRequest {
  matchId: string;
  gen: number;
  roundNumber: number;
  map: MapId;
  region: RegionId;
  excludeCountryIds: string[];
  withBots: boolean;
}

/**
 * Finds the place of a round and, for a round with bots, fetches their start frames. The search
 * can take seconds. A match that was stopped or restarted meanwhile no longer needs the frames,
 * and each of them costs quota, so the room is asked again before they are requested.
 */
export function createPrepareRound(deps: {
  locationService: LocationService;
  prepareStartViews: (target: RoundTarget) => Promise<void>;
  /** The room as it is now; undefined before the shell exists. */
  getState: () => RoomState | undefined;
}): (request: PrepareRoundRequest) => Promise<RoundTarget> {
  return async ({ matchId, gen, map, region, excludeCountryIds, withBots }) => {
    const target = await deps.locationService.prepareRoundLocation({
      map,
      region,
      excludeCountryIds,
    });
    if (!withBots) return target;
    const state = deps.getState();
    const stillWanted =
      !state || (state.matchId === matchId && state.gen === gen && state.phase === 'ROUND_LOADING');
    // The engine drops the result of a round it no longer waits for, with or without frames.
    if (stillWanted) await deps.prepareStartViews(target);
    return target;
  };
}
