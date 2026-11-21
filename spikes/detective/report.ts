import { z } from 'zod';
import { maskPlaceWords, type PlaceGuard } from './guard.ts';

/**
 * The scene report of spike 3 (docs/evals/detective-spike-3.md, Parts B and C): what the eyes
 * write about a scene in their own words before any request. The sections are fixed, and every
 * line names the frame it was seen in. The eyes never name a place: the server masks place
 * names and demonyms in their words before the brain reads them. Text inside «…» is copied from
 * the scene and is left as it is.
 */

export const REPORT_SECTIONS = [
  {
    id: 'texts',
    ru: 'Текст дословно',
    hint: 'весь читаемый текст: вывески, указатели, реклама, телефоны, адреса сайтов, надписи на машинах. Строка: «текст буква в букву» — где он написан',
  },
  {
    id: 'road',
    ru: 'Дорога',
    hint: 'покрытие, разметка (цвет осевой и краевых линий), по какой стороне едут или стоят машины, бордюры, тротуары',
  },
  {
    id: 'vehicles',
    ru: 'Машины и номера',
    hint: 'типы машин, форма и цвет номерных знаков, читаемые номера в «…»',
  },
  {
    id: 'poles_signs',
    ru: 'Столбы и знаки',
    hint: 'столбы и провода, дорожные знаки (форма, цвета, оборотная сторона), столбики, фонари',
  },
  {
    id: 'buildings',
    ru: 'Дома',
    hint: 'материалы стен, крыши, этажность, окна, заборы',
  },
  {
    id: 'nature',
    ru: 'Природа',
    hint: 'растительность, рельеф, цвет почвы, небо и свет',
  },
  {
    id: 'unusual',
    ru: 'Необычное',
    hint: 'всё остальное, что бросается в глаза: люди и одежда, животные, флаги (только цвета и рисунок), видимые части машины с камерой',
  },
] as const;

export type SectionId = (typeof REPORT_SECTIONS)[number]['id'];

/** The limits a writer is told. The schema allows more, so a long line is not a failed call. */
export interface ReportLimits {
  /** Lines per section. */
  lines: number;
  /** Lines of the `texts` section. */
  textLines: number;
  lineLen: number;
}

/** Part B: a describer with no time limit. */
export const CEILING_LIMITS: ReportLimits = { lines: 8, textLines: 12, lineLen: 200 };
/** Part C: the brain waits for the report inside the round, so it is shorter. */
export const LIVE_LIMITS: ReportLimits = { lines: 4, textLines: 8, lineLen: 120 };

const LINE_MAX_LEN = 400;
const SECTION_MAX_LINES = 20;

const lineSchema = z
  .object({
    text: z.string().trim().min(1).max(LINE_MAX_LEN),
    frame: z.number().int().min(1).max(99),
  })
  .strict();

const sectionSchema = z.array(lineSchema).max(SECTION_MAX_LINES).default([]);

export const reportSchema = z
  .object({
    sections: z
      .object({
        texts: sectionSchema,
        road: sectionSchema,
        vehicles: sectionSchema,
        poles_signs: sectionSchema,
        buildings: sectionSchema,
        nature: sectionSchema,
        unusual: sectionSchema,
      })
      .strict(),
  })
  .strict();

export type ReportLine = z.infer<typeof lineSchema>;
export type SceneReport = z.infer<typeof reportSchema>;

export function emptyReport(): SceneReport {
  return reportSchema.parse({ sections: {} });
}

/** Every line with its section, in the fixed section order. */
export function reportLines(report: SceneReport): Array<ReportLine & { section: SectionId }> {
  return REPORT_SECTIONS.flatMap(({ id }) =>
    report.sections[id].map((line) => ({ section: id, ...line })),
  );
}

/** The report as the brain may read it, and the words that were masked. */
export function maskReport(
  guard: PlaceGuard,
  report: SceneReport,
): { report: SceneReport; masked: string[] } {
  const masked: string[] = [];
  const sections = Object.fromEntries(
    REPORT_SECTIONS.map(({ id }) => [
      id,
      report.sections[id].map((line) => {
        const res = maskPlaceWords(guard, line.text);
        masked.push(...res.masked);
        return { text: res.text, frame: line.frame };
      }),
    ]),
  ) as SceneReport['sections'];
  return { report: { sections }, masked };
}

export function formatReport(report: SceneReport): string {
  const lines: string[] = [];
  for (const { id, ru } of REPORT_SECTIONS) {
    lines.push(`${ru}:`);
    const section = report.sections[id];
    if (section.length === 0) lines.push('- ничего не отмечено');
    for (const line of section) lines.push(`- ${line.text} (кадр ${line.frame})`);
  }
  return lines.join('\n');
}

/** The rules of a report, shared by the describers of Part B and the eyes of Part C. */
export function reportRules(limits: ReportLimits): string[] {
  return [
    'Не называй и не угадывай место: никаких стран, городов, регионов, народов и языков. Пиши только то, что видно. Письменность называй с существительным: «латиница», «кириллица», «арабская вязь», «иероглифы», «тайское письмо».',
    'Любой текст со снимков переписывай дословно в кавычках-ёлочках «…»: буква в букву, тем же алфавитом, без перевода и исправлений. Если текст не разобрать, не выдумывай: напиши, что надпись есть и какими знаками она написана.',
    'Одна строка — один факт, который видно на снимке, и номер кадра. Без выводов и догадок о месте.',
    'Не пиши о том, чего не видно. Раздел без наблюдений оставь пустым списком.',
    `В разделе не больше ${limits.lines} строк (в texts — не больше ${limits.textLines}); строка не длиннее ${limits.lineLen} знаков.`,
  ];
}

/** The rules as the describers of Part B read them. */
export const REPORT_RULES_RU: readonly string[] = reportRules(CEILING_LIMITS);

export function reportSectionLines(): string[] {
  return REPORT_SECTIONS.map((s) => `- ${s.id} — ${s.hint}.`);
}

/** How a report is returned. Both sample lines are objects: a bare string is not a line. */
export const REPORT_FORMAT_RU =
  'Каждая строка любого раздела — объект с полями text и frame (номер одного кадра, числом); в text номер кадра не повторяй.';

export const REPORT_JSON_EXAMPLE =
  '{"sections":{"texts":[{"text":"«TAXI» — надпись на крыше жёлтой машины","frame":2}],"road":[{"text":"серый асфальт без разметки","frame":1}],"vehicles":[],"poles_signs":[],"buildings":[],"nature":[],"unusual":[]}}';
