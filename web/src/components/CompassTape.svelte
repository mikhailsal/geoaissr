<script lang="ts">
  /**
   * Horizontal compass tape at the top of the panorama, as in GeoGuessr: a pill with N/NE/E/...
   * labels and fine ticks in one row that scroll as the camera turns; a small triangle on top
   * marks the current heading.
   */
  interface Props {
    heading: number;
  }

  let { heading }: Props = $props();

  const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  const VISIBLE_DEG = 120; // 60° to each side of the heading: NW … N … NE when facing north
  const STEP_DEG = 5;

  const normalized = $derived(((heading % 360) + 360) % 360);

  const marks = $derived(
    Array.from({ length: 360 / STEP_DEG }, (_, i) => i * STEP_DEG)
      .map((angle) => {
        // Signed distance from the heading, in -180..180.
        const delta = ((angle - normalized + 540) % 360) - 180;
        const label = angle % 45 === 0 ? LABELS[angle / 45] : undefined;
        return { angle, delta, label };
      })
      // Leave a gap around each label, as GeoGuessr does.
      .filter((m) => m.angle % 45 !== 5 && m.angle % 45 !== 40)
      .filter((m) => Math.abs(m.delta) <= VISIBLE_DEG / 2),
  );

  const nearestLabel = $derived(LABELS[Math.round(normalized / 45) % 8] ?? 'N');
</script>

<div
  class="compass-tape"
  role="img"
  aria-label={`Направление: ${nearestLabel}, ${String(Math.round(normalized))}°`}
>
  <div class="tape">
    {#each marks as m (m.angle)}
      <span
        class="mark"
        style:left={`${String(50 + (m.delta / VISIBLE_DEG) * 100)}%`}
        aria-hidden="true"
      >
        {#if m.label}<span class="label">{m.label}</span>{:else}<span class="tick"></span>{/if}
      </span>
    {/each}
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
