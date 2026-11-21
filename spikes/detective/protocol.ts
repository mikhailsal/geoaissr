import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { currentGuessSchema, findingTextSchema, shiftsSchema } from '../../shared/bot-journal.ts';
import { finalGuessInputSchema, observeInputSchema } from '../../shared/bot-tools.ts';
import type { CatalogFeature } from './catalog.ts';

/** Tool schemas of the two Detective roles. The server maps each token to one role. */

export type Role = 'brain' | 'eyes';

export const MAX_QUESTIONS = 5;
export const TEXT_TARGET_MAX_LEN = 80;
export const ANSWER_VALUE_MAX_LEN = 200;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const compatible = schema as unknown as Parameters<typeof zodToJsonSchema>[0];
  const raw = zodToJsonSchema(compatible, { target: 'jsonSchema7' }) as Record<string, unknown>;
  const { $schema: _removed, ...rest } = raw;
  return rest;
}

export function buildBrainSchemas(catalog: readonly CatalogFeature[]) {
  const ids = catalog.map((f) => f.id);
  const [first, ...rest] = ids;
  if (first === undefined) throw new Error('Empty feature catalog');
  const question = z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('feature'),
        feature: z.enum([first, ...rest]).describe('Признак из каталога'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('text'),
        target: z
          .string()
          .trim()
          .min(1)
          .max(TEXT_TARGET_MAX_LEN)
          .describe('Какой текст прочитать дословно, например «самая крупная вывеска»'),
      })
      .strict(),
  ]);
  const ask = z
    .object({
      hypothesis: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe('Что хочу узнать и что будет значить каждый ответ'),
      questions: z.array(question).min(1).max(MAX_QUESTIONS),
      finding: findingTextSchema
        .optional()
        .describe('Что показали ответы на ПРЕДЫДУЩИЙ запрос и что это меняет (со второго ask)'),
      shifts: shiftsSchema.optional(),
      current_guess: currentGuessSchema
        .optional()
        .describe('Твоя лучшая точка сейчас (со второго ask обязательно)'),
    })
    .strict();
  return { ask, question };
}

export type BrainSchemas = ReturnType<typeof buildBrainSchemas>;
export type AskInput = z.infer<BrainSchemas['ask']>;

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

export const nextRequestSchema = z.object({}).strict();

export const answerSchema = z
  .object({
    request_id: z.string().trim().min(1).max(32),
    answers: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(MAX_QUESTIONS).describe('Номер вопроса'),
            value: z
              .string()
              .trim()
              .min(1)
              .max(ANSWER_VALUE_MAX_LEN)
              .describe('id значения из списка, not_visible, unreadable или дословный текст'),
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
export type AnswerInput = z.infer<typeof answerSchema>;

export function roleToolDefinitions(
  role: Role,
  catalog: readonly CatalogFeature[],
): ToolDefinition[] {
  if (role === 'brain') {
    return [
      {
        name: 'ask',
        description:
          'Задать глазам до 5 вопросов о признаках сцены. Блокирует до ответа (не дольше 30 с). Бесплатно. Со второго вызова обязательно finding и current_guess.',
        inputSchema: jsonSchema(buildBrainSchemas(catalog).ask),
      },
      {
        name: 'final_guess',
        description:
          'Записать окончательную догадку: lat, lng, summary от первого лица и finding — что показали последние ответы. Завершает раунд.',
        inputSchema: jsonSchema(finalGuessInputSchema),
      },
    ];
  }
  return [
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
      name: 'next_request',
      description:
        'Ждать следующий запрос с вопросами (до 20 с). Если запроса нет, вызови снова. Бесплатно.',
      inputSchema: jsonSchema(nextRequestSchema),
    },
    {
      name: 'answer',
      description:
        'Ответить на запрос: по одному значению на вопрос и номер кадра, где это видно. Бесплатно.',
      inputSchema: jsonSchema(answerSchema),
    },
  ];
}
