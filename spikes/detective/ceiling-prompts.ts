import { z } from 'zod';
import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { extractJson } from './judge-call.ts';
import {
  REPORT_JSON_EXAMPLE,
  REPORT_RULES_RU,
  reportSchema,
  reportSectionLines,
  type SceneReport,
} from './report.ts';

/** Prompts and reply parsing of the ceiling test (docs/evals/detective-spike-3.md, Part B). */

export const CONFIDENCE_LEVELS = ['country', 'region', 'guess'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export function buildDescriberPrompt(sample: EvalSampleItem): string {
  const frames = (sample.imagePaths ?? []).map((p, i) => `- кадр ${i + 1}: ${p}`).join('\n');
  return [
    'Ты — наблюдатель в игре на угадывание места по уличной панораме. Перед тобой 4 снимка одной точки: кадры 1–4 смотрят в четыре стороны. Твой напарник не видит снимков и будет искать место только по твоему отчёту. Опиши сцену точно и подробно.',
    `Сначала открой все четыре снимка инструментом Read:\n${frames}`,
    `ПРАВИЛА:\n${REPORT_RULES_RU.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`,
    `РАЗДЕЛЫ (ключи JSON):\n${reportSectionLines().join('\n')}`,
    `Ответь ТОЛЬКО JSON-объектом, без пояснений, в таком виде: ${REPORT_JSON_EXAMPLE}`,
  ].join('\n\n');
}

export function parseDescriberReply(text: string): SceneReport {
  return reportSchema.parse(extractJson(text));
}

export interface CeilingBrainPromptOptions {
  regionLabelRu: string;
  regionDiagonalKm: number;
  /** The masked report, formatted for reading. */
  reportText: string;
}

export function buildCeilingBrainPrompt(opts: CeilingBrainPromptOptions): string {
  return [
    `Ты играешь в игру на угадывание места по уличной панораме (регион партии: ${opts.regionLabelRu}; диагональ региона около ${Math.round(opts.regionDiagonalKm)} км). Снимков ты НЕ видишь. У тебя есть только отчёт наблюдателя, который видел 4 кадра этой точки.`,
    'Наблюдателю запрещено называть места, поэтому в отчёте только то, что видно. Текст в «…» переписан со снимков дословно. […] — слово, которое скрыл сервер.',
    `Отчёт наблюдателя:\n${opts.reportText}`,
    'Определи место как можно точнее: страну, затем регион и город, если улики позволяют. Опирайся только на отчёт.',
    'Ответь ТОЛЬКО JSON-объектом, без пояснений: {"lat": 0.0, "lng": 0.0, "confidence": "country", "clue": "какая улика решила"}',
    '- lat, lng — твоя точка в градусах;\n- confidence — "country", если уверен в стране; "region", если уверен только в части света или группе соседних стран; "guess", если это догадка;\n- clue — одна фраза: какая улика из отчёта решила.',
  ].join('\n\n');
}

const guessSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  confidence: z.enum(CONFIDENCE_LEVELS),
  clue: z.string().trim().min(1).max(600),
});

export type CeilingGuess = z.infer<typeof guessSchema>;

export function parseGuessReply(text: string): CeilingGuess {
  return guessSchema.parse(extractJson(text));
}
