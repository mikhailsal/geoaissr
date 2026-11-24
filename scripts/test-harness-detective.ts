import path from 'node:path';
import type { BotSlotConfig, HarnessId } from '../shared/storage-schemas.ts';
import { getHarnessAdapter } from '../server/bots/adapters/index.ts';
import { createBotRunner } from '../server/bots/runner.ts';
import type { EngineEvent } from '../server/engine/types.ts';
import { createThumbStore } from '../server/http/thumbs.ts';
import { createBotImageService } from '../server/images/bot-image-service.ts';
import { createFakeLocationService } from '../server/location.ts';
import type { ServerLogger } from '../server/log.ts';
import { createQuotaManager } from '../server/storage/quota.ts';

/**
 * One real Detective round on fake images: the brain on one harness, the eyes on the same or
 * another. It checks the plumbing (both processes start, the report and the requests pass through
 * the server, the brain guesses, both report tokens), not how well the bot plays.
 */

export interface DetectivePair {
  brain: { harness: HarnessId; model?: string | undefined };
  eyes: { harness: HarnessId; model?: string | undefined };
}

const BUDGET_SEC = 120;

function detectiveSlot(pair: DetectivePair): BotSlotConfig {
  const brainModel = pair.brain.model ?? getHarnessAdapter(pair.brain.harness).defaultModel;
  const eyesModel = pair.eyes.model ?? getHarnessAdapter(pair.eyes.harness).defaultModel;
  const sameAsBrain = pair.eyes.harness === pair.brain.harness && eyesModel === brainModel;
  return {
    id: `detective-${pair.brain.harness}-${pair.eyes.harness}`,
    name: 'Детектив',
    color: 'p-4',
    harness: pair.brain.harness,
    model: brainModel,
    effort: 'low',
    moveLimit: 4,
    imageSize: 640,
    budgetSec: BUDGET_SEC,
    playStyle: 'detective',
    ...(sameAsBrain ? {} : { eyes: { harness: pair.eyes.harness, model: eyesModel } }),
    personalityPreset: 'neutral',
    personalityText: '',
    difficultyPreset: 'custom',
    enabled: true,
  };
}

/** What the round showed, in one line per fact. */
function summarize(events: readonly EngineEvent[], elapsedMs: number): string[] {
  const finished = events.find((e) => e.type === 'bot_finished');
  const guess = events.filter((e) => e.type === 'bot_guess_recorded').at(-1);
  const patches = events.filter((e) => e.type === 'bot_step_patched');
  const reported = patches.some((e) => e.turn === 0 && e.patch.report !== undefined);
  const asks = new Set(patches.filter((e) => e.turn > 0).map((e) => e.turn)).size;
  const settled = patches
    .flatMap((e) => e.patch.requests ?? [])
    .filter((r) => r.status !== 'pending')
    .map((r) => `${r.kind}:${r.status}`);
  const accounting = events.filter((e) => e.type === 'bot_accounting').at(-1)?.accounting;
  const isolation = events.some((e) => e.type === 'bot_isolation_unconfirmed');
  return [
    `finished: ${finished ? `${finished.reason}${finished.aborted ? ' (aborted)' : ''}` : 'no'} in ${String(Math.round(elapsedMs / 1000))} s`,
    `report: ${reported ? 'yes' : 'no'}; asks: ${String(asks)}; answers: ${settled.join(', ') || 'none'}`,
    `final guess: ${guess?.finalized ? 'yes' : 'no'}`,
    `tokens: brain ${String(accounting?.roleUsage?.brain?.totalTokens ?? 'n/a')}, eyes ${String(accounting?.roleUsage?.eyes?.totalTokens ?? 'n/a')}`,
    `isolation: ${isolation ? 'UNCONFIRMED' : 'ok'}`,
  ];
}

/** Prints how each role ended and what its usage parser saw; the rest of the log is dropped. */
function exitLogger(label: string, logsDir: string): ServerLogger {
  return {
    log: (event, data) => {
      if (event !== 'harness_end' && event !== 'harness_usage') return;
      const { role, exitCode, durationMs, status, rawCounters } = data;
      const detail =
        event === 'harness_end'
          ? `exit ${String(exitCode)} after ${String(Math.round(Number(durationMs) / 1000))} s`
          : `usage ${String(status)} ${JSON.stringify(rawCounters)}`;
      console.log(`[detective ${label}] ${String(role)}: ${detail}`);
    },
    writeCrash: () => '',
    pruneOld: () => 0,
    registerSecrets: () => undefined,
    redact: (text) => text,
    getLogsDir: () => logsDir,
  };
}

export async function verifyDetective(pair: DetectivePair, root: string): Promise<boolean> {
  const label = `${pair.brain.harness}+${pair.eyes.harness}`;
  const sub = path.join(root, `detective-${label}`);
  const events: EngineEvent[] = [];
  const loc = createFakeLocationService();
  const images = createBotImageService({
    serverKey: '',
    fakeMode: true,
    quotaManager: createQuotaManager(path.join(sub, 'quota.json')),
    thumbStore: createThumbStore(),
  });
  const runner = createBotRunner({
    runDir: path.join(sub, 'run'),
    childrenFile: path.join(sub, 'children.json'),
    fakeMode: false,
    imageService: images,
    locationService: loc,
    dispatch: (e) => events.push(e),
    logger: exitLogger(label, sub),
  });
  const slot = detectiveSlot(pair);
  const eyes = slot.eyes ?? { harness: slot.harness, model: slot.model };
  console.log(
    `[detective ${label}] brain ${slot.harness} · ${slot.model}, eyes ${eyes.harness} · ${eyes.model}`,
  );
  const t0 = Date.now();
  try {
    const target = await loc.prepareRoundLocation({ region: 'europe', excludeCountryIds: [] });
    await images.prepareStartViews(target);
    const ids = { matchId: `detective-${label}`, gen: 1, roundNumber: 1 };
    runner.startRoundBots({ ...ids, target, bots: [slot], moveEnabled: true });
    runner.releaseObserve(ids.matchId, 1, 1);
    // The engine would stop the bot at its budget; here the script waits a little longer.
    const deadline = t0 + (BUDGET_SEC + 30) * 1000;
    while (Date.now() < deadline && !events.some((e) => e.type === 'bot_finished')) {
      await Bun.sleep(250);
    }
  } finally {
    await runner.close();
  }
  for (const line of summarize(events, Date.now() - t0))
    console.log(`[detective ${label}] ${line}`);
  const finished = events.find((e) => e.type === 'bot_finished');
  const final = events.some((e) => e.type === 'bot_guess_recorded' && e.finalized);
  return (
    Boolean(finished && !finished.aborted && final) &&
    !events.some((e) => e.type === 'bot_isolation_unconfirmed')
  );
}
