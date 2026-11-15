<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { RoundResultEntryView } from '$shared/protocol';
  import Avatar from './Avatar.svelte';
  import {
    formatDistanceRu,
    formatPointsRu,
    formatSecondsOnly,
    formatTurnsRu,
  } from '../i18n/format';
  import { RU } from '../i18n/ru';

  interface Props {
    entry: RoundResultEntryView;
    onClose: () => void;
  }

  let { entry, onClose }: Props = $props();

  let brokenThumbs = $state<Record<string, boolean>>({});
  let zoomedUrl = $state<string | null>(null);
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let lastEntry: RoundResultEntryView | null = null;

  $effect(() => {
    if (lastEntry !== entry) {
      lastEntry = entry;
      brokenThumbs = {};
      zoomedUrl = null;
      closeBtn?.focus();
    }
  });

  function markBroken(url: string): void {
    brokenThumbs = { ...brokenThumbs, [url]: true };
  }
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

  {#if entry.quip}
    <blockquote class="quip">«{entry.quip}»</blockquote>
  {/if}

  {#if entry.explanation}
    <p class="explanation">{entry.explanation}</p>
  {:else}
    <p class="muted">{RU.results.noBotGuess}</p>
  {/if}

  {#if entry.turnsUsed === 0 && entry.explanation}
    <p class="muted">{RU.results.noMovesMade}</p>
  {/if}

  {#if entry.thumbs.length > 0}
    <div class="thumbs-strip" role="list" aria-label="Снимки, которые видел бот">
      {#each entry.thumbs as thumb (thumb.thumbUrl)}
        <div class="thumb-item" role="listitem">
          {#if brokenThumbs[thumb.thumbUrl]}
            <div class="thumb-fallback">Снимки этого раунда уже удалены</div>
          {:else}
            {@const previewUrl =
              thumb.fullUrl && !brokenThumbs[thumb.fullUrl] ? thumb.fullUrl : thumb.thumbUrl}
            <button
              type="button"
              class="thumb-btn"
              onclick={() => {
                zoomedUrl = zoomedUrl === previewUrl ? null : previewUrl;
              }}
            >
              <img
                src={thumb.thumbUrl}
                alt={`Ход ${thumb.turn}: ${thumb.label}`}
                onerror={() => {
                  markBroken(thumb.thumbUrl);
                  if (thumb.fullUrl) markBroken(thumb.fullUrl);
                }}
              />
            </button>
          {/if}
          <span class="thumb-cap">#{thumb.turn} · {thumb.label}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if zoomedUrl && !brokenThumbs[zoomedUrl]}
    {@const zoomedThumb = entry.thumbs.find(
      (t) => t.fullUrl === zoomedUrl || t.thumbUrl === zoomedUrl,
    )}
    <div class="zoomed-preview">
      <img
        src={zoomedUrl}
        alt="Увеличенный снимок бота"
        onerror={() => {
          if (!zoomedUrl) return;
          const failedUrl = zoomedUrl;
          markBroken(failedUrl);
          if (
            zoomedThumb &&
            failedUrl === zoomedThumb.fullUrl &&
            !brokenThumbs[zoomedThumb.thumbUrl]
          ) {
            zoomedUrl = zoomedThumb.thumbUrl;
          } else {
            zoomedUrl = null;
          }
        }}
      />
    </div>
  {/if}

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

  .metrics,
  .muted {
    margin: 0;
    font-size: 0.85rem;
    color: var(--paper-dim);
  }

  .close-btn {
    min-width: var(--control-h);
    padding: 0;
  }

  .quip {
    margin: 0;
    padding-left: var(--sp-3);
    border-left: 3px solid var(--paint);
    color: var(--paint);
    font-style: italic;
  }

  .explanation {
    margin: 0;
    white-space: pre-line;
  }

  .thumbs-strip {
    display: flex;
    gap: var(--sp-2);
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .thumb-item {
    flex: 0 0 128px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .thumb-btn {
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--asphalt-800);
    cursor: zoom-in;
  }

  .thumb-btn img {
    width: 100%;
    height: 84px;
    object-fit: cover;
    display: block;
  }

  .thumb-fallback {
    height: 84px;
    padding: 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background-color: var(--asphalt-800);
    color: var(--paper-dim);
    font-size: 0.72rem;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .thumb-cap {
    font-size: 0.74rem;
    color: var(--paper-dim);
  }

  .zoomed-preview img {
    width: auto;
    max-width: 100%;
    max-height: 640px;
    height: auto;
    display: block;
    margin: 0 auto;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
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
