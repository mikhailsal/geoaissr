import { SvelteMap } from 'svelte/reactivity';
import { GESTURE_INTERVAL_MS, type AvatarAppearance, type AvatarGesture } from '$shared/avatar';
import type { ClientViewState, ServerMessage } from '$shared/protocol';
import { RU } from '../i18n/ru';
import { nextSpin } from './avatar-spin';
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

  private readonly pendingGestures = $state<
    (
      | { type: 'avatar_gesture'; gesture: AvatarGesture; botId?: string }
      | { type: 'avatar_spin'; participantId: string }
    )[]
  >([]);
  private gestureSeq: number | null = null;
  private cooldown: number | undefined;

  get canAnimate(): boolean {
    return this.pendingGestures.length < 8;
  }

  constructor(private readonly client: GeoWsClient) {}

  animate(gesture: AvatarGesture, botId?: string): void {
    if (!this.canAnimate) return;
    this.pendingGestures.push({ type: 'avatar_gesture', gesture, botId });
    this.sendNext();
  }

  spin(participantId: string): void {
    if (!this.canAnimate) return;
    this.pendingGestures.push({ type: 'avatar_spin', participantId });
    this.sendNext();
  }

  private sendNext(): void {
    if (this.gestureSeq !== null || this.cooldown !== undefined) return;
    const command = this.pendingGestures.shift();
    if (!command) return;
    const { type, ...fields } = command;
    const result = this.client.sendSequencedWithSeq(type, fields);
    if (result.sent) this.gestureSeq = result.seq;
    else this.pendingGestures.length = 0;
  }

  receive({ participantId, gesture }: Extract<ServerMessage, { type: 'avatar_gesture' }>): void {
    window.clearTimeout(this.timers.get(participantId));
    const at = Date.now();
    this.playing[participantId] =
      gesture === 'spin' ? nextSpin(this.playing[participantId], at) : { kind: gesture, at };
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
    if (this.gestureSeq === msg.seq) {
      this.gestureSeq = null;
      // Pace subsequent clicks from the acknowledgement so jitter cannot trip the room's limit.
      this.cooldown = window.setTimeout(() => {
        this.cooldown = undefined;
        this.sendNext();
      }, GESTURE_INTERVAL_MS);
      return;
    }
    if (this.saveRequest?.seq !== msg.seq) return;
    this.saveRequest.finish(
      msg.result === 'ok' ? null : msg.message || 'Не удалось сохранить аватар.',
    );
    this.saveRequest = null;
  }

  reset(): void {
    window.clearTimeout(this.cooldown);
    this.cooldown = undefined;
    this.gestureSeq = null;
    this.pendingGestures.length = 0;
    this.saveRequest?.finish(RU.join.serverUnreachable);
    this.saveRequest = null;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    this.playing = {};
  }
}
