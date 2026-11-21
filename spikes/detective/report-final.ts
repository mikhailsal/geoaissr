import { elapsedMs, errorReply, remainingMs, type SessionState, type ToolReply } from './state.ts';

/** With less than this left, a control ask no longer fits before the final guess. */
export const CONTROL_MIN_LEFT_MS = 30_000;

/**
 * The control check of the report protocol (docs/evals/detective-spike-3.md, Part C, item 4).
 * A `final_guess` that comes before any control ask, with time left for one, is refused once
 * with a reminder; its point is kept as a checkpoint. A second `final_guess` is accepted: the
 * brain decides.
 */
export function controlReminder(
  s: SessionState,
  guess: { lat: number; lng: number },
): ToolReply | null {
  if (s.asks.some((ask) => ask.control === true)) return null;
  if (s.eyesDownAtMs !== null || remainingMs(s) <= CONTROL_MIN_LEFT_MS) return null;
  if (s.correctionsUsed.has('final:control')) return null;
  s.correctionsUsed.add('final:control');
  s.corrections.push({ role: 'brain', tool: 'final_guess', reason: 'control' });
  s.checkpoints.push({ lat: guess.lat, lng: guess.lng, tMs: elapsedMs(s) });
  const left = Math.round(remainingMs(s) / 1000);
  return errorReply(
    `[GEO_DETECTIVE_CONTROL_MISSING] Точка сохранена как промежуточная, раунд не окончен: контрольной проверки ещё не было (правило 6), а до конца раунда ${left} с. Отправь ask с control: true: попроси напарника ещё раз посмотреть туда, где был решающий признак, и добавь просьбы о том, чего ты ещё не знаешь. Если повторишь final_guess без проверки, он будет принят.`,
  );
}
