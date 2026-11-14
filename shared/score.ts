import { normalizeLongitude } from './bot-tools.ts';

export const WORLD_DIAGONAL_KM = 14_916.862;
export const PERFECT_DISTANCE_KM = 0.025;
export const MAX_ROUND_SCORE = 5000;
const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(normalizeLongitude(b.lng) - normalizeLongitude(a.lng));
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateRoundScore(distanceKm: number, diagonalKm: number): number {
  if (distanceKm < PERFECT_DISTANCE_KM) {
    return MAX_ROUND_SCORE;
  }
  const safeDiag = diagonalKm > 0 ? diagonalKm : WORLD_DIAGONAL_KM;
  const raw = Math.round(MAX_ROUND_SCORE * Math.exp((-10 * distanceKm) / safeDiag));
  return Math.max(0, Math.min(MAX_ROUND_SCORE, raw));
}

export interface StandingMetrics {
  id: string;
  totalScore: number;
  answeredRounds: number;
  totalAnsweredDistanceKm: number;
}

export interface RankedStanding<T extends StandingMetrics> {
  rank: number;
  item: T;
}

export function compareStandings(a: StandingMetrics, b: StandingMetrics): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if (b.answeredRounds !== a.answeredRounds) return b.answeredRounds - a.answeredRounds;
  return a.totalAnsweredDistanceKm - b.totalAnsweredDistanceKm;
}

export function rankStandings<T extends StandingMetrics>(items: readonly T[]): RankedStanding<T>[] {
  const sorted = [...items].sort(compareStandings);
  const ranked: RankedStanding<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (!item) continue;
    const prev = ranked[i - 1];
    const tied =
      prev !== undefined &&
      prev.item.totalScore === item.totalScore &&
      prev.item.answeredRounds === item.answeredRounds &&
      Math.abs(prev.item.totalAnsweredDistanceKm - item.totalAnsweredDistanceKm) < 1e-6;
    ranked.push({
      rank: tied ? prev.rank : i + 1,
      item,
    });
  }
  return ranked;
}

export interface RoundSideInput {
  isAi: boolean;
  playedRound: boolean;
  score: number;
}

export interface HumanVsAiRound {
  humansMean: number | null;
  aiMean: number | null;
}

export interface HumanVsAiMatch {
  visible: boolean;
  humansTotal: number;
  aiTotal: number;
  perRound: HumanVsAiRound[];
}

export function computeHumanVsAiRound(entries: readonly RoundSideInput[]): HumanVsAiRound {
  const humans = entries.filter((e) => !e.isAi && e.playedRound);
  const bots = entries.filter((e) => e.isAi && e.playedRound);
  const humansMean =
    humans.length > 0
      ? Math.round(humans.reduce((acc, e) => acc + e.score, 0) / humans.length)
      : null;
  const aiMean =
    bots.length > 0 ? Math.round(bots.reduce((acc, e) => acc + e.score, 0) / bots.length) : null;
  return { humansMean, aiMean };
}

export function computeHumanVsAiMatch(
  rounds: readonly (readonly RoundSideInput[])[],
  hasHumanParticipant: boolean,
  hasAiParticipant: boolean,
): HumanVsAiMatch {
  const visible = hasHumanParticipant && hasAiParticipant;
  const perRound = rounds.map(computeHumanVsAiRound);
  let humansTotal = 0;
  let aiTotal = 0;
  for (const r of perRound) {
    humansTotal += r.humansMean ?? 0;
    aiTotal += r.aiMean ?? 0;
  }
  return { visible, humansTotal, aiTotal, perRound };
}
