<script lang="ts">
  /**
   * Horizontal compass tape at the top of the panorama, as in GeoGuessr: a pill with N/NE/E/...
   * labels and fine ticks in one row that scroll as the camera turns; a small triangle on top
   * marks the current heading.
   *
   * The camera reports its heading on every frame of a drag. The marks are therefore laid out
   * once and the whole strip moves by one transform: moving each mark by its own `left` made the
   * browser lay the tape out again on every frame, next to the panorama's own drawing.
   */
  interface Props {
    heading: number;
  }

  let { heading }: Props = $props();

  const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  const VISIBLE_DEG = 120; // 60° to each side of the heading: NW … N … NE when facing north
  const STEP_DEG = 5;
  const HALF_DEG = VISIBLE_DEG / 2;

  const normalized = $derived(((heading % 360) + 360) % 360);

  /** One turn of marks plus half a window on each side, so the strip never shows a gap. */
  const marks = Array.from(
    { length: (360 + VISIBLE_DEG) / STEP_DEG + 1 },
    (_, i) => i * STEP_DEG - HALF_DEG,
  )
    .map((position) => {
      const angle = ((position % 360) + 360) % 360;
      return { position, angle, label: angle % 45 === 0 ? LABELS[angle / 45] : undefined };
    })
    // Leave a gap around each label, as GeoGuessr does.
    .filter((m) => m.angle % 45 !== 5 && m.angle % 45 !== 40);

  const nearestLabel = $derived(LABELS[Math.round(normalized / 45) % 8] ?? 'N');
  // Whole steps only: an attribute that changed on every frame would be work for nothing.
  const spokenDeg = $derived((Math.round(normalized / STEP_DEG) * STEP_DEG) % 360);
</script>

<div
  class="compass-tape"
  role="img"
  aria-label={`Направление: ${nearestLabel}, ${String(spokenDeg)}°`}
>
  <div class="tape">
    <div
      class="strip"
      style:transform={`translateX(${String(50 - (normalized / VISIBLE_DEG) * 100)}%)`}
    >
      {#each marks as m (m.position)}
        <span
          class="mark"
          style:left={`${String((m.position / VISIBLE_DEG) * 100)}%`}
          aria-hidden="true"
        >
          {#if m.label}<span class="label">{m.label}</span>{:else}<span class="tick"></span>{/if}
        </span>
      {/each}
    </div>
  </div>
  <span class="heading-marker" aria-hidden="true"></span>
</div>

<style>
  .compass-tape {
    position: relative;
    width: clamp(140px, 38vw, 300px);
    height: 32px;
    pointer-events: none;
    user-select: none;
  }

  .tape {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 999px;
    border: 1px solid var(--line);
    background-color: color-mix(in srgb, var(--asphalt-900) 80%, transparent);
    box-shadow: var(--shadow-panel);
  }

  .strip {
    position: absolute;
    inset: 0;
    will-change: transform;
  }

  .mark {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .label {
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1;
    color: var(--paper);
  }

  .tick {
    width: 1px;
    height: 10px;
    background-color: var(--paper-dim);
    opacity: 0.7;
  }

  /* Small triangle on the top edge pointing at the heading. */
  .heading-marker {
    position: absolute;
    left: 50%;
    top: -1px;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid var(--signal);
  }
</style>
