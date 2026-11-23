<script lang="ts">
  import type { BotSlotConfig } from '$shared/storage-schemas';
  import { PERSONALITY_LABELS, RU } from '../i18n/ru';
  import { DETECTIVE_BUDGET_HINT, minBudgetSec } from '../lib/play-style';

  /** The rarely changed settings of a bot slot: frame size, round budget and tone. */
  interface Props {
    config: BotSlotConfig;
    isHost: boolean;
    onUpdate: (patch: Record<string, unknown>) => void;
  }

  let { config: slot, isHost, onUpdate }: Props = $props();

  const BUDGET_MAX_SEC = 600;
  // The draft follows the saved text and holds what is typed until it is committed.
  let draftPersonality = $derived(slot.personalityText);
  const budgetMin = $derived(minBudgetSec(slot));

  function commitPersonalityText(): void {
    const clean = draftPersonality.replace(/[\r\n]+/g, ' ').slice(0, 200);
    if (clean !== slot.personalityText) {
      onUpdate({ personalityText: clean });
    }
  }
</script>

<details class="advanced">
  <summary>{RU.lobby.advanced}</summary>
  <div class="adv-grid">
    <label class="field">
      <span class="lbl">Размер снимка</span>
      <select
        class="field-select"
        disabled={!isHost}
        value={String(slot.imageSize)}
        onchange={(e) => {
          onUpdate({ imageSize: Number(e.currentTarget.value) });
        }}
      >
        <option value="256">256 px</option>
        <option value="400">400 px</option>
        <option value="640">640 px</option>
      </select>
    </label>

    <label class="field">
      <span class="lbl">Бюджет раунда (с)</span>
      <input
        type="number"
        class="field-input"
        min={budgetMin}
        max={BUDGET_MAX_SEC}
        disabled={!isHost}
        value={slot.budgetSec}
        onchange={(e) => {
          const val = Number.parseInt(e.currentTarget.value, 10);
          if (!Number.isFinite(val)) return;
          const clamped = Math.max(budgetMin, Math.min(BUDGET_MAX_SEC, val));
          // The field keeps what was typed unless the value is written back.
          e.currentTarget.value = String(clamped);
          onUpdate({ budgetSec: clamped });
        }}
      />
      {#if slot.playStyle === 'detective'}<span class="hint">{DETECTIVE_BUDGET_HINT}</span>{/if}
    </label>

    <label class="field">
      <span class="lbl">Характер</span>
      <select
        class="field-select"
        disabled={!isHost}
        value={slot.personalityPreset}
        onchange={(e) => {
          onUpdate({ personalityPreset: e.currentTarget.value });
        }}
      >
        {#each ['neutral', 'braggart', 'humble', 'scientist'] as const as p (p)}
          <option value={p}>{PERSONALITY_LABELS[p]}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span class="lbl">Свой тон (до 200 символов)</span>
      <input
        type="text"
        class="field-input"
        maxlength={200}
        disabled={!isHost}
        placeholder="Например: любит дорожные знаки"
        bind:value={draftPersonality}
        onblur={commitPersonalityText}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitPersonalityText();
        }}
      />
    </label>
  </div>
</details>

<style>
  .advanced summary {
    cursor: pointer;
    color: var(--paper-dim);
    min-height: var(--control-h);
    display: flex;
    align-items: center;
  }

  .adv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--sp-3);
    margin-top: var(--sp-2);
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
