<script lang="ts">
  import { Eye, Move, ScanEye, X } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { BotTurnThumbView } from '$shared/protocol';
  import { formatZoom } from '../i18n/format';
  let { thumbs }: { thumbs: BotTurnThumbView[] } = $props();
  let ordered = $derived([
    ...thumbs.filter((t) => t.action === 'observe'),
    ...thumbs.filter((t) => t.action !== 'observe'),
  ]);
  let broken = $state<Record<string, boolean>>({});
  let activeThumb = $state<BotTurnThumbView | null>(null);
  let loaded = $state<Record<string, boolean>>({});
  let zoomedUrl = $derived(
    activeThumb
      ? activeThumb.fullUrl && loaded[activeThumb.fullUrl] && !broken[activeThumb.fullUrl]
        ? activeThumb.fullUrl
        : activeThumb.thumbUrl
      : null,
  );
  const prefetched = new SvelteSet<string>();
  let disposed = false;
  $effect(() => () => {
    disposed = true;
  });
  $effect(() => {
    for (const thumb of thumbs) {
      const url = thumb.fullUrl;
      if (!url || untrack(() => prefetched.has(url))) continue;
      const image = new Image();
      prefetched.add(url);
      image.onload = () => {
        if (!disposed) loaded = { ...loaded, [url]: true };
      };
      image.onerror = () => {
        if (!disposed) markBroken(url);
      };
      image.src = url;
    }
  });
  let previewDialog = $state<HTMLDialogElement | null>(null);
  $effect(() => {
    if (zoomedUrl && previewDialog && !previewDialog.open) previewDialog.showModal();
  });
  function markBroken(url: string): void {
    broken = { ...broken, [url]: true };
  }
  function previewError(): void {
    if (!zoomedUrl) return;
    const failed = zoomedUrl;
    markBroken(failed);
    if (activeThumb?.thumbUrl === failed) activeThumb = null;
  }
</script>

{#if thumbs.length}
  {#if ordered[0]?.action === 'observe'}<h4>Старт · Осмотр по сторонам (observe)</h4>{/if}
  <div class="timeline" role="list" aria-label="Снимки, которые видел бот">
    {#each ordered as thumb, index (`${thumb.thumbUrl}-${index}`)}
      <div class="thumb-item" role="listitem">
        {#if broken[thumb.thumbUrl]}<div class="thumb-fallback">
            Снимки этого раунда уже удалены
          </div>
        {:else}
          <button
            type="button"
            class="thumb-btn"
            aria-haspopup="dialog"
            onclick={() => {
              activeThumb = thumb;
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
        <div class="detail">
          <strong class="action">
            {#if thumb.action === 'observe'}<ScanEye size={16} aria-hidden="true" />{thumb.label}
            {:else if thumb.action === 'look'}<Eye size={16} aria-hidden="true" />{thumb.turn} · Осмотр
              (look)
            {:else}<Move size={16} aria-hidden="true" />{thumb.turn} · Перемещение (move){/if}
          </strong>
          {#if thumb.params}
            <div class="params">
              <span>азимут {thumb.params.heading}°</span>
              {#if thumb.params.pitch}<span>наклон {thumb.params.pitch}°</span>{/if}
              {#if thumb.params.fov !== undefined}<span
                  >зум {formatZoom(thumb.params.fov)}× (fov {thumb.params.fov}°)</span
                >{/if}
              {#if thumb.params.step !== undefined}<span>шаг {thumb.params.step}</span>{/if}
            </div>
          {/if}
          {#if thumb.hypothesis}<p>{thumb.hypothesis}</p>{/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
{#if zoomedUrl && !broken[zoomedUrl]}
  <dialog
    class="zoomed-preview"
    aria-label="Снимок бота"
    bind:this={previewDialog}
    onclose={() => (activeThumb = null)}
    onkeydown={(event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      previewDialog?.close();
    }}
    onclick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        previewDialog?.close();
    }}
  >
    <header>
      <span>Снимок бота</span>
      <button
        type="button"
        class="btn"
        aria-label="Закрыть снимок"
        onclick={() => previewDialog?.close()}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </header>
    <img src={zoomedUrl} alt="Увеличенный снимок бота" onerror={previewError} />
  </dialog>
{/if}

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-width: 0;
  }
  h4 {
    margin: 0;
    font-size: 0.9rem;
  }
  .thumb-item {
    display: grid;
    grid-template-columns: minmax(80px, 128px) minmax(0, 1fr);
    gap: var(--sp-2);
    align-items: start;
  }
  .thumb-btn {
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--asphalt-800);
    cursor: pointer;
  }
  .thumb-btn img {
    width: 100%;
    height: 84px;
    object-fit: cover;
    display: block;
  }
  .thumb-fallback {
    min-height: 84px;
    padding: var(--sp-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background: var(--asphalt-800);
    color: var(--paper-dim);
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    text-align: center;
  }
  .detail {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
  }
  .action {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .params {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    margin-top: var(--sp-1);
  }
  .params span {
    background: var(--asphalt-700);
    border-radius: var(--radius-sm);
    padding: var(--sp-1);
  }
  p {
    font-size: 1rem;
    margin: var(--sp-1) 0 0;
    white-space: pre-line;
  }
  .zoomed-preview {
    position: fixed;
    width: max-content;
    max-width: calc(100vw - 32px);
    max-height: calc(100dvh - 32px);
    padding: var(--sp-3);
    background: var(--asphalt-900);
    color: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-panel);
  }
  .zoomed-preview::backdrop {
    background: var(--asphalt-900);
    opacity: 0.8;
  }
  .zoomed-preview header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    margin-bottom: var(--sp-2);
  }
  .zoomed-preview .btn {
    min-width: var(--control-h);
    padding: 0;
  }
  .zoomed-preview img {
    width: auto;
    max-width: 100%;
    max-height: calc(100dvh - 132px);
    height: auto;
    display: block;
    margin: 0 auto;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
  }
</style>
