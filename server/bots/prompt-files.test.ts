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
    out.push(buildDetectiveEyesPrompt({ moveLimit, canMove }));
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
  const withMove = { moveLimit: 4, canMove: true };
  const brain = buildDetectiveBrainPrompt({ ...BRAIN, ...withMove });
  expect(brain).toContain('"kind": "drive"');
  expect(brain).toContain('диагональ региона около 20015 км');
  expect(brain).toContain(
    'Платных ходов у напарника на весь раунд: 4 (приближения и проезды вместе)',
  );
  const eyes = buildDetectiveEyesPrompt(withMove);
  expect(eyes).toContain('observe, look, move, report, next_request и answer');
  expect(eyes).toContain('до отчёта — не больше 3, за весь раунд — не больше 4');
  const still = { moveLimit: 2, canMove: false };
  expect(buildDetectiveBrainPrompt({ ...BRAIN, ...still })).not.toContain('drive');
  const stillEyes = buildDetectiveEyesPrompt(still);
  expect(stillEyes).not.toContain('move');
  expect(stillEyes).toContain('до отчёта — не больше 2, за весь раунд — не больше 2');
  const none = { moveLimit: 0, canMove: false };
  expect(buildDetectiveBrainPrompt({ ...BRAIN, ...none })).toContain('нет платных ходов');
  expect(buildDetectiveEyesPrompt(none)).toContain('Платных ходов в этой партии нет');
});
