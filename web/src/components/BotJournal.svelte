<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import type { JournalFrame } from '$shared/bot-journal';
  import type { RoundResultEntryView } from '$shared/protocol';
  import { BRAIN_BLIND_NOTE, confidenceLine } from '../lib/detective-format';
  import { disclosureLabel, NO_SUMMARY_TEXT } from '../lib/journal-format';
  import BotTimeline from './BotTimeline.svelte';
  import ImagePreview from './ImagePreview.svelte';
  import JournalStep from './JournalStep.svelte';

  let { entry }: { entry: RoundResultEntryView } = $props();

  const listId = `journal-steps-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
  interface PreviewState {
    frame: JournalFrame;
    /** The full image finished decoding; until then the cached thumbnail is shown. */
    fullReady: boolean;
    fullFailed: boolean;
    thumbFailed: boolean;
  }
  let preview = $state<PreviewState | null>(null);
  /** Bumped on every open, so a late decode cannot update a different preview. */
  let previewSeq = 0;
  let trigger: HTMLElement | null = null;

  let journal = $derived(entry.journal);
  let summary = $derived(
    journal ? journal.summary : (entry.conclusion ?? entry.explanation ?? undefined),
  );
  let confidence = $derived(confidenceLine(journal?.confidence));
  let previewSrc = $derived.by(() => {
    if (!preview) return null;
    const { frame, fullReady, fullFailed, thumbFailed } = preview;
    if (frame.fullUrl && fullReady && !fullFailed) return frame.fullUrl;
    if (!thumbFailed) return frame.thumbUrl;
    if (frame.fullUrl && !fullFailed) return frame.fullUrl;
    return null;
  });

  function openPreview(frame: JournalFrame, button: HTMLElement): void {
    trigger = button;
    preview = { frame, fullReady: false, fullFailed: false, thumbFailed: false };
    const seq = ++previewSeq;
    const full = frame.fullUrl;
    if (!full || full === frame.thumbUrl) return;
    // Show the thumbnail the step already loaded; switch once the full image is decoded.
    const image = new Image();
    image.src = full;
    void image.decode().then(
      () => {
        if (preview && seq === previewSeq) preview = { ...preview, fullReady: true };
      },
      () => {
        if (preview && seq === previewSeq) preview = { ...preview, fullFailed: true };
      },
    );
  }
  function previewFailed(): void {
    if (!preview) return;
    // A failed thumbnail falls through to the full image; both failed: «Кадр недоступен».
    if (previewSrc === preview.frame.thumbUrl) preview = { ...preview, thumbFailed: true };
    else preview = { ...preview, fullFailed: true };
  }
  async function closePreview(): Promise<void> {
    preview = null;
    await tick();
    trigger?.focus();
  }
</script>

<section class="journal" aria-label="Рассказ бота">
  {#if summary || journal}
    <div class="summary-block">
      <p class="caption">Рассказ бота</p>
      <p class="summary" class:placeholder={!summary}>
        {summary || NO_SUMMARY_TEXT}
        {#if entry.usedDraft}<span class="draft">Черновик</span>{/if}
      </p>
      {#if confidence}<p class="verdict">{confidence}</p>{/if}
      {#if journal?.clue}<p class="verdict">Решающий признак: {journal.clue}</p>{/if}
      {#if journal?.style === 'detective'}<p class="verdict">{BRAIN_BLIND_NOTE}</p>{/if}
    </div>
  {/if}

  {#if journal?.steps.length}
    <button
      type="button"
      class="disclosure"
      aria-expanded={open}
      aria-controls={listId}
      onclick={() => (open = !open)}
    >
      {#if open}<ChevronDown size={18} aria-hidden="true" />{:else}<ChevronRight
          size={18}
          aria-hidden="true"
        />{/if}
      {disclosureLabel(journal.steps.length)}
    </button>
    <div id={listId} class="steps-wrap">
      {#if open}
        <ol class="steps">
          {#each journal.steps as step (step.index)}
            <JournalStep {step} onPreview={openPreview} />
          {/each}
        </ol>
      {/if}
    </div>
  {:else if !journal}
    <BotTimeline thumbs={entry.thumbs} />
  {/if}
</section>

{#if preview}
  <ImagePreview src={previewSrc} onClose={closePreview} onError={previewFailed} />
{/if}

<style>
  .journal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .summary-block {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  p {
    margin: 0;
  }
  .caption {
    font-size: var(--text-xs);
    color: var(--paper-dim);
  }
  .summary {
    font-size: var(--text-base);
    white-space: pre-line;
  }
  .placeholder,
  .verdict {
    color: var(--paper-dim);
  }
  .verdict {
    font-size: var(--text-xs);
  }
  .draft {
    color: var(--paper);
    background: var(--asphalt-700);
    border-radius: var(--radius-sm);
    padding: var(--sp-1);
    font-size: var(--text-xs);
    white-space: normal;
  }
  .disclosure {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    min-height: 44px;
    padding: 0 var(--sp-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--paper);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 120ms ease-out;
  }
  .disclosure:hover {
    background: var(--asphalt-700);
  }
  .steps-wrap {
    container-type: inline-size;
    min-width: 0;
  }
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
