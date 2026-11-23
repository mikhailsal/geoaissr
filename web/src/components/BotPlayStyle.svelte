<script lang="ts">
  import { PLAY_STYLES, type PlayStyle } from '$shared/play-style';
  import type { BotSlotConfig } from '$shared/storage-schemas';
  import { RU } from '../i18n/ru';
  import { DETECTIVE_BUDGET_HINT, fallbackNote } from '../lib/play-style';

  /** The play style of a bot slot: Intuit or Detective, with what the choice means in this match. */
  interface Props {
    config: BotSlotConfig;
    roundDurationSec: number;
    isHost: boolean;
    onUpdate: (patch: Record<string, unknown>) => void;
  }

  let { config: slot, roundDurationSec, isHost, onUpdate }: Props = $props();

  const selected = $derived<PlayStyle>(slot.playStyle ?? 'intuit');
  const fallback = $derived(fallbackNote(slot, roundDurationSec));
</script>

<div class="style-bar" role="group" aria-label={RU.playStyle.label}>
  <span class="lbl">{RU.playStyle.label}</span>
  <div class="style-btns">
    {#each PLAY_STYLES as style (style)}
      <button
        type="button"
        class="btn"
        class:btn-primary={selected === style}
        aria-pressed={selected === style}
        disabled={!isHost}
        onclick={() => {
          if (selected !== style) onUpdate({ playStyle: style });
        }}
      >
        {RU.playStyle[style]}
      </button>
    {/each}
  </div>
  <span class="hint">
    {#if selected === 'detective'}
      {RU.playStyle.detectiveHint}. {DETECTIVE_BUDGET_HINT}
    {:else}
      {RU.playStyle.intuitHint}
    {/if}
  </span>
  {#if fallback}
    <p class="warn-line" role="note">{fallback}</p>
  {/if}
</div>

<style>
  .style-bar {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .style-btns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .lbl {
    font-size: 0.85rem;
    color: var(--paper-dim);
  }

  .hint {
    font-size: 0.78rem;
    color: var(--paper-dim);
  }

  .warn-line {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--paint);
    font-size: 0.85rem;
  }
</style>
