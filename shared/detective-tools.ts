import { z } from 'zod';
import { currentGuessSchema, findingTextSchema, shiftsSchema } from './bot-journal.ts';
import {
  MOVE_DISTANCE_MAX_M,
  MOVE_DISTANCE_MIN_M,
  finalGuessInputSchema,
  observeInputSchema,
  toToolJsonSchema,
} from './bot-tools.ts';
import { sceneReportSchema } from './detective-report.ts';

/**
 * Tool contracts of the Detective play style. A Detective bot is two processes: the brain decides
 * and never sees a frame; the eyes see and never name a place. The server maps each token to one
 * role, and the bridge lists only that role's tools.
 */
export const DETECTIVE_ROLES = ['brain', 'eyes'] as const;
export type DetectiveRole = (typeof DETECTIVE_ROLES)[number];

export const MAX_REQUESTS = 5;
export const TOPIC_MAX_LEN = 120;
export const TEXT_TARGET_MAX_LEN = 80;
export const ANSWER_VALUE_MAX_LEN = 300;
export const CLUE_MAX_LEN = 300;
/** Paid camera actions the eyes may spend before the report: the brain cannot start without it. */
export const PRE_REPORT_ACTIONS = 3;

/** `no_road` answers a drive request only: the move did not happen. */
export const ABSTAIN_VALUES = ['not_visible', 'unreadable', 'no_road'] as const;
export type AbstainValue = (typeof ABSTAIN_VALUES)[number];

export function isAbstain(value: string): value is AbstainValue {
  return (ABSTAIN_VALUES as readonly string[]).includes(value);
}

export const EYES_CONFIDENCE_LEVELS = ['sure', 'unsure'] as const;
export type EyesConfidence = (typeof EYES_CONFIDENCE_LEVELS)[number];

export const GUESS_CONFIDENCE_LEVELS = ['country', 'region', 'guess'] as const;
export type GuessConfidence = (typeof GUESS_CONFIDENCE_LEVELS)[number];

const topicSchema = z
  .string()
  .trim()
  .min(3)
  .max(TOPIC_MAX_LEN)
  .describe(
    'Тема: на что посмотреть и что описать, например «люди на улице: одежда, чем заняты». Не вопрос: без «?» и без «ли»',
  );

const describeRequest = z.object({ kind: z.literal('describe'), topic: topicSchema }).strict();

const textRequest = z
  .object({
    kind: z.literal('text'),
    target: z
      .string()
      .trim()
      .min(1)
      .max(TEXT_TARGET_MAX_LEN)
      .describe('Какой текст переписать дословно, например «самая крупная вывеска»'),
  })
  .strict();

const driveRequest = z
  .object({
    kind: z.literal('drive'),
    heading: z
      .number()
      .finite()
      .min(0)
      .max(360)
      .describe('Азимут, в какую сторону ехать по дороге (0 — север, 90 — восток)'),
    distance_m: z
      .number()
      .finite()
      .min(MOVE_DISTANCE_MIN_M)
      .max(MOVE_DISTANCE_MAX_M)
      .describe(
        `Сколько метров проехать по дороге (${MOVE_DISTANCE_MIN_M}–${MOVE_DISTANCE_MAX_M})`,
      ),
    topic: topicSchema.describe(
      'Что описать на новом месте, например «указатели и вывески у перекрёстка»',
    ),
  })
  .strict();

export type DetectiveRequest =
  z.infer<typeof describeRequest> | z.infer<typeof textRequest> | z.infer<typeof driveRequest>;

function askSchema(moveEnabled: boolean) {
  const request = moveEnabled
    ? z.discriminatedUnion('kind', [describeRequest, textRequest, driveRequest])
    : z.discriminatedUnion('kind', [describeRequest, textRequest]);
  return z
    .object({
      hypothesis: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe('Какие версии сейчас и что их разделит'),
      requests: z.array(request).min(1).max(MAX_REQUESTS),
      finding: findingTextSchema
        .optional()
        .describe(
          'Что НОВОГО ты узнал: в первом ask — из отчёта, дальше — из ответов на предыдущий запрос, и что это меняет. Не повторяй уже записанное',
        ),
      shifts: shiftsSchema.optional(),
      current_guess: currentGuessSchema.optional().describe('Твоя лучшая точка сейчас'),
      control: z
        .boolean()
        .optional()
        .describe('true, если этим запросом перепроверяешь признак, на котором держится версия'),
    })
    .strict();
}

/** The server parses every request kind and refuses a drive itself when movement is off. */
export const detectiveAskSchema = askSchema(true);
export type DetectiveAskInput = z.infer<typeof detectiveAskSchema>;

export const detectiveAnswerSchema = z
  .object({
    request_id: z.string().trim().min(1).max(32),
    answers: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(MAX_REQUESTS).describe('Номер просьбы'),
            value: z
              .string()
              .trim()
              .min(1)
              .max(ANSWER_VALUE_MAX_LEN)
              .describe(
                'Описание своими словами или текст дословно; not_visible, если этого на кадрах нет; unreadable, если не разобрать; no_road, если проехать не удалось',
              ),
            confidence: z
              .enum(EYES_CONFIDENCE_LEVELS)
              .optional()
              .describe('sure — видно отчётливо; unsure — мелко, темно или частично'),
            frame: z
              .number()
              .int()
              .min(1)
              .max(99)
              .optional()
              .describe('Номер кадра, на котором это видно'),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_REQUESTS),
  })
  .strict();
export type DetectiveAnswerInput = z.infer<typeof detectiveAnswerSchema>;

// The brain sees no frame, so the shared wording («что показали кадры») is replaced.
const detectiveFinalSchema = finalGuessInputSchema.extend({
  finding: findingTextSchema.describe(
    'Что нового показали ответы на последний запрос и что это меняет. Не повторяй уже записанное',
  ),
  confidence: z
    .enum(GUESS_CONFIDENCE_LEVELS)
    .describe(
      'country — уверен в стране; region — только в части света или регионе; guess — догадка',
    ),
  clue: z.string().trim().min(1).max(CLUE_MAX_LEN).describe('Признак, который решил'),
});

const finalExtrasSchema = z
  .object({
    confidence: z.enum(GUESS_CONFIDENCE_LEVELS).optional().catch(undefined),
    clue: z.string().trim().min(1).optional().catch(undefined),
  })
  .passthrough();

/** Lenient parse of the Detective's extra `final_guess` fields: a bad value counts as missing. */
export function parseFinalExtras(raw: unknown): {
  confidence: GuessConfidence | null;
  clue: string | null;
} {
  const parsed = finalExtrasSchema.safeParse(raw);
  if (!parsed.success) return { confidence: null, clue: null };
  return {
    confidence: parsed.data.confidence ?? null,
    clue: parsed.data.clue?.slice(0, CLUE_MAX_LEN) ?? null,
  };
}

/** «есть ли…», «видно ли…»: the particle as a word of its own. */
const LI_PARTICLE = /(?<![\p{L}\p{N}])ли(?![\p{L}\p{N}])/iu;

/**
 * A request must name a topic, not ask a question: an eyes model tends to confirm what it is
 * asked about. The server refuses a «?» or the particle «ли».
 */
export function hasQuestionForm(text: string): boolean {
  return text.includes('?') || LI_PARTICLE.test(text);
}

export const eyesLookSchema = z
  .object({
    heading: z.number().finite().min(0).max(360).describe('Азимут взгляда в градусах (0–360)'),
    pitch: z.number().finite().min(-90).max(90).default(0),
    fov: z
      .number()
      .finite()
      .min(10)
      .max(120)
      .optional()
      .describe('Угол обзора: 90 обычный, 20–45 приближение'),
  })
  .strict();

export const eyesMoveSchema = z
  .object({
    heading: z.number().finite().min(0).max(360).describe('Азимут движения по дороге (0–360)'),
    distance_m: z
      .number()
      .finite()
      .min(MOVE_DISTANCE_MIN_M)
      .max(MOVE_DISTANCE_MAX_M)
      .optional()
      .describe(
        `Дальний ход: сколько метров проехать по дороге (${MOVE_DISTANCE_MIN_M}–${MOVE_DISTANCE_MAX_M}). Без этого поля — один короткий шаг около 20 м`,
      ),
  })
  .strict();

const emptyInputSchema = z.object({}).strict();

export interface DetectiveToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function brainTools(moveEnabled: boolean): DetectiveToolDefinition[] {
  const kinds = moveEnabled
    ? 'описать тему своими словами, переписать текст дословно или проехать по дороге и описать новое место'
    : 'описать тему своими словами или переписать текст дословно';
  return [
    {
      name: 'briefing',
      description:
        'Получить отчёт напарника о сцене. Ждёт, пока отчёт готов (обычно 20–30 с от начала раунда). Бесплатно. Вызови первым.',
      inputSchema: toToolJsonSchema(emptyInputSchema),
    },
    {
      name: 'ask',
      description: `Отправить напарнику до ${MAX_REQUESTS} просьб: ${kinds}. Блокирует до ответа (не дольше 30 с, с проездом — 45 с). Бесплатно. В каждом вызове обязательны finding и current_guess.`,
      inputSchema: toToolJsonSchema(askSchema(moveEnabled)),
    },
    {
      name: 'final_guess',
      description:
        'Записать окончательную догадку: lat, lng, confidence, clue, finding — что нового показали последние ответы, и summary от первого лица. Завершает раунд.',
      inputSchema: toToolJsonSchema(detectiveFinalSchema),
    },
  ];
}

function eyesTools(moveEnabled: boolean): DetectiveToolDefinition[] {
  const move: DetectiveToolDefinition = {
    name: 'move',
    description: `Проехать по дороге в сторону heading и получить новый кадр с номером. Без distance_m — короткий шаг около 20 м; с distance_m — дальний ход до ${MOVE_DISTANCE_MAX_M} м, кадр смотрит по ходу движения. Стоит 1 ход. Следующие look снимаются с нового места.`,
    inputSchema: toToolJsonSchema(eyesMoveSchema),
  };
  return [
    {
      name: 'observe',
      description: 'Получить 4 стартовых кадра (кадры 1–4: север, восток, юг, запад). Бесплатно.',
      inputSchema: toToolJsonSchema(observeInputSchema),
    },
    {
      name: 'look',
      description:
        'Повернуть или приблизить камеру (heading, pitch, fov) и получить новый кадр с номером. Стоит 1 ход.',
      inputSchema: toToolJsonSchema(eyesLookSchema),
    },
    ...(moveEnabled ? [move] : []),
    {
      name: 'report',
      description:
        'Сдать отчёт о сцене: по разделам, каждая строка — объект {text, frame}. Один раз за раунд, до первого next_request.',
      inputSchema: toToolJsonSchema(sceneReportSchema),
    },
    {
      name: 'next_request',
      description:
        'Ждать следующий запрос с просьбами (до 20 с). Если запроса нет, вызови снова. Бесплатно.',
      inputSchema: toToolJsonSchema(emptyInputSchema),
    },
    {
      name: 'answer',
      description:
        'Ответить на запрос: по каждой просьбе описание или дословный текст, confidence и номер кадра. Бесплатно.',
      inputSchema: toToolJsonSchema(detectiveAnswerSchema),
    },
  ];
}

export function getDetectiveToolDefinitions(
  role: DetectiveRole,
  moveEnabled = true,
): DetectiveToolDefinition[] {
  return role === 'brain' ? brainTools(moveEnabled) : eyesTools(moveEnabled);
}

export function getDetectiveToolNames(role: DetectiveRole, moveEnabled = true): string[] {
  return getDetectiveToolDefinitions(role, moveEnabled).map((tool) => tool.name);
}
