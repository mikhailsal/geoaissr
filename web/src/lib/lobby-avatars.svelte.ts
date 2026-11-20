import { SvelteMap } from 'svelte/reactivity';
import { GESTURE_INTERVAL_MS, type AvatarAppearance, type AvatarGesture } from '$shared/avatar';
import type { ClientViewState, ServerMessage } from '$shared/protocol';
import { RU } from '../i18n/ru';
import { nextSpin, spinDuration } from './orbit/spin';
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
  yawById = $state<Record<string, number | undefined>>({});
  private lastTurnAt = -Infinity;
  private readonly confirmedYaw = new SvelteMap<string, number>();
  private readonly pendingTurns = new SvelteMap<string, number>();
  private readonly timers = new SvelteMap<string, number>();
  private saveRequest: { seq: number; finish: (error: string | null) => void } | null = null;

  private readonly pendingGestures = $state<{ gesture: AvatarGesture; botId?: string }[]>([]);
  private gestureSeq: number | null = null;
  private cooldown: number | undefined;

  get canAnimate(): boolean {
    return this.pendingGestures.length < 8;
  }

  constructor(private readonly client: GeoWsClient) {}

  animate(gesture: AvatarGesture, botId?: string): void {
    if (gesture === 'spin' && this.pendingGestures.length === 0) {
      this.client.sendSequenced('avatar_gesture', { gesture, botId });
      return;
    }
    if (!this.canAnimate) return;
    const last = this.pendingGestures.at(-1);
    if (gesture === 'spin' && last?.gesture === gesture && last.botId === botId) return;
    this.pendingGestures.push({ gesture, botId });
    this.sendNext();
  }

  spin(participantId: string): void {
    if (this.client.sendSequenced('avatar_spin', { participantId }))
      this.play(participantId, 'spin');
  }

  turn(participantId: string, angle: number, final: boolean): void {
    const yaw = Math.atan2(Math.sin(angle), Math.cos(angle));
    const now = performance.now();
    if (!final && now - this.lastTurnAt < 40) return;
    this.lastTurnAt = now;
    const request = this.client.sendSequencedWithSeq('avatar_turn', { participantId, yaw });
    if (request.sent) {
      this.pendingTurns.set(participantId, request.seq);
      this.applyTurn(participantId, yaw);
    }
  }

  private applyTurn(participantId: string, yaw: number): void {
    this.yawById[participantId] = yaw;
    if (this.playing[participantId]?.kind !== 'spin') return;
    window.clearTimeout(this.timers.get(participantId));
    this.timers.delete(participantId);
    this.playing[participantId] = undefined;
  }

  private sendNext(): void {
    if (this.gestureSeq !== null || this.cooldown !== undefined) return;
    const command = this.pendingGestures.shift();
    if (!command) return;
    const result = this.client.sendSequencedWithSeq('avatar_gesture', command);
    if (result.sent) this.gestureSeq = result.seq;
    else this.pendingGestures.length = 0;
  }

  receive(msg: Extract<ServerMessage, { type: 'avatar_turn' | 'avatar_gesture' }>): void {
    if (msg.type === 'avatar_turn') {
      this.confirmedYaw.set(msg.participantId, msg.yaw);
      if (!this.pendingTurns.has(msg.participantId)) this.applyTurn(msg.participantId, msg.yaw);
    } else this.play(msg.participantId, msg.gesture);
  }

  private play(participantId: string, gesture: AvatarGesture): void {
    window.clearTimeout(this.timers.get(participantId));
    const at = Date.now();
    const motion =
      gesture === 'spin' ? nextSpin(this.playing[participantId], at) : { kind: gesture, at };
    this.playing[participantId] = motion;
    this.timers.set(
      participantId,
      window.setTimeout(
        () => {
          this.playing[participantId] = undefined;
          this.timers.delete(participantId);
        },
        gesture === 'spin' ? spinDuration(motion) : gestureDuration[gesture],
      ),
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
    for (const [id, seq] of this.pendingTurns) {
      if (seq !== msg.seq) continue;
      this.pendingTurns.delete(id);
      this.yawById[id] = this.confirmedYaw.get(id) ?? 0;
      return;
    }
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
    this.yawById = {};
    this.confirmedYaw.clear();
    this.pendingTurns.clear();
    this.lastTurnAt = -Infinity;
  }
}
