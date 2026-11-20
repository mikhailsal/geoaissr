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

<li class="step" class:observe={step.kind === 'observe'}>
  {#if step.frames.length}
    <div class="media"><StepFrames {step} {onPreview} /></div>
  {/if}
  <div class="text">
    <h5>{stepTitle(step)}</h5>
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
  .step {
    display: block;
    padding: var(--sp-3) 0;
    border-top: 1px solid var(--line);
    list-style: none;
  }
  .step:first-child {
    border-top: 0;
  }
  .media {
    margin-bottom: var(--sp-2);
  }
  .text {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.9375rem;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  h5,
  p {
    margin: 0;
  }
  h5 {
    font-size: 0.9375rem;
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
  @container (min-width: 480px) {
    .step:not(.observe) {
      display: grid;
      grid-template-columns: 128px minmax(0, 1fr);
      gap: var(--sp-3);
      align-items: start;
    }
    .step:not(.observe) .media {
      margin-bottom: 0;
    }
  }
</style>
