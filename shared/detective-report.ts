import { z } from 'zod';

/**
 * The scene report of the Detective play style: what the eyes write about a scene in their own
 * words before any request. The sections are fixed and every line names the frame it was seen in.
 */
export const REPORT_SECTIONS = [
  { id: 'texts', ru: 'Текст дословно' },
  { id: 'road', ru: 'Дорога' },
  { id: 'vehicles', ru: 'Машины и номера' },
  { id: 'poles_signs', ru: 'Столбы и знаки' },
  { id: 'buildings', ru: 'Дома' },
  { id: 'nature', ru: 'Природа' },
  { id: 'unusual', ru: 'Необычное' },
] as const;

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id'];

export const REPORT_SECTION_IDS = REPORT_SECTIONS.map((s) => s.id) as [
  ReportSectionId,
  ...ReportSectionId[],
];

/** The schema allows more than the prompt asks for, so a long line is not a failed call. */
const LINE_MAX_LEN = 400;
const SECTION_MAX_LINES = 20;

const lineSchema = z
  .object({
    text: z.string().trim().min(1).max(LINE_MAX_LEN),
    frame: z.number().int().min(1).max(99),
  })
  .strict();

const sectionSchema = z.array(lineSchema).max(SECTION_MAX_LINES).default([]);

export const sceneReportSchema = z
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

export type SceneReportLine = z.infer<typeof lineSchema>;
export type SceneReport = z.infer<typeof sceneReportSchema>;

/** One report line as the journal stores it. */
export interface FlatReportLine extends SceneReportLine {
  section: ReportSectionId;
}

/** Every line with its section, in the fixed section order. */
export function flattenReport(report: SceneReport): FlatReportLine[] {
  return REPORT_SECTIONS.flatMap(({ id }) =>
    report.sections[id].map((line) => ({ section: id, ...line })),
  );
}

export function reportSectionTitleRu(id: string): string {
  return REPORT_SECTIONS.find((s) => s.id === id)?.ru ?? id;
}
