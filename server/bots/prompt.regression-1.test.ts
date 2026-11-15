import { expect, test } from 'bun:test';
import { getBotToolDefinitions } from '../../shared/bot-tools.ts';
import { buildBotRoundPrompt } from './prompt.ts';

// Regression: ISSUE-003, ISSUE-005
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects the real prompt and advertised schemas; does not establish model compliance or clue quality.
// Value: protects=MCP prompt excludes file access while retaining inline images; fails_when=read_file leaks into MCP tools; why_new=existing test checked MCP image wording only; seam=none; no_claim=prompt text does not verify runtime tool enforcement.
test('file prompt requests a quick evidence-based draft and concrete, honest comparisons', () => {
  const options = {
    botName: 'Bot',
    regionLabelRu: 'Мир',
    moveEnabled: true,
    moveLimit: 2,
    budgetSec: 60,
    personalityPreset: 'neutral',
    personalityText: '',
  } as const;
  const prompt = buildBotRoundPrompt({ ...options, deliveryMode: 'file' });
  const mcpPrompt = buildBotRoundPrompt({ ...options, deliveryMode: 'mcp' });
  expect(prompt).toContain('read_file только для файлов изображений, полученных от игры');
  expect(mcpPrompt).toContain('Изображения придут прямо в ответе MCP-инструмента.');
  expect(mcpPrompt).not.toContain('read_file');
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
// Value: protects=parser keeps no more than three valid alternatives; fails_when=fourth valid item is retained; why_new=existing case had only two valid alternatives; seam=none; no_claim=does not prove model clue quality.
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
      { guess: 'third', reason: 'second visible sign' },
      { guess: 'fourth', reason: 'fourth visible sign' },
    ],
  });
  expect(result?.facts).toHaveLength(1000);
  expect(result?.conclusion).toHaveLength(600);
  expect(result?.rejectedGuesses).toEqual([
    { guess: 'c'.repeat(120), reason: 'd'.repeat(300) },
    { guess: 'valid', reason: 'visible sign' },
    { guess: 'third', reason: 'second visible sign' },
  ]);
});
