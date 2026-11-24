<script lang="ts">
  import type { HarnessCatalogEntry } from '$shared/protocol';
  import type { BotSlotConfig } from '$shared/storage-schemas';
  import { RU } from '../i18n/ru';

  /** Where the eyes of a Detective run: on the brain's model, or on a harness and model of their own. */
  interface Props {
    config: BotSlotConfig;
    availableHarnesses: readonly HarnessCatalogEntry[];
    isHost: boolean;
    onUpdate: (patch: Record<string, unknown>) => void;
  }

  let { config: slot, availableHarnesses, isHost, onUpdate }: Props = $props();

  const SAME_AS_BRAIN = '__brain__';
  const harnessValue = $derived(slot.eyes?.harness ?? SAME_AS_BRAIN);
  const catalogModels = $derived(
    availableHarnesses.find((h) => h.id === slot.eyes?.harness)?.models ?? [],
  );
  // A model the catalog no longer lists stays selectable while the eyes still use it.
  const modelChoices = $derived(
    slot.eyes && !catalogModels.includes(slot.eyes.model)
      ? [slot.eyes.model, ...catalogModels]
      : catalogModels,
  );
</script>

<fieldset class="eyes">
  <legend class="lbl">{RU.playStyle.eyesLegend}</legend>
  <div class="row-2">
    <label class="field">
      <span class="lbl">{RU.playStyle.eyesHarness}</span>
      <select
        class="field-select"
        disabled={!isHost}
        value={harnessValue}
        onchange={(e) => {
          const value = e.currentTarget.value;
          onUpdate({ eyes: value === SAME_AS_BRAIN ? null : { harness: value } });
        }}
      >
        <option value={SAME_AS_BRAIN}
          >{RU.playStyle.eyesSameAsBrain(slot.harness, slot.model)}</option
        >
        {#each availableHarnesses as h (h.id)}
          <option value={h.id} disabled={!h.available}>
            {h.id}{h.available ? '' : ` — недоступен (${h.reason ?? 'нет CLI'})`}
          </option>
        {/each}
      </select>
    </label>

    {#if slot.eyes}
      {@const eyes = slot.eyes}
      <label class="field">
        <span class="lbl">{RU.playStyle.eyesModel}</span>
        <select
          class="field-select"
          disabled={!isHost}
          value={eyes.model}
          onchange={(e) => {
            onUpdate({ eyes: { harness: eyes.harness, model: e.currentTarget.value } });
          }}
        >
          {#each modelChoices as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
  <span class="hint">{RU.playStyle.eyesHint}</span>
</fieldset>

<style>
  .eyes {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .row-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--sp-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .lbl {
    font-size: 0.85rem;
    color: var(--paper-dim);
  }

  .hint {
    font-size: 0.78rem;
    color: var(--paper-dim);
  }
</style>
