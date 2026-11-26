import { COUNTDOWN_MS, type ClientViewState } from '../../../shared/protocol';
import type { AudioOutput } from './audio-catalog';

function roundKey(view: ClientViewState): string {
  return `${view.matchId}:${view.roundNumber}`;
}

function screen(phase: ClientViewState['phase']): string {
  return phase === 'ROUND_LOADING' || phase === 'ROUND_ACTIVE' ? 'ROUND' : phase;
}

function confirmedOpponentIds(view: ClientViewState): string[] {
  const confirmedIds =
    view.phase === 'ROUND_RESULTS'
      ? (view.results?.completion?.confirmedIds ?? [])
      : [
          ...view.players.filter((p) => p.confirmed).map((p) => p.id),
          ...(view.active?.botProgress
            .filter((b) => b.status === 'done' || b.answered)
            .map((b) => b.id) ?? []),
        ];
  return confirmedIds.filter((id) => id !== view.viewerId);
}

/** Separates current timed audio from announcements that only belong to live transitions. */
export class AudioDirector {
  private previous: ClientViewState | null = null;
  private wasLive = false;
  private warningDeadline: number | null = null;

  constructor(private readonly output: AudioOutput) {}

  update(view: ClientViewState | null, now: number, live: boolean): void {
    const previous = this.previous;
    const announce = live && this.wasLive && previous !== null;
    this.previous = view;
    this.wasLive = live && view !== null;
    if (!live || !view) {
      this.output.stopAll();
      this.warningDeadline = null;
      return;
    }
    const sameRound = previous !== null && roundKey(previous) === roundKey(view);
    const phaseChanged = !sameRound || previous.phase !== view.phase;
    const wasRoundActive = sameRound && previous.phase === 'ROUND_ACTIVE';
    const roundCompleted = wasRoundActive && view.phase === 'ROUND_RESULTS';
    if (previous?.matchId !== view.matchId || (phaseChanged && view.phase === 'LOBBY')) {
      this.output.stopAll();
      this.warningDeadline = null;
    }
    if (phaseChanged) {
      this.output.stop('loading');
      const finishedAt = roundCompleted ? (view.results?.completion?.finishedAt ?? now) : now;
      if (this.warningDeadline !== null && finishedAt < this.warningDeadline) {
        this.output.stop('warning');
      }
      // Once the deadline has passed, leave the natural tail alone on further phase changes.
      this.warningDeadline = null;
      if (
        !sameRound ||
        view.phase === 'FINAL' ||
        (previous.phase === 'ROUND_LOADING' && view.phase === 'ROUND_RESULTS')
      ) {
        this.output.stop('countdown');
      }
      if (announce) {
        if (screen(previous.phase) !== screen(view.phase)) {
          this.output.cue('transition');
        }
        this.announcePhase(view);
      }
    }
    this.background(view);
    if (view.phase === 'ROUND_LOADING') {
      this.loading(view, now, announce && (phaseChanged || previous.gen !== view.gen));
    }
    if (view.phase === 'ROUND_ACTIVE') this.active(view, now);
    if (
      announce &&
      wasRoundActive &&
      (roundCompleted || (view.phase === 'ROUND_ACTIVE' && view.active))
    ) {
      const old = new Set(confirmedOpponentIds(previous));
      if (confirmedOpponentIds(view).some((id) => !old.has(id))) this.output.cue('opponent');
    }
  }

  private background(view: ClientViewState): void {
    if (view.phase === 'FINAL') {
      this.output.stop('music');
      return;
    }
    const lobby = view.phase === 'LOBBY';
    this.output.music(`${lobby ? 'lobby' : 'game'}:${view.matchId}`, lobby);
  }

  private stopWarning(): void {
    this.output.stop('warning');
    this.warningDeadline = null;
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
      if (now < startsAt) {
        if (announce) this.loadingPhrase(view, now);
        return;
      }
      if (now < startsAt + COUNTDOWN_MS) {
        this.output.track(
          'countdown',
          'countdown',
          `${roundKey(view)}:${startsAt}`,
          Math.max(0, now - startsAt) / 1000,
        );
      }
    } else if (announce) {
      this.loadingPhrase(view, now);
    }
  }

  private loadingPhrase(view: ClientViewState, now: number): void {
    this.output.track(
      'loading',
      'loading',
      `${roundKey(view)}:${view.gen}`,
      Math.max(0, now - (view.loading?.startedLoadingAt ?? now)) / 1000,
    );
  }

  private active(view: ClientViewState, now: number): void {
    const active = view.active;
    if (!active) return;
    const remaining = active.endsAt - now;
    if (remaining <= 0) return;
    if (remaining <= 15_000 && !active.myConfirmed && !view.viewerIsSpectator) {
      this.warningDeadline = active.endsAt;
      this.output.track(
        'warning',
        'warning',
        `${roundKey(view)}:${active.endsAt}`,
        (15_000 - remaining) / 1000,
      );
    } else {
      this.stopWarning();
    }
  }
}
