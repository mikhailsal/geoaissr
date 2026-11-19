import { SvelteMap } from 'svelte/reactivity';
import type { AvatarAppearance, AvatarGesture } from '$shared/avatar';
import type { ClientViewState, ServerMessage } from '$shared/protocol';
import { RU } from '../i18n/ru';
import type { GeoWsClient } from './ws-client';

import { gestureDuration, type OrbitGesture } from './orbit/types';

export const gestureLabels: Record<AvatarGesture, string> = {
  gg: 'Отличная игра',
  laugh: 'Смеяться',
  cheer: 'Праздновать',
  wave: 'Помахать',
  think: 'Задуматься',
  joy: 'Слёзы радости',
  cool: 'Показать класс',
  spin: 'Поворот на 360°',
};

export class LobbyAvatars {
  playing = $state<Record<string, OrbitGesture | undefined>>({});
  private readonly timers = new SvelteMap<string, number>();
  private saveRequest: { seq: number; finish: (error: string | null) => void } | null = null;

  constructor(private readonly client: GeoWsClient) {}

  animate(gesture: AvatarGesture, botId?: string): void {
    this.client.sendSequenced('avatar_gesture', { gesture, botId });
  }

  receive({ participantId, gesture }: Extract<ServerMessage, { type: 'avatar_gesture' }>): void {
    window.clearTimeout(this.timers.get(participantId));
    this.playing[participantId] = { kind: gesture, at: Date.now() };
    this.timers.set(
      participantId,
      window.setTimeout(() => {
        this.playing[participantId] = undefined;
        this.timers.delete(participantId);
      }, gestureDuration[gesture]),
    );
  }

  save(view: ClientViewState, avatar: AvatarAppearance, botId?: string): Promise<string | null> {
    const me = view.players.find((p) => p.id === view.viewerId);
    if (!me || this.saveRequest) return Promise.resolve('Сохранение пока недоступно.');
    const res = botId
      ? this.client.sendSequencedWithSeq('update_bot', { botId, patch: { avatar } })
      : this.client.sendSequencedWithSeq('update_profile', {
          nick: me.name,
          color: me.color,
          avatar,
        });
    if (!res.sent) return Promise.resolve(RU.join.serverUnreachable);
    return new Promise((finish) => {
      this.saveRequest = { seq: res.seq, finish };
    });
  }

  onAck(msg: Extract<ServerMessage, { type: 'ack' }>): void {
    if (this.saveRequest?.seq !== msg.seq) return;
    this.saveRequest.finish(
      msg.result === 'ok' ? null : msg.message || 'Не удалось сохранить аватар.',
    );
    this.saveRequest = null;
  }

  reset(): void {
    this.saveRequest?.finish(RU.join.serverUnreachable);
    this.saveRequest = null;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    this.playing = {};
  }
}
