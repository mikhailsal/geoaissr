<script lang="ts">
  import { Image, Map, Navigation } from '@lucide/svelte';
  import type { QuotaMetricView } from '$shared/protocol';

  let { kind, metric }: { kind: 'static' | 'pano' | 'map'; metric: QuotaMetricView } = $props();
  const names = { static: 'Static Street View', pano: 'Dynamic Pano', map: 'Maps JS' };
  let root: HTMLDivElement;
  let hovering = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let dismissed = $state(false);
  let open = $derived(!dismissed && (hovering || focused || pinned));
  let verdict = $derived(
    metric.used >= metric.ceiling
      ? 'Лимит исчерпан'
      : metric.status === 'danger'
        ? `Риск превышения (~${metric.projectedMonth} / ${metric.ceiling})`
        : metric.status === 'warn'
          ? `На грани лимита (~${metric.projectedMonth} / ${metric.ceiling})`
          : `Укладываемся в месяц (~${metric.projectedMonth} / ${metric.ceiling})`,
  );

  function dismiss() {
    pinned = false;
    dismissed = true;
  }

  function handlePointerDown(event: PointerEvent) {
    if (!root.contains(event.target as Node)) dismiss();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) dismiss();
  }
</script>

<svelte:document onpointerdown={handlePointerDown} onkeydown={handleKeyDown} />

<div
  class="metric"
  role="group"
  aria-label={names[kind]}
  bind:this={root}
  onpointerenter={(event) => {
    if (event.pointerType === 'mouse') {
      hovering = true;
      dismissed = false;
    }
  }}
  onpointerleave={(event) => {
    if (event.pointerType === 'mouse') hovering = false;
  }}
>
  <button
    type="button"
    class:ok={metric.status === 'ok'}
    class:warn={metric.status === 'warn'}
    class:danger={metric.status === 'danger'}
    aria-label={`${names[kind]}: ${metric.percent}%`}
    aria-expanded={open}
    aria-controls="quota-{kind}"
    onfocus={() => {
      focused = true;
      dismissed = false;
    }}
    onblur={() => {
      focused = false;
    }}
    onclick={() => {
      if (pinned) dismiss();
      else {
        pinned = true;
        dismissed = false;
      }
    }}
  >
    {#if kind === 'static'}<Image size={17} aria-hidden="true" />
    {:else if kind === 'pano'}<Navigation size={17} aria-hidden="true" />
    {:else}<Map size={17} aria-hidden="true" />{/if}
    <span>{metric.percent}%</span>
  </button>
  {#if open}
    <div
      class="details"
      class:align-right={kind === 'map'}
      id="quota-{kind}"
      role="region"
      aria-label={names[kind]}
    >
      <strong>{names[kind]}</strong>
      <span>{metric.used} / {metric.ceiling}</span>
      {#if metric.used > 0}
        <span>~{metric.dailyAvg} / сутки</span>
        <span>{verdict}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .metric {
    position: relative;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: var(--control-h);
    padding: 0 var(--sp-2);
    background: var(--asphalt-700);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--paint);
  }
  .danger {
    color: var(--signal);
  }
  .details {
    position: absolute;
    z-index: 5;
    top: 100%;
    left: 0;
    width: max-content;
    max-width: min(240px, 75vw);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    padding: var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--asphalt-800);
    color: var(--paper);
    box-shadow: var(--shadow-panel);
  }
  .align-right {
    left: auto;
    right: 0;
  }
</style>
