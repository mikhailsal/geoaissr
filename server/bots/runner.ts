import type { BotCostEstimate, BotTokenUsage } from '../../shared/bot-results.ts';
import type { EngineEvent } from '../engine/types.ts';
import type { BotImageService } from '../images/bot-image-service.ts';
import type { LocationService } from '../location.ts';
import type { ServerLogger } from '../log.ts';
import { createBotToolApiServer } from './api.ts';
import type { CustomBotLaunchBuilder } from './process.ts';
import { dispatchLaunchFailure, launchBotProcess, stopBotHandle } from './runner-launch.ts';
import type { BotRunner, RunnerCtx } from './runner-types.ts';
import { runVisionCheck } from './vision-check.ts';

export type { BotRunner } from './runner-types.ts';

export function createBotRunner(opts: {
  runDir: string;
  childrenFile: string;
  fakeMode: boolean;
  fakeStepDelayMs?: number;
  imageService: BotImageService;
  locationService: LocationService;
  dispatch: (event: EngineEvent) => void;
  logger?: ServerLogger;
  buildCustomLaunchSpec?: CustomBotLaunchBuilder;
  estimateCost?: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate>;
}): BotRunner {
  const ctx: RunnerCtx = {
    ...opts,
    api: createBotToolApiServer(),
    activeHandles: new Map(),
    activeVisionChecks: new Map(),
  };

  let closed = false;
  return {
    startRoundBots({ matchId, gen, roundNumber, target, bots, moveEnabled }) {
      if (closed) return;
      for (const slot of bots) {
        const params = { matchId, gen, roundNumber, target, slot, moveEnabled };
        try {
          launchBotProcess(ctx, params);
        } catch (err) {
          // One bot failing to launch (e.g. disk full) must not block the others.
          dispatchLaunchFailure(ctx, params, err);
        }
      }
    },
    releaseObserve(matchId, gen, roundNumber) {
      const now = Date.now();
      for (const h of ctx.activeHandles.values()) {
        if (h.matchId === matchId && h.gen === gen && h.roundNumber === roundNumber) {
          h.setStartedAt(now);
          h.releaseObserve();
        }
      }
    },
    stopBot(matchId, gen, botId, reason) {
      const h = ctx.activeHandles.get(botId);
      if (!h || h.matchId !== matchId || h.gen !== gen) return;
      void stopBotHandle(ctx, h, reason);
    },
    async stopAll(reason) {
      const stops = [...ctx.activeHandles.values()].map((h) => stopBotHandle(ctx, h, reason));
      await Promise.allSettled(stops);
    },
    runVisionCheck: (slot) => {
      if (closed) {
        return Promise.resolve({ passed: false, elapsedMs: 0, message: 'Сервер останавливается' });
      }
      const ac = new AbortController();
      const promise = runVisionCheck({
        runDir: ctx.runDir,
        childrenFile: ctx.childrenFile,
        fakeMode: ctx.fakeMode,
        api: ctx.api,
        slot,
        signal: ac.signal,
      }).finally(() => {
        ctx.activeVisionChecks.delete(ac);
      });
      ctx.activeVisionChecks.set(ac, promise);
      return promise;
    },
    getApiBaseUrl: () => ctx.api.baseUrl,
    async close() {
      closed = true;
      for (const ac of ctx.activeVisionChecks.keys()) {
        ac.abort();
      }
      await Promise.allSettled([this.stopAll('runner_closed'), ...ctx.activeVisionChecks.values()]);
      ctx.api.close();
    },
  };
}

export type { CustomBotLaunchBuilder } from './process.ts';
