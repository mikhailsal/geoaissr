import { z } from 'zod';
import { currentGuessSchema, findingTextSchema, shiftsSchema } from '../../shared/bot-journal.ts';
import { finalGuessInputSchema, observeInputSchema } from '../../shared/bot-tools.ts';
import { CONFIDENCE_LEVELS, type Confidence } from './ceiling-prompts.ts';
import {
  MAX_QUESTIONS,
  eyesLookSchema,
  jsonSchema,
  nextRequestSchema,
  textQuestion,
  type Role,
  type ToolDefinition,
} from './protocol.ts';
import { reportSchema } from './report.ts';

/**
 * Schemas and tools of the report protocol (docs/evals/detective-spike-3.md, Part C). The eyes
 * file a scene report before any request; the brain reads it through `briefing` and then sends
 * requests that name a topic, never a question with an expected answer.
 */

export const TOPIC_MAX_LEN = 120;
export const DESCRIBE_VALUE_MAX_LEN = 300;
export const CLUE_MAX_LEN = 300;
/** Zooms the eyes may spend before the report; the brain cannot start without it. */
export const PRE_REPORT_LOOKS = 3;

const describeRequest = z
  .object({
    kind: z.literal('describe'),
    topic: z
      .string()
      .trim()
      .min(3)
      .max(TOPIC_MAX_LEN)
      .describe(
        'Тема: на что посмотреть и что описать, например «люди на улице: одежда, чем заняты». Не вопрос: без «?» и без «ли»',
      ),
  })
  .strict();

export const reportAskSchema = z
  .object({
    hypothesis: z.string().trim().min(1).max(300).describe('Какие версии сейчас и что их разделит'),
    requests: z
      .array(z.discriminatedUnion('kind', [describeRequest, textQuestion]))
      .min(1)
      .max(MAX_QUESTIONS),
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

export type ReportAskInput = z.infer<typeof reportAskSchema>;

export const reportAnswerSchema = z
  .object({
    request_id: z.string().trim().min(1).max(32),
    answers: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(MAX_QUESTIONS).describe('Номер просьбы'),
            value: z
              .string()
              .trim()
              .min(1)
              .max(DESCRIBE_VALUE_MAX_LEN)
              .describe(
                'Описание своими словами или текст дословно; not_visible, если этого на кадрах нет; unreadable, если не разобрать',
              ),
            confidence: z
              .enum(['sure', 'unsure'])
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
      .max(MAX_QUESTIONS),
  })
  .strict();

export type ReportAnswerInput = z.infer<typeof reportAnswerSchema>;

// The brain sees no frame, so the shared wording («что показали кадры») is replaced.
const reportFinalSchema = finalGuessInputSchema.extend({
  finding: findingTextSchema.describe(
    'Что нового показали ответы на последний запрос и что это меняет. Не повторяй уже записанное',
  ),
  confidence: z
    .enum(CONFIDENCE_LEVELS)
    .describe(
      'country — уверен в стране; region — только в части света или регионе; guess — догадка',
    ),
  clue: z.string().trim().min(1).max(CLUE_MAX_LEN).describe('Признак, который решил'),
});

const finalExtrasSchema = z
  .object({
    confidence: z.enum(CONFIDENCE_LEVELS).optional().catch(undefined),
    clue: z.string().trim().min(1).optional().catch(undefined),
  })
  .passthrough();

/** Lenient parse of the report protocol's extra `final_guess` fields: a bad value is missing. */
export function parseFinalExtras(raw: unknown): {
  confidence: Confidence | null;
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

const BRAIN_TOOLS: ToolDefinition[] = [
  {
    name: 'briefing',
    description:
      'Получить отчёт напарника о сцене. Ждёт, пока отчёт готов (обычно 20–30 с от начала раунда). Бесплатно. Вызови первым.',
    inputSchema: jsonSchema(z.object({}).strict()),
  },
  {
    name: 'ask',
    description:
      'Отправить напарнику до 5 просьб: описать тему своими словами или переписать текст дословно. Блокирует до ответа (не дольше 30 с). Бесплатно. В каждом вызове обязательны finding и current_guess.',
    inputSchema: jsonSchema(reportAskSchema),
  },
  {
    name: 'final_guess',
    description:
      'Записать окончательную догадку: lat, lng, confidence, clue, finding — что нового показали последние ответы, и summary от первого лица. Завершает раунд.',
    inputSchema: jsonSchema(reportFinalSchema),
  },
];

const EYES_TOOLS: ToolDefinition[] = [
  {
    name: 'observe',
    description: 'Получить 4 стартовых кадра (кадры 1–4: север, восток, юг, запад). Бесплатно.',
    inputSchema: jsonSchema(observeInputSchema),
  },
  {
    name: 'look',
    description:
      'Повернуть или приблизить камеру (heading, pitch, fov) и получить новый кадр с номером. Стоит 1 ход.',
    inputSchema: jsonSchema(eyesLookSchema),
  },
  {
    name: 'report',
    description:
      'Сдать отчёт о сцене: по разделам, каждая строка — объект {text, frame}. Один раз за раунд, до первого next_request.',
    inputSchema: jsonSchema(reportSchema),
  },
  {
    name: 'next_request',
    description:
      'Ждать следующий запрос с просьбами (до 20 с). Если запроса нет, вызови снова. Бесплатно.',
    inputSchema: jsonSchema(nextRequestSchema),
  },
  {
    name: 'answer',
    description:
      'Ответить на запрос: по каждой просьбе описание или дословный текст, confidence и номер кадра. Бесплатно.',
    inputSchema: jsonSchema(reportAnswerSchema),
  },
];

export function reportToolDefinitions(role: Role): ToolDefinition[] {
  return role === 'brain' ? BRAIN_TOOLS : EYES_TOOLS;
}
