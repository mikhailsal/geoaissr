import { expect, test } from 'bun:test';
import { getBotToolDefinitions } from '../../shared/bot-tools.ts';
import { buildBotRoundPrompt } from './prompt.ts';

// Regression: ISSUE-003, ISSUE-005
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects the real prompt and advertised schemas; does not establish model compliance or clue quality.
test('file prompt requests a quick evidence-based draft and concrete, honest comparisons', () => {
  const prompt = buildBotRoundPrompt({
    botName: 'Bot',
    regionLabelRu: 'Мир',
    moveEnabled: true,
    moveLimit: 2,
    budgetSec: 60,
    personalityPreset: 'neutral',
    personalityText: '',
    deliveryMode: 'file',
  });
  expect(prompt).toContain('read_file только для файлов изображений, полученных от игры');
  expect(prompt.toLowerCase()).toContain('сразу после просмотра');
  expect(prompt).toContain('не дожидаясь исчерпания');
  expect(prompt).toContain('конкретный видимый признак');
  expect(prompt).toContain('не выдумывай');
  expect(prompt).not.toContain('rejected_guesses (2–3 версии)');
  for (const name of ['draft_guess', 'final_guess']) {
    const definition = getBotToolDefinitions().find((tool) => tool.name === name);
    expect(definition?.inputSchema.required).not.toContain('rejected_guesses');
  }
});

// Regression: ISSUE-003, ISSUE-005
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects useful reasoning from being discarded when a model exceeds length limits or sends one malformed alternative.
test('ingress retains bounded reasoning and valid alternatives', async () => {
  const { parseGuessInput } = await import('../../shared/bot-tools.ts');
  const result = parseGuessInput({
    lat: 1,
    lng: 2,
    facts: 'a'.repeat(1001),
    conclusion: 'b'.repeat(601),
    rejected_guesses: [
      { guess: 'c'.repeat(121), reason: 'd'.repeat(301) },
      { guess: 'invalid' },
      { guess: 'valid', reason: 'visible sign' },
    ],
  });
  expect(result?.facts).toHaveLength(1000);
  expect(result?.conclusion).toHaveLength(600);
  expect(result?.rejectedGuesses).toEqual([
    { guess: 'c'.repeat(120), reason: 'd'.repeat(300) },
    { guess: 'valid', reason: 'visible sign' },
  ]);
});
