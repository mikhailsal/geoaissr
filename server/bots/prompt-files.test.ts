import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDetectiveBrainPrompt, buildDetectiveEyesPrompt } from './detective/prompts.ts';
import {
  PROMPTS_DIR,
  PromptTemplateError,
  loadPrompt,
  renderPromptTemplate,
} from './prompt-files.ts';
import { buildBotRoundPrompt } from './prompt.ts';
import { describePlayAreaRu } from './runner-types.ts';

test('variables, blocks with else, nested blocks and comments render as plain text', () => {
  const template = [
    '{{! a note for whoever edits the file }}',
    'Привет, {{name}}.',
    '{{#if move}}',
    'Ходов: {{limit}}{{#if far}} (дальних тоже){{else}} (только шаги){{/if}}.',
    '{{else}}',
    'Движения нет.',
    '{{/if}}',
    'Конец.',
  ].join('\n');
  const values = { name: 'Бот', limit: 4, move: true, far: false };
  expect(renderPromptTemplate(template, values)).toBe(
    'Привет, Бот.\nХодов: 4 (только шаги).\nКонец.',
  );
  expect(renderPromptTemplate(template, { ...values, far: true })).toContain('(дальних тоже)');
  expect(renderPromptTemplate(template, { ...values, move: false })).toBe(
    'Привет, Бот.\nДвижения нет.\nКонец.',
  );
});

test('a value is inserted as it is, even when it looks like a tag', () => {
  expect(renderPromptTemplate('Имя: {{name}}', { name: '{{limit}} }}' })).toBe('Имя: {{limit}} }}');
});

test('a typo in a template fails with a message that names the file', () => {
  const broken: Array<[string, string]> = [
    ['Ходов: {{limt}}', 'unknown variable {{limt}}'],
    ['{{#if nope}}x{{/if}}', 'unknown variable {{nope}}'],
    ['{{#if move}}x', 'broken tag'],
    ['Ходов: {{ limit }}', 'broken tag'],
    ['{{#if move}}a{{else}}b{{else}}c{{/if}}', 'two {{else}}'],
    // A name in the branch this round does not show is checked too: the typo would otherwise
    // wait for the first round with other settings.
    ['{{#if move}}Ходов: {{limit}}{{else}}Стой: {{limt}}{{/if}}', 'unknown variable {{limt}}'],
    ['{{#if move}}a{{else}}{{#if nope}}b{{/if}}{{/if}}', 'unknown variable {{nope}}'],
    // Only the supplied names count, not what every object inherits.
    ['Имя: {{toString}}', 'unknown variable {{toString}}'],
    ['{{#if constructor}}x{{/if}}', 'unknown variable {{constructor}}'],
  ];
  for (const [template, problem] of broken) {
    let message = '';
    try {
      renderPromptTemplate(template, { limit: 4, move: true }, 'my-prompt.txt');
    } catch (err) {
      expect(err).toBeInstanceOf(PromptTemplateError);
      message = err instanceof Error ? err.message : '';
    }
    expect(message).toContain('my-prompt.txt');
    expect(message).toContain(problem);
  }
});

test('a prompt file is read again on every call, so an edit applies to the next round', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-prompts-'));
  try {
    writeFileSync(path.join(dir, 'p.txt'), 'Первый текст, {{n}}.\n');
    expect(loadPrompt('p.txt', { n: 1 }, dir)).toBe('Первый текст, 1.');
    writeFileSync(path.join(dir, 'p.txt'), 'Второй текст, {{n}}.\n');
    expect(loadPrompt('p.txt', { n: 2 }, dir)).toBe('Второй текст, 2.');
    expect(() => loadPrompt('missing.txt', {}, dir)).toThrow('cannot read the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const INTUIT = {
  botName: 'Claude Haiku 5.5',
  regionLabelRu: 'Европа',
  moveLimit: 4,
  budgetSec: 120,
  personalityPreset: 'neutral',
  personalityText: '',
} as const;

const BRAIN = {
  regionLabelRu: 'Весь мир',
  regionDiagonalKm: 20015.1,
  budgetSec: 120,
  personalityPreset: 'neutral',
  personalityText: '',
} as const;

/** Every combination of the flags a shipped template branches on. */
function renderShipped(): string[] {
  const out: string[] = [];
  for (const moveEnabled of [true, false]) {
    for (const deliveryMode of ['mcp', 'file'] as const) {
      out.push(buildBotRoundPrompt({ ...INTUIT, moveEnabled, deliveryMode }));
    }
  }
  for (const [moveLimit, canMove] of [
    [4, true],
    [4, false],
    [0, false],
  ] as const) {
    out.push(buildDetectiveBrainPrompt({ ...BRAIN, moveLimit, canMove }));
    for (const fileDelivery of [true, false]) {
      out.push(buildDetectiveEyesPrompt({ moveLimit, canMove, fileDelivery }));
    }
  }
  return out;
}

test('the shipped prompt files render for every setting, with no tag or blank line left', () => {
  expect(readdirSync(PROMPTS_DIR).sort()).toEqual([
    'README.md',
    'detective-brain.txt',
    'detective-eyes.txt',
    'intuit.txt',
  ]);
  for (const prompt of renderShipped()) {
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('}}');
    expect(prompt).not.toMatch(/\n\s*\n/);
  }
});

test('the Detective prompts follow the movement setting', () => {
  const withMove = { moveLimit: 4, canMove: true, fileDelivery: false };
  const brain = buildDetectiveBrainPrompt({ ...BRAIN, ...withMove });
  expect(brain).toContain('"kind": "drive"');
  expect(brain).toContain('диагональ региона около 20015 км');
  expect(brain).toContain(
    'Платных ходов у напарника на весь раунд: 4 (приближения и проезды вместе)',
  );
  const eyes = buildDetectiveEyesPrompt(withMove);
  expect(eyes).toContain('observe, look, move, report, next_request и answer');
  expect(eyes).toContain('до отчёта — не больше 3, за весь раунд — не больше 4');
  const still = { moveLimit: 2, canMove: false, fileDelivery: false };
  expect(buildDetectiveBrainPrompt({ ...BRAIN, ...still })).not.toContain('drive');
  const stillEyes = buildDetectiveEyesPrompt(still);
  expect(stillEyes).not.toContain('move');
  expect(stillEyes).toContain('до отчёта — не больше 2, за весь раунд — не больше 2');
  const none = { moveLimit: 0, canMove: false, fileDelivery: false };
  expect(buildDetectiveBrainPrompt({ ...BRAIN, ...none })).toContain('нет платных ходов');
  expect(buildDetectiveEyesPrompt(none)).toContain('Платных ходов в этой партии нет');
});

test('the eyes on agy are told to open the frame files, and only those', () => {
  const opts = { moveLimit: 4, canMove: true };
  const files = buildDetectiveEyesPrompt({ ...opts, fileDelivery: true });
  expect(files).toContain('read_file только для файлов кадров');
  expect(files).toContain('сразу прочитай их через read_file');
  expect(buildDetectiveEyesPrompt({ ...opts, fileDelivery: false })).not.toContain('read_file');
});

// Value: protects=a bot is told the map of the match, and the standard map's prompt carries no extra words; fails_when=the map note is dropped, or the standard prompt changes and old eval runs stop being comparable;
// why_new=a match had no map; seam=none; no_claim=what a model does with the note
test('the prompt names the map of the match, except the standard one', () => {
  expect(describePlayAreaRu({ map: 'standard', region: 'world' })).toBe('Весь мир');
  expect(describePlayAreaRu({ map: 'standard', region: 'country:JPN' })).toBe('Япония');
  expect(describePlayAreaRu({ map: 'capitals', region: 'europe' })).toBe(
    'Европа; карта «Столицы»: только столицы стран',
  );
  const base = { ...INTUIT, moveEnabled: false, deliveryMode: 'mcp' as const };
  const standard = buildBotRoundPrompt({
    ...base,
    regionLabelRu: describePlayAreaRu({ map: 'standard', region: 'europe' }),
  });
  expect(standard).toContain('(регион партии: Европа).');
  expect(standard).not.toContain('карта «');
  const airports = buildBotRoundPrompt({
    ...base,
    regionLabelRu: describePlayAreaRu({ map: 'airports', region: 'europe' }),
  });
  expect(airports).toContain(
    '(регион партии: Европа; карта «Аэропорты мира»: не дальше 5 км от аэропорта с регулярными рейсами).',
  );
  const brain = buildDetectiveBrainPrompt({
    ...BRAIN,
    moveLimit: 4,
    canMove: true,
    regionLabelRu: describePlayAreaRu({ map: 'north', region: 'world' }),
  });
  expect(brain).toContain('регион партии: Весь мир; карта «Север»: только севернее 60°');
});
