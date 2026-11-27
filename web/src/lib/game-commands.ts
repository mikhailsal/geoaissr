import type { ParticipantColorId } from '$shared/colors';
import type { DifficultyPreset } from '$shared/bot-tools';
import type { LobbySettingsPatch } from '$shared/protocol';
import type { HarnessId } from '$shared/storage-schemas';
import type { GeoWsClient } from './ws-client';

export abstract class GameCommands {
  protected abstract get client(): GeoWsClient;

  resetBotWins(botId: string): void {
    this.client.sendSequenced('reset_bot_wins', { botId });
  }

  updateLobby(patch: LobbySettingsPatch): void {
    this.client.sendSequenced('update_lobby', { patch });
  }

  addBot(): void {
    this.client.sendSequenced('add_bot');
  }

  removeBot(botId: string): void {
    this.client.sendSequenced('remove_bot', { botId });
  }

  releaseGuestSeat(playerId: string): void {
    this.client.sendSequenced('release_guest_seat', { playerId });
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

  /** `force`: the host has been asked about the players who are not ready. */
  nextRound(roundNumber: number, force: boolean): void {
    this.client.sendSequenced('next_round', { roundNumber, force });
  }

  readyNext(roundNumber: number, matchId: string): void {
    this.client.sendSequenced('ready_next', { roundNumber, matchId });
  }

  /** `force`: the host has been asked about the players who are not ready. */
  playAgain(force: boolean): void {
    this.client.sendSequenced('play_again', { force });
  }

  /** `gen`: the final screen clicked on; the server drops a click on an earlier one. */
  readyLobby(gen: number): void {
    this.client.sendSequenced('ready_lobby', { gen });
  }
}
