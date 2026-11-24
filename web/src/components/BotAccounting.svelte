<script lang="ts">
  import { Coins } from '@lucide/svelte';
  import type { RoundResultEntryView } from '$shared/protocol';
  import { formatNumberRu } from '../i18n/format';
  import { roleTokensLine } from '../lib/detective-format';
  let { entry }: { entry: RoundResultEntryView } = $props();
  const roleLine = $derived(roleTokensLine(entry));
  let root: HTMLDivElement;
  let hovering = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let dismissed = $state(false);
  let open = $derived(!dismissed && (hovering || focused || pinned));
  function dismiss(): void {
    pinned = false;
    dismissed = true;
  }
  function pointerDown(event: PointerEvent): void {
    if (!root.contains(event.target as Node)) dismiss();
  }
  function keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  }
</script>

<svelte:document onpointerdown={pointerDown} onkeydown={keyDown} />
<div
  class="accounting"
  role="group"
  aria-label="Расход бота"
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
    aria-label="Расход токенов и оценка стоимости"
    aria-expanded={open}
    aria-controls="bot-accounting-details"
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
    <Coins size={16} aria-hidden="true" />
    {entry.tokenUsage ? formatNumberRu(entry.tokenUsage.totalTokens) : 'н/д'} · {entry.costUsd !=
    null
      ? `~$${entry.costUsd.toFixed(3)}`
      : 'н/д'}
  </button>
  {#if open}
    <div
      id="bot-accounting-details"
      class="details"
      role="region"
      aria-label="Расход токенов и оценка стоимости"
    >
      <strong>API-цена для справки</strong>
      <span>Input: {entry.tokenUsage ? formatNumberRu(entry.tokenUsage.inputTokens) : 'н/д'}</span>
      <span>Output: {entry.tokenUsage ? formatNumberRu(entry.tokenUsage.outputTokens) : 'н/д'}</span
      >
      <span
        >Cached: {entry.tokenUsage
          ? formatNumberRu(entry.tokenUsage.cachedInputTokens)
          : 'н/д'}</span
      >
      {#if roleLine}
        <span>{roleLine}</span>
      {/if}
      <span
        >Модель: {entry.matchedModelId ?? 'н/д'}{entry.isApproximateMatch
          ? ' (приблизительное совпадение)'
          : ''}</span
      >
    </div>
  {/if}
</div>

<style>
  .accounting {
    position: relative;
    align-self: flex-start;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: var(--control-h);
    padding: 0 var(--sp-2);
    background: var(--asphalt-700);
    color: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .details {
    position: absolute;
    z-index: 5;
    top: 100%;
    left: 0;
    width: max-content;
    max-width: min(260px, 75vw);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    padding: var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--asphalt-800);
    color: var(--paper);
    box-shadow: var(--shadow-panel);
    overflow-wrap: anywhere;
  }
</style>
