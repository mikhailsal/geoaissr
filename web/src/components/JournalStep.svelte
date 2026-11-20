<script lang="ts">
  import type { JournalFrame, JournalStep } from '$shared/bot-journal';
  import { findingLine, pinLine, shiftLabel, stepTitle } from '../lib/journal-format';
  import StepFrames from './StepFrames.svelte';

  interface Props {
    step: JournalStep;
    onPreview: (frame: JournalFrame, trigger: HTMLElement) => void;
  }

  let { step, onPreview }: Props = $props();
  let finding = $derived(findingLine(step));
  let pin = $derived(pinLine(step));
</script>

<li class="step" class:observe={step.kind === 'observe'} class:has-media={step.frames.length > 0}>
  <h5 class="title">{stepTitle(step)}</h5>
  {#if step.frames.length}
    <div class="media"><StepFrames {step} {onPreview} /></div>
  {/if}
  <div class="text">
    {#if step.reason}<p><span class="label">Зачем:</span> {step.reason}</p>{/if}
    {#if finding}
      <p class:placeholder={finding.placeholder}>
        {#if finding.placeholder}{finding.text}{:else}<span class="label">Вывод:</span>
          {finding.text}{/if}
      </p>
    {/if}
    {#if step.shifts?.length}
      <ul class="shifts">
        {#each step.shifts as shift, index (`${shift.version}-${index}`)}
          <li>
            <strong class={`effect ${shift.effect}`}>{shiftLabel(shift.effect)}</strong>
            {shift.version} — {shift.because}
          </li>
        {/each}
      </ul>
    {/if}
    {#if pin}<p class="pin">{pin}</p>{/if}
  </div>
</li>

<style>
  /* Title first, then frames, then the text (one reading column). */
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'title' 'media' 'text';
    row-gap: var(--sp-2);
    padding: var(--sp-3) 0;
    border-top: 1px solid var(--line);
    list-style: none;
  }
  .step:first-child {
    border-top: 0;
  }
  .title {
    grid-area: title;
    overflow-wrap: anywhere;
  }
  .media {
    grid-area: media;
  }
  .text {
    grid-area: text;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 1rem;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  h5,
  p {
    margin: 0;
  }
  h5 {
    font-size: 1rem;
  }
  p {
    white-space: pre-line;
  }
  .label,
  .placeholder,
  .pin {
    color: var(--paper-dim);
  }
  .pin {
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
  }
  .shifts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .effect.excluded {
    color: var(--signal);
  }
  .effect.weaker {
    color: var(--paper-dim);
  }
  .effect.stronger {
    color: var(--ok);
  }
  /* Wide cards: a single frame sits in a 128 px column beside the title and text. */
  @container (min-width: 480px) {
    .step.has-media:not(.observe) {
      grid-template-columns: 128px minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      grid-template-areas: 'media title' 'media text';
      column-gap: var(--sp-3);
      align-items: start;
    }
  }
</style>
