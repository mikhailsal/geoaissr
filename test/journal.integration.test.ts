// Value: protects=the step journal end to end through the MCP bridge, HTTP tool API and production queue; fails_when=queue, bridge or engine fold drops a journal field or the correction code; why_new=the fake bot bypasses the queue; seam=none; no_claim=how each CLI shows isError to its model.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import type { JournalStep } from '../shared/bot-journal.ts';
import type { BotSlotConfig } from '../shared/storage-schemas.ts';
import { createBotImageService, type BotImageService } from '../server/images/bot-image-service.ts';
import { createBotRunner } from '../server/bots/runner.ts';
import { addFindingToJournal, addThumbToJournal } from '../server/engine/journal.ts';
import type { EngineEvent } from '../server/engine/types.ts';
import { createThumbStore } from '../server/http/thumbs.ts';
import { createFakeLocationService } from '../server/location.ts';
import { createQuotaManager } from '../server/storage/quota.ts';
import { connectBridgeMcp, type McpToolCallResult } from './fake-harness.ts';

type CallTool = (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;

const POINT = { lat: 48.1, lng: 11.5 };
const CAMERA = { heading: 90, pitch: 0, fov: 60, hypothesis: 'Проверяю дорожный знак справа.' };

function slot(moveLimit: number): BotSlotConfig {
  return {
    id: 'slot-j',
    name: 'Журнал',
    color: 'p-4',
    harness: 'claude',
    model: 'haiku',
    effort: 'low',
    moveLimit,
    imageSize: 400,
    budgetSec: 90,
    personalityPreset: 'neutral',
    personalityText: '',
    difficultyPreset: 'amateur',
    enabled: true,
  };
}

function textOf(res: McpToolCallResult): string {
  return res.content.map((c) => c.text ?? '').join('\n');
}

/** Folds the engine events the runner dispatched into journal steps, as the reducer does. */
function foldJournal(events: readonly EngineEvent[]): JournalStep[] {
  let steps: JournalStep[] = [];
  for (const e of events) {
    if (e.type === 'bot_thumb_added') steps = addThumbToJournal(steps, e.thumb, 0);
    if (e.type === 'bot_finding') steps = addFindingToJournal(steps, e);
  }
  return steps;
}

/**
 * Starts one bot whose "CLI" only sleeps; the test itself plays the model through the real
 * MCP bridge (`bot-tools/main.ts`) against the runner's HTTP tool API.
 */
async function withBridgeBot(
  opts: { moveLimit: number; brokenLook?: boolean },
  play: (callTool: CallTool) => Promise<void>,
): Promise<EngineEvent[]> {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-journal-int-'));
  const events: EngineEvent[] = [];
  const loc = createFakeLocationService();
  const baseImages = createBotImageService({
    serverKey: '',
    fakeMode: true,
    quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
    thumbStore: createThumbStore(),
  });
  const images: BotImageService = opts.brokenLook
    ? { ...baseImages, getLookView: () => Promise.reject(new Error('Кадр недоступен')) }
    : baseImages;
  const launch = { apiUrl: '', token: '' };
  const runner = createBotRunner({
    runDir: path.join(dir, 'run'),
    childrenFile: path.join(dir, 'run', 'children.json'),
    fakeMode: false,
    imageService: images,
    locationService: loc,
    dispatch: (e) => events.push(e),
    buildCustomLaunchSpec: ({ apiUrl, botToken }) => {
      launch.apiUrl = apiUrl;
      launch.token = botToken;
      return { cmd: [process.execPath, '-e', 'await Bun.sleep(30000);'], cwd: dir };
    },
  });
  try {
    const target = await loc.prepareRoundLocation({ region: 'europe', excludeCountryIds: [] });
    await images.prepareStartViews(target);
    runner.startRoundBots({
      matchId: 'm-j',
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: opts.moveLimit > 0,
      bots: [slot(opts.moveLimit)],
    });
    runner.releaseObserve('m-j', 1, 1);
    const conn = await connectBridgeMcp({
      apiUrl: launch.apiUrl,
      botToken: launch.token,
      workDir: dir,
    });
    try {
      await play(conn.callTool);
    } finally {
      await conn.close().catch(() => undefined);
    }
    return events;
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const FINAL = {
  lat: 48.14,
  lng: 11.58,
  finding: 'Знак на немецком и баварские флаги.',
  summary: 'Я увидел немецкий знак и баварские флаги, поэтому ставлю под Мюнхен.',
};

test('a look without a finding is corrected once over the bridge, then accepted with a marker', async () => {
  const events = await withBridgeBot({ moveLimit: 4 }, async (callTool) => {
    expect((await callTool('observe', {})).isError ?? false).toBe(false);
    const bounced = await callTool('look', { ...CAMERA, current_guess: POINT });
    expect(bounced.isError).toBe(true);
    expect(textOf(bounced)).toContain('GEO_BOT_JOURNAL_FIELD_MISSING');
    expect(textOf(bounced)).toContain('finding');
    const accepted = await callTool('look', { ...CAMERA, current_guess: POINT });
    expect(accepted.isError ?? false).toBe(false);
    expect((await callTool('final_guess', FINAL)).isError ?? false).toBe(false);
  });
  const steps = foldJournal(events);
  expect(steps.map((s) => [s.index, s.kind, s.findingState])).toEqual([
    [0, 'observe', 'missing'],
    [1, 'look', 'recorded'],
  ]);
  expect(steps[0]?.currentGuess).toEqual(POINT);
  expect(steps[1]?.reason).toBe(CAMERA.hypothesis);
  expect(steps[1]?.finding).toBe(FINAL.finding);
  const guesses = events.filter((e) => e.type === 'bot_guess_recorded');
  expect(guesses.map((e) => e.finalized)).toEqual([false, true]);
}, 20_000);

test('with a zero move limit the final finding lands on the first-look step', async () => {
  const events = await withBridgeBot({ moveLimit: 0 }, async (callTool) => {
    await callTool('observe', {});
    const look = await callTool('look', {
      ...CAMERA,
      finding: 'Видны горы.',
      current_guess: POINT,
    });
    expect(look.isError).toBe(true);
    expect((await callTool('final_guess', FINAL)).isError ?? false).toBe(false);
  });
  const steps = foldJournal(events);
  expect(steps).toHaveLength(1);
  expect(steps[0]?.kind).toBe('observe');
  expect(steps[0]?.frames).toHaveLength(4);
  expect(steps[0]?.findingState).toBe('recorded');
  expect(steps[0]?.finding).toBe(FINAL.finding);
}, 20_000);

test('an unavailable look frame keeps the accepted finding and a retry does not duplicate it', async () => {
  const events = await withBridgeBot({ moveLimit: 4, brokenLook: true }, async (callTool) => {
    await callTool('observe', {});
    const args = { ...CAMERA, finding: 'Видны горы и ели.', current_guess: POINT };
    const first = await callTool('look', args);
    expect(first.isError).toBe(true);
    expect(textOf(first)).toContain('Кадр недоступен');
    await callTool('look', args);
    expect((await callTool('final_guess', FINAL)).isError ?? false).toBe(false);
  });
  const lookFindings = events.filter(
    (e) => e.type === 'bot_finding' && e.finding === 'Видны горы и ели.',
  );
  expect(lookFindings).toHaveLength(1);
  expect(lookFindings[0]?.type === 'bot_finding' && lookFindings[0].turn).toBe(0);
  // No frame arrived, so no look step exists and the final finding is again about step 0.
  const steps = foldJournal(events);
  expect(steps.some((s) => s.kind === 'look')).toBe(false);
  expect(steps[0]?.findingState).toBe('recorded');
}, 20_000);
