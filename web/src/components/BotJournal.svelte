<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import type { JournalFrame } from '$shared/bot-journal';
  import type { RoundResultEntryView } from '$shared/protocol';
  import { disclosureLabel, NO_SUMMARY_TEXT } from '../lib/journal-format';
  import BotTimeline from './BotTimeline.svelte';
  import ImagePreview from './ImagePreview.svelte';
  import JournalStep from './JournalStep.svelte';

  let { entry }: { entry: RoundResultEntryView } = $props();

  const listId = `journal-steps-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
  let preview = $state<{ frame: JournalFrame; fallback: boolean } | null>(null);
  let trigger: HTMLElement | null = null;

  let journal = $derived(entry.journal);
  let summary = $derived(
    journal ? journal.summary : (entry.conclusion ?? entry.explanation ?? undefined),
  );
  let previewSrc = $derived(
    preview
      ? preview.fallback
        ? preview.frame.thumbUrl
        : (preview.frame.fullUrl ?? preview.frame.thumbUrl)
      : null,
  );

  function openPreview(frame: JournalFrame, button: HTMLElement): void {
    trigger = button;
    preview = { frame, fallback: false };
  }
  function previewFailed(): void {
    if (preview && !preview.fallback && preview.frame.fullUrl)
      preview = { ...preview, fallback: true };
    else preview = null;
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

{#if previewSrc}
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
  .placeholder {
    color: var(--paper-dim);
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
