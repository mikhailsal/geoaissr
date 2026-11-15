<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { RoundResultEntryView } from '$shared/protocol';
  import Avatar from './Avatar.svelte';
  import BotReasoning from './BotReasoning.svelte';
  import BotTimeline from './BotTimeline.svelte';
  import BotAccounting from './BotAccounting.svelte';
  import {
    formatDistanceRu,
    formatPointsRu,
    formatSecondsOnly,
    formatTurnsRu,
  } from '../i18n/format';
  import { RU } from '../i18n/ru';

  interface Props {
    entry: RoundResultEntryView;
    roundNumber: number;
    onClose: () => void;
  }

  let { entry, roundNumber, onClose }: Props = $props();

  let closeBtn = $state<HTMLButtonElement | null>(null);
  let lastSelection = '';
  let selection = $derived(`${roundNumber}:${entry.id}`);

  $effect(() => {
    if (lastSelection !== selection) {
      lastSelection = selection;
      closeBtn?.focus();
    }
  });
</script>

<article class="bot-card panel" aria-label={`Мысли ${entry.name}`}>
  <header class="card-head">
    <div class="identity">
      <Avatar
        wins6h={entry.wins6h}
        name={entry.name}
        colorId={entry.color}
        isAi={entry.isAi}
        size="md"
      />
      <div>
        <h3 class="bot-name">{entry.name}</h3>
        <p class="metrics">
          {formatPointsRu(entry.roundScore)}
          {#if entry.distanceKm !== null}
            · {formatDistanceRu(entry.distanceKm)}
          {/if}
          {#if entry.turnsUsed !== undefined}
            · {formatTurnsRu(entry.turnsUsed)}
          {/if}
          {#if entry.elapsedMs !== undefined}
            · {formatSecondsOnly(entry.elapsedMs / 1000)}
          {/if}
        </p>
      </div>
    </div>
    <button
      bind:this={closeBtn}
      type="button"
      class="btn close-btn"
      aria-label={RU.results.hideWhyBtn}
      onclick={onClose}
    >
      <X size={18} />
    </button>
  </header>

  {#key selection}
    <BotAccounting {entry} />
    <BotReasoning {entry} />
    <BotTimeline thumbs={entry.thumbs} />
  {/key}

  {#if entry.diagnosticsTail && entry.terminationReason !== 'normal'}
    <details class="diag">
      <summary>Диагностика ({entry.terminationReason ?? 'ошибка'})</summary>
      <pre>{entry.diagnosticsTail}</pre>
    </details>
  {/if}
</article>

<style>
  .bot-card {
    padding: var(--sp-3);
    background-color: var(--asphalt-900);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
  }

  .identity {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .bot-name {
    margin: 0;
    font-size: 1rem;
  }

  .metrics {
    margin: 0;
    font-size: 0.85rem;
    color: var(--paper-dim);
  }

  .close-btn {
    min-width: var(--control-h);
    padding: 0;
  }

  .diag pre {
    margin: var(--sp-2) 0 0;
    padding: var(--sp-2);
    max-height: 180px;
    overflow: auto;
    border-radius: var(--radius-sm);
    background-color: var(--asphalt-800);
    font-size: 0.78rem;
  }
</style>
