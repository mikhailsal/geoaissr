import { expect, test } from 'bun:test';
import { createPlaceGuard, maskPlaceWords } from './guard.ts';
import { modelCallCmd } from './model-call.ts';
import {
  REPORT_SECTIONS,
  emptyReport,
  formatReport,
  maskReport,
  reportLines,
  reportSchema,
} from './report.ts';

const guard = createPlaceGuard();

test('a place word in the eyes own words is masked; copied text in «…» is kept', () => {
  const res = maskPlaceWords(guard, 'Японские дома и вывеска «Токио банк», рядом флаг Японии');
  expect(res.text).toBe('[…] дома и вывеска «Токио банк», рядом флаг […]');
  expect(res.masked).toEqual(['японские', 'японии']);
  expect(maskPlaceWords(guard, '«Добро пожаловать в Тбилиси»').masked).toEqual([]);
});

test('script names and ordinary scene words are not masked', () => {
  for (const text of [
    'вывеска: арабская вязь и латиница',
    'на северном кадре лесополоса, за лесом россыпь камней',
    'катафоты на столбиках, тень от камеры на асфальте',
    'плантация сахарного тростника, несколько марок машин',
    'канатная дорога на западном склоне',
    'надпись катаканой на вывеске, косой навес, рядом костёл с белёной стеной',
    'у причала стоят суда, на берегу следы костра',
  ]) {
    expect(maskPlaceWords(guard, text)).toEqual({ text, masked: [] });
  }
  expect(maskPlaceWords(guard, 'табличка как в Камеруне').masked).toEqual(['камеруне']);
  expect(maskPlaceWords(guard, 'Северная Корея').text).toBe('Северная […]');
});

test('a report parses with missing sections and refuses unknown ones', () => {
  const report = reportSchema.parse({
    sections: { texts: [{ text: '«TAXI» — на машине', frame: 2 }], road: [] },
  });
  expect(report.sections.nature).toEqual([]);
  expect(reportLines(report)).toEqual([{ section: 'texts', text: '«TAXI» — на машине', frame: 2 }]);
  expect(reportSchema.safeParse({ sections: { guess: [] } }).success).toBe(false);
  expect(reportSchema.safeParse({ sections: { road: [{ text: 'x', frame: 0 }] } }).success).toBe(
    false,
  );
});

test('the brain reads a masked report with every section named', () => {
  const report = emptyReport();
  report.sections.texts.push({ text: '«ローソン» — вывеска', frame: 1 });
  report.sections.buildings.push({ text: 'дома как в Японии', frame: 3 });
  const res = maskReport(guard, report);
  expect(res.masked).toEqual(['японии']);
  const text = formatReport(res.report);
  expect(text).toContain('Текст дословно:\n- «ローソン» — вывеска (кадр 1)');
  expect(text).toContain('Дома:\n- дома как в […] (кадр 3)');
  expect(text).toContain('Природа:\n- ничего не отмечено');
  for (const section of REPORT_SECTIONS) expect(text).toContain(`${section.ru}:`);
  // The stored report is not changed by the masking.
  expect(report.sections.buildings[0]?.text).toBe('дома как в Японии');
});

test('the judge call keeps its command line; a call without tools sets the effort', () => {
  expect(modelCallCmd({ prompt: 'P', model: 'claude-opus-5-5', readDir: '/data' })).toEqual([
    'claude',
    '-p',
    'P',
    '--model',
    'claude-opus-5-5',
    '--tools',
    'Read',
    '--allowedTools',
    'Read',
    '--add-dir',
    '/data',
    '--strict-mcp-config',
    '--permission-mode',
    'bypassPermissions',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--output-format',
    'json',
  ]);
  const cmd = modelCallCmd({ prompt: 'P', model: 'm', readDir: null, effort: 'low' });
  expect(cmd.slice(3, 9)).toEqual(['--model', 'm', '--effort', 'low', '--tools', '']);
  expect(cmd).not.toContain('--add-dir');
});
