<script lang="ts">
  import { formatTimerClock } from '../i18n/format';

  interface Props {
    remainingMs: number;
    totalMs: number;
    subLabel?: string;
    danger?: boolean;
  }

  let { remainingMs, totalMs, subLabel, danger = false }: Props = $props();

  const RADIUS = 24;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const progress = $derived(totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0);
  const dashOffset = $derived(CIRCUMFERENCE * (1 - progress));
  const isCritical = $derived(danger || remainingMs <= 10_000);
  const clockText = $derived(formatTimerClock(remainingMs));

  const liveAnnouncement = $derived.by(() => {
    const sec = Math.ceil(remainingMs / 1000);
    if (sec === 30) return 'Осталось 30 секунд';
    if (sec === 10) return 'Осталось 10 секунд';
    if (sec === 5) return 'Осталось 5 секунд';
    if (sec === 0) return 'Время вышло';
    return '';
  });
</script>

<div class="timer-pill panel" class:critical={isCritical}>
  <svg class="ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
    <circle class="track" cx="28" cy="28" r={RADIUS} />
    <circle
      class="arc"
      cx="28"
      cy="28"
      r={RADIUS}
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={dashOffset}
    />
  </svg>
  <div class="readout">
    <span class="digits">{clockText}</span>
    {#if subLabel}
      <span class="sub">{subLabel}</span>
    {/if}
  </div>
  <span class="sr-only" aria-live="polite">{liveAnnouncement}</span>
</div>

<style>
  .timer-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.35rem 1rem 0.35rem 0.5rem;
    border-radius: 999px;
    background-color: var(--asphalt-900);
  }

  .ring {
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .track {
    fill: none;
    stroke: var(--line);
    stroke-width: 4;
  }

  .arc {
    fill: none;
    stroke: var(--paint);
    stroke-width: 4;
    stroke-linecap: round;
    transition: stroke-dashoffset 200ms linear;
  }

  .critical .arc {
    stroke: var(--signal);
  }

  .critical .digits {
    color: var(--signal);
  }

  .critical {
    border-color: var(--signal);
    animation: urgent-pulse 1s ease-in-out infinite;
  }

  .readout {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .digits {
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 700;
    line-height: 1.1;
  }

  .sub {
    font-size: 0.78rem;
    color: var(--paper-dim);
  }

  @keyframes urgent-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.03);
    }
  }
</style>
