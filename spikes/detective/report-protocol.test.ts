import { expect, test } from 'bun:test';
import { loadCatalog } from './catalog.ts';
import { buildBrainPrompt, buildEyesPrompt } from './prompts.ts';
import { hasQuestionForm, parseFinalExtras } from './report-protocol.ts';
import { toolDefinitions } from './tools.ts';

test('a request with a question mark or the particle «ли» has the question form', () => {
  expect(hasQuestionForm('есть ли пальмы')).toBe(true);
  expect(hasQuestionForm('Видно ЛИ море')).toBe(true);
  expect(hasQuestionForm('какие номера у машин?')).toBe(true);
  expect(hasQuestionForm('номера машин: форма и цвета')).toBe(false);
  // «или», «линии», «лица» hold the letters but not the particle.
  expect(hasQuestionForm('линии разметки или бордюры, лица людей')).toBe(false);
});

test('the report protocol gives each role its own tools and the brain no camera', () => {
  const catalog = loadCatalog();
  const brain = toolDefinitions('brain', catalog, 'report').map((t) => t.name);
  const eyes = toolDefinitions('eyes', catalog, 'report').map((t) => t.name);
  expect(brain).toEqual(['briefing', 'ask', 'final_guess']);
  expect(eyes).toEqual(['observe', 'look', 'report', 'next_request', 'answer']);
  expect(toolDefinitions('brain', catalog, 'choice').map((t) => t.name)).toEqual([
    'ask',
    'final_guess',
  ]);
  const ask = toolDefinitions('brain', catalog, 'report')[1];
  expect(JSON.stringify(ask?.inputSchema)).toContain('"describe"');
  expect(JSON.stringify(ask?.inputSchema)).not.toContain('"options"');
});

test('the extra final_guess fields are parsed leniently', () => {
  expect(parseFinalExtras({ confidence: 'country', clue: ' вывеска ' })).toEqual({
    confidence: 'country',
    clue: 'вывеска',
  });
  expect(parseFinalExtras({ confidence: 'certain', clue: '' })).toEqual({
    confidence: null,
    clue: null,
  });
  expect(parseFinalExtras(null)).toEqual({ confidence: null, clue: null });
});

test('the report prompts tell the brain to ask for topics and the eyes never to name a place', () => {
  const brain = buildBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: 20000,
    budgetSec: 90,
    catalog: loadCatalog(),
    protocol: 'report',
  });
  expect(brain).toContain('briefing()');
  expect(brain).toContain('а не вопрос с ожидаемым ответом');
  expect(brain).toContain('control: true');
  expect(brain).not.toContain('"options"');
  const eyes = buildEyesPrompt({ moveLimit: 8, protocol: 'report', requireZoom: true });
  expect(eyes).toContain('никогда не называешь стран');
  expect(eyes).toContain('До отчёта не больше 3 приближений');
  expect(eyes).toContain('не больше 8 look');
  expect(eyes).toContain('в texts — не больше 8');
  expect(eyes).toContain('не подтверждай из вежливости');
});
