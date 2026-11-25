import type { RoundTarget } from '../../server/engine/types.ts';
import { placesNear, settlementRadiusKm } from '../../server/maps/places.ts';

/** A place this far outside a settlement's built-up radius still counts as inside it. */
const SETTLEMENT_SLACK_KM = 1;
/** How far around a round the nearest settlement is looked for. */
const NEAREST_TOWN_SEARCH_KM = 300;

export interface SampledRound {
  countryId: string;
  countryNameRu: string;
  lat: number;
  lng: number;
  /** Distance to the nearest settlement of 15 thousand people or more; null beyond 300 km. */
  nearestTownKm: number | null;
  nearestTownPopulation: number | null;
  /** Whether the round starts inside the built-up radius of a settlement. */
  inSettlement: boolean;
  lookups: number;
  seconds: number;
}

/** What a search cost, whether it found a round or not. */
export interface SearchCost {
  lookups: number;
  seconds: number;
}

export interface SampleSummary {
  map: string;
  region: string;
  roundsAsked: number;
  roundsFound: number;
  failures: string[];
  inSettlementShare: number | null;
  /** Over every round found; a round with no town within 300 km counts as 300. */
  medianNearestTownKm: number | null;
  /**
   * The three below are over every search that ran: one that found no round counts with the
   * lookups and the time it spent, the way a match would have waited for it.
   */
  meanLookupsPerRound: number | null;
  meanSecondsPerRound: number | null;
  slowestRoundSeconds: number | null;
  /** Countries by number of rounds, most frequent first. */
  countries: { nameRu: string; rounds: number }[];
}

export function describeRound(target: RoundTarget, lookups: number, seconds: number): SampledRound {
  const near = placesNear(target, NEAREST_TOWN_SEARCH_KM);
  const nearest = near[0];
  const inSettlement = near.some(
    (entry) => entry.km <= settlementRadiusKm(entry.place.population) + SETTLEMENT_SLACK_KM,
  );
  return {
    countryId: target.countryId,
    countryNameRu: target.countryNameRu,
    lat: target.lat,
    lng: target.lng,
    nearestTownKm: nearest ? Math.round(nearest.km * 10) / 10 : null,
    nearestTownPopulation: nearest?.place.population ?? null,
    inSettlement,
    lookups,
    seconds,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function summarize(opts: {
  map: string;
  region: string;
  roundsAsked: number;
  rounds: readonly SampledRound[];
  failures: readonly string[];
  /** The cost of each search that found no round. */
  failedSearches: readonly SearchCost[];
}): SampleSummary {
  const { rounds } = opts;
  const searches: readonly SearchCost[] = [...rounds, ...opts.failedSearches];
  const byCountry = new Map<string, number>();
  for (const round of rounds) {
    byCountry.set(round.countryNameRu, (byCountry.get(round.countryNameRu) ?? 0) + 1);
  }
  const seconds = searches.map((search) => search.seconds);
  return {
    map: opts.map,
    region: opts.region,
    roundsAsked: opts.roundsAsked,
    roundsFound: rounds.length,
    failures: [...opts.failures],
    inSettlementShare: round2(mean(rounds.map((r) => (r.inSettlement ? 1 : 0)))),
    medianNearestTownKm: round2(
      median(rounds.map((r) => r.nearestTownKm ?? NEAREST_TOWN_SEARCH_KM)),
    ),
    meanLookupsPerRound: round2(mean(searches.map((search) => search.lookups))),
    meanSecondsPerRound: round2(mean(seconds)),
    slowestRoundSeconds: round2(seconds.length > 0 ? Math.max(...seconds) : null),
    countries: [...byCountry.entries()]
      .map(([nameRu, n]) => ({ nameRu, rounds: n }))
      .sort((a, b) => b.rounds - a.rounds || a.nameRu.localeCompare(b.nameRu, 'ru')),
  };
}
