import { expect, test } from 'bun:test';
import { loadCatalog } from './catalog.ts';
import { buildBrainPrompt, buildEyesPrompt } from './prompts.ts';
import { DRIVING_SIDE_LINE, NOT_DETERMINED, SUN_LINE } from './report-prompts.ts';
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
  expect(eyes).toContain('Охота за текстом — обязательный шаг до отчёта');
  expect(brain).toContain('Не заканчивай рано');
});

// Value: protects=the brain is told what it is scored on, that the clue list is open, and that the driving side and the sun come as fixed report lines the eyes must write; fails_when=the goal line, the invitation to improvise or either required line leaves a prompt, or the two roles stop agreeing on the words the lines start with; seam=none; no_claim=presence does not prove that a model complies.
test('the report prompts state the goal and make the driving side and the sun required lines', () => {
  const brain = buildBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: 20000,
    budgetSec: 90,
    catalog: loadCatalog(),
    protocol: 'report',
  });
  const eyes = buildEyesPrompt({ moveLimit: 8, protocol: 'report', requireZoom: true });
  expect(brain).toContain('как можно ближе');
  expect(brain).toContain('оценивается только расстояние');
  expect(brain).toContain('Этот список не полный');
  expect(brain).toContain('Придумывай свои темы и проверки');
  for (const prompt of [brain, eyes]) {
    expect(prompt).toContain(DRIVING_SIDE_LINE);
    expect(prompt).toContain(SUN_LINE);
    expect(prompt).toContain(NOT_DETERMINED);
  }
  expect(brain).toContain('северное полушарие');
  expect(eyes).toContain('Две строки обязательны в каждом отчёте');
  expect(eyes).toContain(`«${SUN_LINE} на юге, высоко»`);
  // Plates are blurred on real imagery: they are no longer the model request.
  expect(brain).not.toContain('"topic": "номера машин');
});

// Value: protects=a spot whose frame labels are not real compass directions cannot produce a hemisphere claim from the sun; fails_when=the hemisphere rule or a compass side reaches the prompts of such a round; seam=none; no_claim=presence does not prove that a model complies.
test('without a real compass the prompts take the hemisphere rule away', () => {
  const brain = buildBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: 20000,
    budgetSec: 90,
    catalog: loadCatalog(),
    protocol: 'report',
    compassKnown: false,
  });
  const eyes = buildEyesPrompt({
    moveLimit: 8,
    protocol: 'report',
    requireZoom: true,
    compassKnown: false,
  });
  expect(brain).not.toContain('северное полушарие');
  expect(brain).toContain('о полушарии по ней не суди');
  expect(eyes).not.toContain('на юге, высоко');
  expect(eyes).toContain('стороны света не называй');
  expect(eyes).toContain(DRIVING_SIDE_LINE);
});
