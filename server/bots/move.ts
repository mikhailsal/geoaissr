import type { LocationService } from '../location.ts';
import { destinationPoint, walkRoad, type WalkStop } from './road-walk.ts';

export { destinationPoint } from './road-walk.ts';

/** Length of the single short step in fake mode, where there is no road to follow. */
const FAKE_STEP_M = 25;

export interface BotPosition {
  panoId: string;
  lat: number;
  lng: number;
  steps: number;
  fakeSceneIndex: number;
}

export interface MoveResult {
  ok: boolean;
  position: BotPosition;
  message?: string;
  /** Distance covered along the road by this call, in metres; set on success. */
  travelledM?: number;
  /** Bearing of the last hop: the direction the road leads at the new position. */
  headingDeg?: number;
  /** Why the walk ended; anything but `reached` means it stopped short of the request. */
  stop?: WalkStop;
}

export interface MoveRequest {
  /** Long move: metres to cover along the road. Absent means one short step. */
  distanceM?: number;
  signal?: AbortSignal;
}

export interface MoveTracker {
  getPosition: () => BotPosition;
  restorePosition: (prev: BotPosition) => void;
  stepToward: (headingDeg: number, request?: MoveRequest) => Promise<MoveResult>;
}

const NO_ROAD_MESSAGE =
  'В этом направлении не найдена соседняя панорама дороги. Ход не списан, выберите другой азимут или осмотритесь через look.';

export function createMoveTracker(opts: {
  initial: { panoId: string; lat: number; lng: number; fakeSceneIndex: number };
  moveEnabled: boolean;
  fakeMode: boolean;
  locationService: LocationService;
}): MoveTracker {
  let pos: BotPosition = {
    panoId: opts.initial.panoId,
    lat: opts.initial.lat,
    lng: opts.initial.lng,
    steps: 0,
    fakeSceneIndex: opts.initial.fakeSceneIndex,
  };

  function fakeStep(headingDeg: number, request: MoveRequest): MoveResult {
    const travelledM = request.distanceM ?? FAKE_STEP_M;
    const next = destinationPoint(pos.lat, pos.lng, headingDeg, travelledM / 1000);
    const nextStep = pos.steps + 1;
    pos = {
      ...pos,
      lat: next.lat,
      lng: next.lng,
      panoId: `${opts.initial.panoId}:step${nextStep}`,
      steps: nextStep,
    };
    return { ok: true, position: pos, travelledM, headingDeg, stop: 'reached' };
  }

  async function stepToward(headingDeg: number, request: MoveRequest = {}): Promise<MoveResult> {
    if (!opts.moveEnabled) {
      return {
        ok: false,
        position: pos,
        message: 'Движение запрещено правилами этой партии (no-move).',
      };
    }
    if (opts.fakeMode) return fakeStep(headingDeg, request);

    const walk = await walkRoad({
      start: { panoId: pos.panoId, lat: pos.lat, lng: pos.lng },
      headingDeg,
      distanceM: request.distanceM ?? null,
      queryMetadata: (lat, lng, radius) => opts.locationService.queryMetadata(lat, lng, radius),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (walk.hops === 0) return { ok: false, position: pos, message: NO_ROAD_MESSAGE };
    pos = { ...pos, ...walk.end, steps: pos.steps + 1 };
    return {
      ok: true,
      position: pos,
      travelledM: Math.round(walk.travelledM),
      headingDeg: walk.headingDeg,
      stop: walk.stop,
    };
  }

  return {
    getPosition: () => pos,
    restorePosition: (prev) => {
      pos = { ...prev };
    },
    stepToward,
  };
}
