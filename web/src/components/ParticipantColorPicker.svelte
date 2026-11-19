<script lang="ts">
  import { PARTICIPANT_COLORS, type ParticipantColorId } from '$shared/colors';

  interface Props {
    legend: string;
    label?: string;
    selected: ParticipantColorId;
    unavailable?: readonly ParticipantColorId[];
    disabled?: boolean;
    compact?: boolean;
    onSelect: (color: ParticipantColorId) => void;
  }

  let {
    legend,
    label,
    selected,
    unavailable = [],
    disabled = false,
    compact = false,
    onSelect,
  }: Props = $props();
</script>

<fieldset class:compact>
  <legend>{legend}</legend>
  <div class="swatches" role="radiogroup" aria-label={label ?? legend}>
    {#each PARTICIPANT_COLORS as color (color.id)}
      <button
        type="button"
        role="radio"
        aria-label={color.labelRu}
        aria-checked={selected === color.id}
        class:selected={selected === color.id}
        style="background-color: var({color.cssVar}); color: var({color.inkToken});"
        disabled={disabled || (color.id !== selected && unavailable.includes(color.id))}
        onclick={() => {
          onSelect(color.id);
        }}>{selected === color.id ? '✓' : ''}</button
      >
    {/each}
  </div>
</fieldset>

<style>
  fieldset {
    min-inline-size: 0;
    border: 0;
    padding: 0;
    margin: var(--sp-2) 0;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--sp-2);
  }
  button {
    height: var(--control-h);
    border: 2px solid transparent;
    cursor: pointer;
  }
  button.selected {
    border-color: var(--paper);
    outline: 2px solid var(--paint);
  }
  button:disabled {
    opacity: 0.28;
    cursor: not-allowed;
  }
  .compact {
    margin: 0;
  }
  .compact legend {
    font-size: 0.85rem;
    color: var(--paper-dim);
  }
  .compact .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.35rem;
  }
  .compact button {
    width: 36px;
    min-height: 36px;
    height: 36px;
    border-radius: 6px;
    font-weight: 700;
  }
</style>
