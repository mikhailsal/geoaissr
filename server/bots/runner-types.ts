import type { BotCostEstimate, BotTokenUsage } from '../../shared/bot-results.ts';
import type { BotSlotConfig, RegionId } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotImageService } from '../images/bot-image-service.ts';
import type { LocationService } from '../location.ts';
import type { ServerLogger } from '../log.ts';
import type { BotToolApiServer } from './api.ts';
import type { ActiveBotHandle, CustomBotLaunchBuilder } from './process.ts';

export const REGION_LABELS_RU: Record<RegionId, string> = {
  world: 'Весь мир',
  europe: 'Европа',
  asia: 'Азия',
  north_america: 'Северная Америка',
  south_america: 'Южная Америка',
  africa: 'Африка',
  oceania: 'Океания',
};

export interface BotRunner {
  startRoundBots: (opts: {
    matchId: string;
    gen: number;
    roundNumber: number;
    target: RoundTarget;
    bots: BotSlotConfig[];
    moveEnabled: boolean;
  }) => void;
  releaseObserve: (matchId: string, gen: number, roundNumber: number) => void;
  /** The engine shortened the round: remaining time and the urgent nudge use `atMs` from now on. */
  setRoundDeadline: (matchId: string, gen: number, roundNumber: number, atMs: number) => void;
  stopBot: (matchId: string, gen: number, botId: string, reason: string) => void;
  stopAll: (reason: string) => Promise<void>;
  runVisionCheck: (
    bot: BotSlotConfig,
  ) => Promise<{ passed: boolean; elapsedMs: number; message: string }>;
  getApiBaseUrl: () => string;
  close: () => Promise<void>;
}

export interface RunnerCtx {
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
  api: BotToolApiServer;
  activeHandles: Map<string, ActiveBotHandle>;
  activeVisionChecks: Map<AbortController, Promise<unknown>>;
}

export interface RoundBotParams {
  matchId: string;
  gen: number;
  roundNumber: number;
  target: RoundTarget;
  slot: BotSlotConfig;
  moveEnabled: boolean;
}
