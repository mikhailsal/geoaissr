<script lang="ts">
  import type { JournalFrame, JournalStep } from '$shared/bot-journal';
  import { awayFromStart, frameName } from '../lib/journal-format';

  interface Props {
    step: JournalStep;
    onPreview: (frame: JournalFrame, trigger: HTMLElement) => void;
  }

  let { step, onPreview }: Props = $props();
  let loaded = $state<Record<number, boolean>>({});
  let failed = $state<Record<number, boolean>>({});
</script>

<div class="frames" class:grid={step.kind === 'observe'} class:row={step.kind === 'ask'}>
  {#each step.frames as frame, index (`${frame.thumbUrl}-${index}`)}
    <button
      type="button"
      class="frame-btn"
      class:loading={!loaded[index] && !failed[index]}
      aria-label={frameName(step, frame.label, frame.n, frame.params?.fromStartM)}
      aria-haspopup="dialog"
      disabled={failed[index]}
      onclick={(event) => {
        onPreview(frame, event.currentTarget);
      }}
    >
      {#if failed[index]}
        <span class="fallback">Кадр недоступен</span>
      {:else}
        <img
          src={frame.thumbUrl}
          alt=""
          loading="lazy"
          onload={() => (loaded[index] = true)}
          onerror={() => (failed[index] = true)}
        />
      {/if}
      {#if frame.n !== undefined}
        {@const away = awayFromStart(frame.params?.fromStartM)}
        <span class="num" aria-hidden="true">{frame.n}{away ? ` · ${away}` : ''}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .frames {
    display: flex;
    gap: var(--sp-2);
    min-width: 0;
  }
  .frames.grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 288px;
  }
  /* The frames the eyes took for one exchange: a wrapping row of thumbnails. */
  .frames.row {
    flex-wrap: wrap;
  }
  .row .frame-btn {
    width: 128px;
  }
  .frame-btn {
    position: relative;
    display: block;
    width: 100%;
    max-width: 128px;
    aspect-ratio: 1 / 1;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--asphalt-800);
    color: var(--paper-dim);
    cursor: pointer;
  }
  .grid .frame-btn {
    max-width: none;
  }
  .frame-btn:disabled {
    cursor: default;
  }
  .frame-btn img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .loading img {
    opacity: 0;
  }
  /* The number the report and the answers cite («кадр 5»), on its own dark tag. */
  .num {
    position: absolute;
    top: 0;
    left: 0;
    min-width: 1.4em;
    padding: 0 var(--sp-1);
    border-bottom-right-radius: var(--radius-sm);
    background: var(--asphalt-900);
    color: var(--paper);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--sp-1);
    font-size: var(--text-xs);
    text-align: center;
  }
</style>
