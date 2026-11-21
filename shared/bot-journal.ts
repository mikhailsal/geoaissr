import { z } from 'zod';

/** Limits shared by the tool schemas and the journal that the result card renders. */
export const FINDING_MAX_LEN = 600;
export const SUMMARY_MAX_LEN = 600;
export const SHIFTS_MAX = 3;
export const SHIFT_VERSION_MAX_LEN = 120;
export const SHIFT_BECAUSE_MAX_LEN = 300;

export const SHIFT_EFFECTS = ['excluded', 'weaker', 'stronger'] as const;
export type ShiftEffect = (typeof SHIFT_EFFECTS)[number];

export const findingTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(FINDING_MAX_LEN)
  .describe(
    'Что показали ПРЕДЫДУЩИЕ кадры (до этого вызова): конкретный признак и как он меняет версии',
  );

export const shiftSchema = z
  .object({
    version: z
      .string()
      .trim()
      .min(1)
      .max(SHIFT_VERSION_MAX_LEN)
      .describe('Версия: страна или регион'),
    effect: z
      .enum(SHIFT_EFFECTS)
      .describe('excluded — исключена, weaker — слабее, stronger — сильнее'),
    because: z
      .string()
      .trim()
      .min(1)
      .max(SHIFT_BECAUSE_MAX_LEN)
      .describe('Какой видимый признак это меняет и почему'),
  })
  .strict();
export type Shift = z.infer<typeof shiftSchema>;

export const shiftsSchema = z
  .array(shiftSchema)
  .max(SHIFTS_MAX)
  .describe('Необязательно: как находка сдвинула версии (не больше 3)');

export const currentGuessSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite(),
  })
  .strict()
  .describe('Твоя лучшая точка прямо сейчас');
export type CurrentGuess = z.infer<typeof currentGuessSchema>;

export const summarySchema = z
  .string()
  .trim()
  .min(1)
  .max(SUMMARY_MAX_LEN)
  .describe('Итог от первого лица: что увидел, как менялись версии, почему эта точка');

export const FINDING_STATES = ['pending', 'recorded', 'missing', 'round-ended'] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export const journalFrameSchema = z.object({
  label: z.string(),
  thumbUrl: z.string(),
  fullUrl: z.string().optional(),
  params: z
    .object({
      heading: z.number(),
      pitch: z.number().optional(),
      fov: z.number().optional(),
      step: z.number().optional(),
    })
    .optional(),
});
export type JournalFrame = z.infer<typeof journalFrameSchema>;

/**
 * One step of a bot's round. `index` equals the thumb `turn` (0 = the free observe).
 * `findingState` is `pending` while the bot is still working, then `recorded`, `missing`
 * (the bot ignored one correction) or `round-ended` (the round closed before the finding).
 */
export const journalStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(['observe', 'look', 'move']),
  reason: z.string().optional(),
  frames: z.array(journalFrameSchema),
  finding: z.string().optional(),
  findingState: z.enum(FINDING_STATES),
  shifts: z.array(shiftSchema).optional(),
  /** The bot's best point after seeing this step (it arrives with the next call). */
  currentGuess: currentGuessSchema.optional(),
  /** The accepted call carried no `current_guess`: the card says «новая точка не записана». */
  pointMissing: z.boolean().optional(),
  /** Great-circle km from the previous recorded point; absent for the first point. */
  movedKm: z.number().nonnegative().optional(),
  atMs: z.number().nonnegative(),
});
export type JournalStep = z.infer<typeof journalStepSchema>;

export const botJournalSchema = z.object({
  steps: z.array(journalStepSchema),
  summary: z.string().optional(),
  finalFinding: z.string().optional(),
});
export type BotJournal = z.infer<typeof botJournalSchema>;

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, max) || undefined;
}

/** Lenient ingress: trims, truncates, and treats empty or non-string input as missing. */
export function parseFindingInput(value: unknown): string | undefined {
  return boundedText(value, FINDING_MAX_LEN);
}

/** Lenient ingress: keeps up to three well-formed shifts and drops the rest. */
export function parseShiftsInput(value: unknown): Shift[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: Shift[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const version = boundedText(entry.version, SHIFT_VERSION_MAX_LEN);
    const because = boundedText(entry.because, SHIFT_BECAUSE_MAX_LEN);
    const effect = SHIFT_EFFECTS.find((e) => e === entry.effect);
    if (version && because && effect) result.push({ version, effect, because });
    if (result.length === SHIFTS_MAX) break;
  }
  return result.length > 0 ? result : undefined;
}

/** Summary ingress with the same leniency as findings. */
export function parseSummaryInput(value: unknown): string | undefined {
  return boundedText(value, SUMMARY_MAX_LEN);
}
