import type { BotAccounting } from '../../shared/bot-results.ts';
import type { EngineEvent, ReduceOutput, RoomState } from './types.ts';

type AccountingEvent = Extract<EngineEvent, { type: 'bot_accounting' }>;

export function accountingFields(value: BotAccounting): BotAccounting {
  return {
    ...(value.tokenUsage !== undefined ? { tokenUsage: value.tokenUsage } : {}),
    ...(value.roleUsage !== undefined ? { roleUsage: value.roleUsage } : {}),
    ...(value.roleModels !== undefined ? { roleModels: value.roleModels } : {}),
    ...(value.costUsd !== undefined ? { costUsd: value.costUsd } : {}),
    ...(value.matchedModelId !== undefined ? { matchedModelId: value.matchedModelId } : {}),
    ...(value.isApproximateMatch !== undefined
      ? { isApproximateMatch: value.isApproximateMatch }
      : {}),
  };
}

/** Late pricing enriches the same round without changing scores or a newer match. */
export function handleBotAccounting(state: RoomState, event: AccountingEvent): ReduceOutput {
  if (event.matchId !== state.matchId) return { state, effects: [] };
  const fields = accountingFields(event.accounting);
  const active = state.loadingOrActive;
  const activeBot = active?.bots[event.botId];
  if (active?.roundNumber === event.roundNumber && state.gen === event.gen && activeBot) {
    return {
      state: {
        ...state,
        loadingOrActive: {
          ...active,
          bots: { ...active.bots, [event.botId]: { ...activeBot, ...fields } },
        },
      },
      effects: [],
    };
  }
  const round = state.playedRounds.find(
    (r) => r.roundNumber === event.roundNumber && r.gen === event.gen,
  );
  const entry = round?.entriesByParticipant[event.botId];
  if (!round || !entry?.isAi) return { state, effects: [] };
  const enriched = { ...entry, ...fields };
  return {
    state: {
      ...state,
      playedRounds: state.playedRounds.map((r) =>
        r === round
          ? { ...r, entriesByParticipant: { ...r.entriesByParticipant, [event.botId]: enriched } }
          : r,
      ),
      results:
        state.results?.roundNumber === event.roundNumber
          ? {
              ...state.results,
              entries: state.results.entries.map((e) => (e.id === event.botId ? enriched : e)),
            }
          : state.results,
    },
    effects: [],
  };
}
