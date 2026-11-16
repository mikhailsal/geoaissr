import type { ParticipantColorId } from '$shared/colors';
import type { DifficultyPreset } from '$shared/bot-tools';
import type { HarnessId, RegionId } from '$shared/storage-schemas';
import type { GeoWsClient } from './ws-client';

export abstract class GameCommands {
  protected abstract get client(): GeoWsClient;

  resetBotWins(botId: string): void {
    this.client.sendSequenced('reset_bot_wins', { botId });
  }

  updateLobby(patch: {
    rounds?: number;
    roundDurationSec?: number;
    moveEnabled?: boolean;
    region?: RegionId;
    aiWaitWindowSec?: number;
  }): void {
    this.client.sendSequenced('update_lobby', { patch });
  }

  addBot(): void {
    this.client.sendSequenced('add_bot');
  }

  removeBot(botId: string): void {
    this.client.sendSequenced('remove_bot', { botId });
  }

  updateBot(
    botId: string,
    patch: {
      name?: string;
      color?: ParticipantColorId;
      enabled?: boolean;
      harness?: HarnessId;
      model?: string;
      effort?: 'low' | 'medium' | 'high';
      moveLimit?: number;
      imageSize?: 256 | 400 | 640;
      budgetSec?: number;
      personalityPreset?: 'neutral' | 'braggart' | 'humble' | 'scientist';
      personalityText?: string;
    },
  ): void {
    this.client.sendSequenced('update_bot', { botId, patch });
  }

  applyBotPreset(botId: string, preset: Exclude<DifficultyPreset, 'custom'>): void {
    this.client.sendSequenced('apply_bot_preset', { botId, preset });
  }

  confirmQuotaReset(): void {
    this.client.sendSequenced('confirm_quota_reset');
  }

  endMatch(): void {
    this.client.sendSequenced('end_match');
  }

  retryRound(gen: number): void {
    this.client.sendSequenced('retry_round', { gen });
  }

  nextRound(roundNumber: number): void {
    this.client.sendSequenced('next_round', { roundNumber });
  }

  playAgain(): void {
    this.client.sendSequenced('play_again');
  }
}
