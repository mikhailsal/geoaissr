import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const EXPLANATION_MAX_LEN = 600;
export const QUIP_MAX_LEN = 120;
export const PERSONALITY_MAX_LEN = 200;

export const PERSONALITY_PRESETS = ['neutral', 'braggart', 'humble', 'scientist'] as const;
export type PersonalityPreset = (typeof PERSONALITY_PRESETS)[number];

export const DIFFICULTY_PRESETS = ['novice', 'amateur', 'master', 'custom'] as const;
export type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Model names like `gemini-4-argon-medium` carry a reasoning-effort suffix. */
export const MODEL_EFFORT_SUFFIX = /-(?:low|medium|high|xhigh|max)$/i;

export const BOT_NAME_MAX_LEN = 24;

/** Short words that are ordinary words, not acronyms, keep title case ("Gemini 3 Pro"). */
const SHORT_TITLE_WORDS = new Set(['pro']);

function formatModelWord(word: string): string {
  if (/^[a-z]{2,3}$/i.test(word) && !SHORT_TITLE_WORDS.has(word.toLowerCase())) {
    return word.toUpperCase(); // gpt -> GPT, glm -> GLM, oss -> OSS
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Default bot name: the model as words, without its effort suffix.
 * "gpt-6-luna-medium" -> "GPT 6 Luna", "claude-sonnet-5-5" -> "Claude Sonnet 5.5".
 */
export function botNameFromModel(model: string): string {
  const base = model.trim().replace(MODEL_EFFORT_SUFFIX, '') || model.trim();
  const words: string[] = [];
  for (const part of base.split(/[-_\s]+/).filter(Boolean)) {
    const prev = words.at(-1);
    // Version numbers split by dashes ("5-5") read as "5.5".
    if (prev && /^\d{1,2}$/.test(prev) && /^\d{1,2}$/.test(part)) {
      words[words.length - 1] = `${prev}.${part}`;
      continue;
    }
    words.push(formatModelWord(part));
  }
  return words.join(' ').slice(0, BOT_NAME_MAX_LEN).trim() || 'ИИ';
}

/** Default names from earlier versions; a bot still carrying one counts as not renamed. */
const LEGACY_DEFAULT_BOT_NAMES = new Set([
  'ИИ Клод',
  'ИИ Кодекс',
  'ИИ Агент',
  'ИИ 1',
  'ИИ 2',
  'ИИ 3',
]);

function legacyHyphenNameFromModel(model: string): string {
  const base = model.trim().replace(MODEL_EFFORT_SUFFIX, '') || model.trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, BOT_NAME_MAX_LEN);
}

/** True while the host has not renamed the bot, so its name may follow the model. */
export function isAutoBotName(name: string, model: string): boolean {
  return (
    name === botNameFromModel(model) ||
    name === legacyHyphenNameFromModel(model) ||
    LEGACY_DEFAULT_BOT_NAMES.has(name)
  );
}

export const IMAGE_SIZES = [256, 400, 640] as const;
export type BotImageSize = (typeof IMAGE_SIZES)[number];

export interface PresetConfig {
  imageSize: BotImageSize;
  moveLimit: number;
  effort: EffortLevel;
}

export const PRESET_CONFIGS: Record<Exclude<DifficultyPreset, 'custom'>, PresetConfig> = {
  novice: { imageSize: 256, moveLimit: 2, effort: 'low' },
  amateur: { imageSize: 400, moveLimit: 4, effort: 'low' },
  master: { imageSize: 640, moveLimit: 6, effort: 'medium' },
};

export const personalityTextSchema = z
  .string()
  .max(PERSONALITY_MAX_LEN, `Текст характера не длиннее ${PERSONALITY_MAX_LEN} символов`)
  .refine((val) => !/[\r\n]/.test(val), 'Текст характера не должен содержать переводы строки');

export const observeInputSchema = z.object({}).strict();

export const lookInputSchema = z
  .object({
    heading: z.number().finite().min(0).max(360).describe('Азимут взгляда в градусах (0–360)'),
    pitch: z
      .number()
      .finite()
      .min(-90)
      .max(90)
      .default(0)
      .describe('Угол наклона камеры (-90 вниз .. 90 вверх, по умолчанию 0)'),
    fov: z
      .number()
      .finite()
      .min(10)
      .max(120)
      .default(90)
      .describe('Угол обзора (10 приближение .. 120 широкий, по умолчанию 90)'),
  })
  .strict();

export const moveInputSchema = z
  .object({
    heading: z.number().finite().min(0).max(360).describe('Азимут движения по дороге (0–360)'),
  })
  .strict();

export const submitGuessInputSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90).describe('Широта от -90 до 90'),
    lng: z.number().finite().describe('Долгота (приводится к -180..180)'),
    explanation: z
      .string()
      .trim()
      .min(1, 'Поле explanation не может быть пустым')
      .describe('Краткое объяснение догадки до 600 символов на языке интерфейса'),
    quip: z
      .string()
      .trim()
      .optional()
      .describe('Необязательная короткая реплика для соперников до 120 символов'),
  })
  .strict();

export type LookInput = z.infer<typeof lookInputSchema>;
export type MoveInput = z.infer<typeof moveInputSchema>;
export type SubmitGuessInput = z.infer<typeof submitGuessInputSchema>;

export interface NormalizedGuessInput {
  lat: number;
  lng: number;
  explanation: string;
  quip?: string;
}

export function normalizeLongitude(lng: number): number {
  const shifted = ((((lng + 180) % 360) + 360) % 360) - 180;
  return shifted === -180 && lng > 0 ? 180 : shifted;
}

export function normalizeSubmitGuessInput(raw: SubmitGuessInput): NormalizedGuessInput {
  const explanation = raw.explanation.slice(0, EXPLANATION_MAX_LEN);
  const quip = raw.quip && raw.quip.length > 0 ? raw.quip.slice(0, QUIP_MAX_LEN) : undefined;
  return {
    lat: raw.lat,
    lng: normalizeLongitude(raw.lng),
    explanation,
    ...(quip !== undefined ? { quip } : {}),
  };
}

export interface BotToolDefinition {
  name: 'observe' | 'look' | 'move' | 'submit_guess';
  description: string;
  inputSchema: Record<string, unknown>;
}

function toToolJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const compatible = schema as unknown as Parameters<typeof zodToJsonSchema>[0];
  const raw = zodToJsonSchema(compatible, { target: 'jsonSchema7' }) as Record<string, unknown>;
  const { $schema: _removed, ...rest } = raw;
  return rest;
}

export function getBotToolDefinitions(moveEnabled = true): BotToolDefinition[] {
  return [
    {
      name: 'observe',
      description:
        'Получить 4 стартовых снимка панорамы (север, восток, юг, запад). Бесплатно, ход не тратит.',
      inputSchema: toToolJsonSchema(observeInputSchema),
    },
    {
      name: 'look',
      description:
        'Повернуть или приблизить камеру в заданном направлении (heading, pitch, fov). Стоит 1 ход.',
      inputSchema: toToolJsonSchema(lookInputSchema),
    },
    {
      name: 'move',
      description: moveEnabled
        ? 'Сделать шаг по дороге в сторону heading и получить 4 новых снимка. Стоит 1 ход.'
        : 'Движение по панораме выключено в этой партии (вызов вернёт ошибку без списания хода).',
      inputSchema: toToolJsonSchema(moveInputSchema),
    },
    {
      name: 'submit_guess',
      description:
        'Записать догадку (lat, lng, explanation, опционально quip). Бесплатно, можно обновлять; засчитывается последняя.',
      inputSchema: toToolJsonSchema(submitGuessInputSchema),
    },
  ];
}

export function formatToolZodError(err: z.ZodError): string {
  const lines = err.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : 'input';
    return `- ${field}: ${issue.message}`;
  });
  return `Неверные аргументы инструмента:\n${lines.join('\n')}\nХод не списан.`;
}
