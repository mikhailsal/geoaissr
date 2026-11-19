import { gestureDuration, type OrbitGesture } from './orbit/types';

/** Each full turn contributes its own angular motion until it completes. */
export function nextSpin(previous: OrbitGesture | null | undefined, at: number): OrbitGesture {
  const recent = previous?.kind === 'spin' ? (previous.spinTimes ?? [previous.at]) : [];
  return {
    kind: 'spin',
    at,
    spinTimes: [...recent.filter((time) => at - time < gestureDuration.spin), at],
  };
}
