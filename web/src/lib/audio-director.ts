import { COUNTDOWN_MS, type ClientViewState } from '../../../shared/protocol';
import type { AudioOutput } from './audio-catalog';

function roundKey(view: ClientViewState): string {
  return `${view.matchId}:${view.roundNumber}`;
}

function opponents(view: ClientViewState): Set<string> {
  return new Set([
    ...view.players.filter((p) => p.id !== view.viewerId && p.confirmed).map((p) => p.id),
    ...(view.active?.botProgress.filter((b) => b.status === 'done').map((b) => b.id) ?? []),
  ]);
}

/** Separates current timed audio from announcements that only belong to live transitions. */
export class AudioDirector {
  private previous: ClientViewState | null = null;
  private wasLive = false;
  private musicStartedAt = 0;

  constructor(private readonly output: AudioOutput) {}

  update(view: ClientViewState | null, now: number, live: boolean): void {
    const previous = this.previous;
    const announce = live && this.wasLive && previous !== null;
    this.previous = view;
    this.wasLive = live && view !== null;
    if (!live || !view) {
      this.output.stopAll();
      return;
    }
    const sameRound = previous !== null && roundKey(previous) === roundKey(view);
    const phaseChanged = !sameRound || previous.phase !== view.phase;
    if (phaseChanged) {
      for (const id of ['newRound', 'opponent', 'pin', 'roundEnd', 'gameEnd']) {
        this.output.stop(`cue:${id}`);
      }
      this.output.stop('loading');
      this.output.stop('warning');
      this.output.stop('music');
      // The countdown's go tone and tail belong to the immediately following active round.
      if (!sameRound || view.phase !== 'ROUND_ACTIVE') this.output.stop('countdown');
      if (announce) this.announcePhase(view);
    }
    if (view.phase === 'ROUND_LOADING') this.loading(view, now, announce && phaseChanged);
    if (view.phase === 'ROUND_ACTIVE' && view.active) {
      if (phaseChanged) this.musicStartedAt = view.active.endsAt - view.roundDurationSec * 1000;
      this.active(view, now);
      if (announce && sameRound && previous.phase === 'ROUND_ACTIVE') {
        const old = opponents(previous);
        if ([...opponents(view)].some((id) => !old.has(id))) this.output.cue('opponent');
      }
    }
  }

  private announcePhase(view: ClientViewState): void {
    if (view.phase === 'ROUND_ACTIVE') this.output.cue('newRound');
    if (view.phase === 'ROUND_RESULTS') this.output.cue('roundEnd');
    if (view.phase === 'FINAL' && (view.final?.playedRounds ?? 0) > 0) {
      this.output.cue('gameEnd');
    }
  }

  private loading(view: ClientViewState, now: number, announce: boolean): void {
    const startsAt = view.loading?.countdownStartsAt;
    if (view.loading?.prepError) {
      this.output.stop('loading');
      this.output.stop('countdown');
    } else if (startsAt !== null && startsAt !== undefined) {
      this.output.stop('loading');
      if (now < startsAt + COUNTDOWN_MS) {
        this.output.track(
          'countdown',
          'countdown',
          `${roundKey(view)}:${startsAt}`,
          Math.max(0, now - startsAt) / 1000,
        );
      }
    } else if (announce) {
      this.output.track('loading', 'loading', `${roundKey(view)}:${view.gen}`, 0);
    }
  }

  private active(view: ClientViewState, now: number): void {
    const active = view.active;
    if (!active) return;
    const remaining = active.endsAt - now;
    if (remaining <= 0) {
      this.output.stop('music');
      this.output.stop('warning');
      return;
    }
    this.output.track(
      'music',
      'music',
      roundKey(view),
      Math.max(0, now - this.musicStartedAt) / 1000,
      true,
    );
    if (remaining <= 15_000 && !active.myConfirmed && !view.viewerIsSpectator) {
      this.output.track(
        'warning',
        'warning',
        `${roundKey(view)}:${active.endsAt}`,
        (15_000 - remaining) / 1000,
      );
    } else {
      this.output.stop('warning');
    }
  }
}
