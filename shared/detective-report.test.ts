// Value: protects=scene report schema and the fixed section order of flattenReport; fails_when=a section is dropped, reordered, or an unknown key or frame 0 is accepted; why_new=session tests feed reports but never test the schema; seam=none; no_claim=prompt wording
import { expect, test } from 'bun:test';
import {
  REPORT_SECTIONS,
  flattenReport,
  reportSectionTitleRu,
  sceneReportSchema,
} from './detective-report.ts';

test('missing sections default to empty and lines come out in the fixed section order', () => {
  const parsed = sceneReportSchema.parse({
    sections: {
      nature: [{ text: 'пальмы', frame: 3 }],
      texts: [{ text: ' LAWSON ', frame: 1 }],
    },
  });
  expect(flattenReport(parsed)).toEqual([
    { section: 'texts', text: 'LAWSON', frame: 1 },
    { section: 'nature', text: 'пальмы', frame: 3 },
  ]);
  expect(REPORT_SECTIONS.map((s) => s.id)[0]).toBe('texts');
});

test('a report with an unknown section, a blank line, frame 0 or 21 lines is refused', () => {
  const line = { text: 'знак', frame: 1 };
  const bad = [
    { sections: { sky: [line] } },
    { sections: { road: [{ text: '  ', frame: 1 }] } },
    { sections: { road: [{ text: 'знак', frame: 0 }] } },
    { sections: { road: Array.from({ length: 21 }, () => line) } },
    { sections: { road: [{ ...line, extra: 1 }] } },
    { sections: {}, extra: 1 },
  ];
  for (const report of bad) expect(sceneReportSchema.safeParse(report).success).toBe(false);
});

test('a section title is Russian, and an unknown id is shown as it is', () => {
  expect(reportSectionTitleRu('poles_signs')).toBe('Столбы и знаки');
  expect(reportSectionTitleRu('mystery')).toBe('mystery');
});
