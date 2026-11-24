<script lang="ts">
  import { PLAY_STYLES, type PlayStyle } from '$shared/play-style';
  import type { HarnessCatalogEntry } from '$shared/protocol';
  import type { BotSlotConfig } from '$shared/storage-schemas';
  import BotEyesPicker from './BotEyesPicker.svelte';
  import { RU } from '../i18n/ru';
  import { DETECTIVE_BUDGET_HINT, fallbackNote } from '../lib/play-style';

  /** The play style of a bot slot: Intuit or Detective, with what the choice means in this match. */
  interface Props {
    config: BotSlotConfig;
    availableHarnesses: readonly HarnessCatalogEntry[];
    roundDurationSec: number;
    isHost: boolean;
    onUpdate: (patch: Record<string, unknown>) => void;
  }

  let { config: slot, availableHarnesses, roundDurationSec, isHost, onUpdate }: Props = $props();

  const selected = $derived<PlayStyle>(slot.playStyle ?? 'intuit');
  const fallback = $derived(fallbackNote(slot, roundDurationSec));
</script>

<div class="slot-group" role="group" aria-label={RU.playStyle.label}>
  <span class="slot-label">{RU.playStyle.label}</span>
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
  <span class="slot-hint">
    {#if selected === 'detective'}
      {RU.playStyle.detectiveHint}. {DETECTIVE_BUDGET_HINT}
    {:else}
      {RU.playStyle.intuitHint}
    {/if}
  </span>
  {#if fallback}
    <p class="slot-warn" role="note">{fallback}</p>
  {/if}
  {#if selected === 'detective'}
    <BotEyesPicker config={slot} {availableHarnesses} {isHost} {onUpdate} />
  {/if}
</div>

<style>
  .style-btns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
</style>
