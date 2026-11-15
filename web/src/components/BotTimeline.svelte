<script lang="ts">
  import { Eye, Move, ScanEye } from '@lucide/svelte';
  import type { BotTurnThumbView } from '$shared/protocol';
  import { formatZoom } from '../i18n/format';
  let { thumbs }: { thumbs: BotTurnThumbView[] } = $props();
  let ordered = $derived([
    ...thumbs.filter((t) => t.action === 'observe'),
    ...thumbs.filter((t) => t.action !== 'observe'),
  ]);
  let broken = $state<Record<string, boolean>>({});
  let zoomedUrl = $state<string | null>(null);
  function markBroken(url: string): void {
    broken = { ...broken, [url]: true };
  }
  function previewError(): void {
    if (!zoomedUrl) return;
    const failed = zoomedUrl;
    const thumb = thumbs.find((t) => t.fullUrl === failed || t.thumbUrl === failed);
    markBroken(failed);
    zoomedUrl =
      thumb && failed === thumb.fullUrl && !broken[thumb.thumbUrl] ? thumb.thumbUrl : null;
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
          {@const preview =
            thumb.fullUrl && !broken[thumb.fullUrl] ? thumb.fullUrl : thumb.thumbUrl}
          <button
            type="button"
            class="thumb-btn"
            onclick={() => {
              zoomedUrl = zoomedUrl === preview ? null : preview;
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
  <div class="zoomed-preview">
    <img src={zoomedUrl} alt="Увеличенный снимок бота" onerror={previewError} />
  </div>
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
    cursor: zoom-in;
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
</style>
