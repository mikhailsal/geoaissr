import { normalizeLongitude } from '../../shared/bot-tools.ts';
import type { LocationService } from '../location.ts';

const EARTH_RADIUS_KM = 6371;

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
}

export function destinationPoint(
  lat: number,
  lng: number,
  headingDeg: number,
  distanceKm: number,
): { lat: number; lng: number } {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const toDeg = (r: number): number => (r * 180) / Math.PI;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const brng = toRad(headingDeg);
  const ang = distanceKm / EARTH_RADIUS_KM;

  const sinLat2 = Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: normalizeLongitude(toDeg(lng2)) };
}

export interface MoveTracker {
  getPosition: () => BotPosition;
  restorePosition: (prev: BotPosition) => void;
  stepToward: (headingDeg: number) => Promise<MoveResult>;
}

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

  async function stepToward(headingDeg: number): Promise<MoveResult> {
    if (!opts.moveEnabled) {
      return {
        ok: false,
        position: pos,
        message: 'Движение запрещено правилами этой партии (no-move).',
      };
    }

    if (opts.fakeMode) {
      const next = destinationPoint(pos.lat, pos.lng, headingDeg, 0.025);
      const nextStep = pos.steps + 1;
      pos = {
        ...pos,
        lat: next.lat,
        lng: next.lng,
        panoId: `${opts.initial.panoId}:step${nextStep}`,
        steps: nextStep,
      };
      return { ok: true, position: pos };
    }

    for (const stepKm of [0.018, 0.04]) {
      const candidate = destinationPoint(pos.lat, pos.lng, headingDeg, stepKm);
      const meta = await opts.locationService.queryMetadata(candidate.lat, candidate.lng, 35);
      if (
        meta?.status === 'OK' &&
        meta.pano_id &&
        meta.pano_id !== pos.panoId &&
        meta.location &&
        typeof meta.copyright === 'string' &&
        /google/i.test(meta.copyright)
      ) {
        pos = {
          ...pos,
          panoId: meta.pano_id,
          lat: meta.location.lat,
          lng: meta.location.lng,
          steps: pos.steps + 1,
        };
        return { ok: true, position: pos };
      }
    }

    return {
      ok: false,
      position: pos,
      message:
        'В этом направлении не найдена соседняя панорама дороги. Ход не списан, выберите другой азимут или осмотритесь через look.',
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
