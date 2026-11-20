<script lang="ts">
  import type { ParticipantColorId } from '$shared/colors';
  import ParticipantColorPicker from './ParticipantColorPicker.svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { HarnessCatalogEntry } from '$shared/protocol';
  import type { BotSlotConfig } from '$shared/storage-schemas';
  import type { VisionToast } from '../lib/game-store.svelte';
  import { formatSecondsOnly } from '../i18n/format';
  import { EFFORT_LABELS, PERSONALITY_LABELS, PRESET_LABELS, RU } from '../i18n/ru';

  interface Props {
    config: BotSlotConfig;
    availableHarnesses: readonly HarnessCatalogEntry[];
    usedColors: readonly ParticipantColorId[];
    isCheckingVision: boolean;
    visionToast?: VisionToast;
    isHost: boolean;
    onUpdate: (patch: Record<string, unknown>) => void;
    onApplyPreset: (preset: Exclude<DifficultyPreset, 'custom'>) => void;
    onCheckVision: () => void;
    onRemove: () => void;
    onResetWins?: () => void;
  }

  let {
    config: slot,
    availableHarnesses,
    usedColors,
    isCheckingVision,
    visionToast,
    isHost,
    onUpdate,
    onApplyPreset,
    onCheckVision,
    onRemove,
    onResetWins,
  }: Props = $props();

  let draftName = $state('');
  let draftModel = $state('');
  let draftPersonality = $state('');
  let customModelMode = $state(false);

  const selectedHarness = $derived(availableHarnesses.find((h) => h.id === slot.harness));
  const modelChoices = $derived(selectedHarness?.models ?? []);
  const checkMatchesSettings = $derived(
    slot.lastVisionCheck !== undefined &&
      slot.lastVisionCheck.model === slot.model &&
      slot.lastVisionCheck.effort === slot.effort &&
      slot.lastVisionCheck.imageSize === slot.imageSize,
  );
  const visionSlowWarning = $derived(
    slot.lastVisionCheck !== undefined &&
      checkMatchesSettings &&
      slot.lastVisionCheck.elapsedMs > slot.budgetSec * 500,
  );

  $effect(() => {
    draftName = slot.name;
    draftModel = slot.model;
    draftPersonality = slot.personalityText;
    customModelMode = !modelChoices.includes(slot.model);
  });

  function commitName(): void {
    const clean = draftName.trim().slice(0, 24); // empty: the server names the bot after its model
    if (clean !== slot.name) {
      onUpdate({ name: clean });
    }
  }

  function commitModel(): void {
    const clean = draftModel.trim().slice(0, 120);
    if (clean && clean !== slot.model) {
      onUpdate({ model: clean });
    }
  }

  function commitPersonalityText(): void {
    const clean = draftPersonality.replace(/[\r\n]+/g, ' ').slice(0, 200);
    if (clean !== slot.personalityText) {
      onUpdate({ personalityText: clean });
    }
  }
</script>

<div class="bot-editor">
  {#if slot.disabledReason}
    <p class="warn-line" role="status">{slot.disabledReason}</p>
  {/if}

  <div class="row-2">
    <label class="field">
      <span class="lbl">Имя бота</span>
      <input
        type="text"
        class="field-input"
        maxlength={24}
        disabled={!isHost}
        bind:value={draftName}
        onblur={commitName}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitName();
        }}
      />
    </label>

    <label class="field toggle-field">
      <span class="lbl">Участвует</span>
      <button
        type="button"
        class="btn"
        aria-pressed={slot.enabled}
        disabled={!isHost}
        onclick={() => {
          onUpdate({ enabled: !slot.enabled });
        }}
      >
        {slot.enabled ? 'Включён' : 'Выключен'}
      </button>
    </label>
  </div>

  <ParticipantColorPicker
    legend="Цвет фишки"
    label="Цвет бота"
    compact
    selected={slot.color}
    unavailable={usedColors}
    disabled={!isHost}
    onSelect={(color) => {
      onUpdate({ color });
    }}
  />

  <div class="row-2">
    <label class="field">
      <span class="lbl">CLI-харнесс</span>
      <select
        class="field-select"
        disabled={!isHost}
        value={slot.harness}
        onchange={(e) => {
          onUpdate({ harness: e.currentTarget.value });
        }}
      >
        {#each availableHarnesses as h (h.id)}
          <option value={h.id} disabled={!h.available}>
            {h.id}{h.available ? '' : ` — недоступен (${h.reason ?? 'нет CLI'})`}
          </option>
        {/each}
      </select>
    </label>

    <div class="field">
      <label class="lbl" for="model-{slot.id}">Модель</label>
      {#if modelChoices.length > 0 && !customModelMode}
        <select
          id="model-{slot.id}"
          class="field-select"
          disabled={!isHost}
          value={slot.model}
          onchange={(e) => {
            if (e.currentTarget.value === '__custom__') {
              customModelMode = true;
            } else {
              onUpdate({ model: e.currentTarget.value });
            }
          }}
        >
          {#each modelChoices as m (m)}
            <option value={m}>{m}</option>
          {/each}
          <option value="__custom__">Другая модель…</option>
        </select>
      {:else}
        <div class="custom-model-row">
          <input
            id="model-{slot.id}"
            type="text"
            class="field-input"
            disabled={!isHost}
            bind:value={draftModel}
            onblur={commitModel}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitModel();
            }}
          />
          {#if modelChoices.length > 0}
            <button
              type="button"
              class="btn"
              disabled={!isHost}
              onclick={() => {
                customModelMode = false;
                if (modelChoices[0]) onUpdate({ model: modelChoices[0] });
              }}
            >
              Список
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if slot.harness === 'agy'}
    <p class="warn-line" role="note">{RU.lobby.agyPrivacyWarning}</p>
  {/if}

  <div class="preset-bar" role="group" aria-label="Уровень сложности бота">
    <span class="lbl">Сложность ({PRESET_LABELS[slot.difficultyPreset]})</span>
    <div class="preset-btns">
      {#each ['novice', 'amateur', 'master'] as const as preset (preset)}
        <button
          type="button"
          class="btn"
          class:btn-primary={slot.difficultyPreset === preset}
          disabled={!isHost}
          onclick={() => {
            onApplyPreset(preset);
          }}
        >
          {PRESET_LABELS[preset]}
        </button>
      {/each}
    </div>
  </div>

  <div class="row-2">
    <label class="field">
      <span class="lbl">Усилия (effort)</span>
      <select
        class="field-select"
        disabled={!isHost}
        value={slot.effort}
        onchange={(e) => {
          onUpdate({ effort: e.currentTarget.value });
        }}
      >
        {#each ['low', 'medium', 'high'] as const as lvl (lvl)}
          <option value={lvl}>{EFFORT_LABELS[lvl]}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span class="lbl">
        Лимит ходов: {slot.moveLimit === 0 ? RU.lobby.turnZeroLabel : slot.moveLimit}
      </span>
      <input
        type="number"
        class="field-input"
        min={0}
        max={20}
        disabled={!isHost}
        value={slot.moveLimit}
        onchange={(e) => {
          const val = Number.parseInt(e.currentTarget.value, 10);
          if (Number.isFinite(val)) onUpdate({ moveLimit: Math.max(0, Math.min(20, val)) });
        }}
      />
      <span class="hint">{RU.lobby.turnHint}</span>
    </label>
  </div>

  <details class="advanced">
    <summary>{RU.lobby.advanced}</summary>
    <div class="row-2 adv-grid">
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
          min={60}
          max={600}
          disabled={!isHost}
          value={slot.budgetSec}
          onchange={(e) => {
            const val = Number.parseInt(e.currentTarget.value, 10);
            if (Number.isFinite(val)) onUpdate({ budgetSec: Math.max(60, Math.min(600, val)) });
          }}
        />
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

  <div class="vision-row">
    <button
      type="button"
      class="btn"
      disabled={!isHost || isCheckingVision}
      onclick={onCheckVision}
    >
      {isCheckingVision ? RU.lobby.visionRunning : RU.lobby.visionBtn}
    </button>

    <span class="vision-status" style:visibility={isCheckingVision ? 'hidden' : null}>
      {#if visionToast}
        {visionToast.passed
          ? `ОК за ${formatSecondsOnly(visionToast.elapsedMs / 1000)}`
          : visionToast.message}
      {:else if !checkMatchesSettings}
        {RU.lobby.visionNotChecked}
      {:else if slot.lastVisionCheck?.passed}
        Проверено: {formatSecondsOnly(slot.lastVisionCheck.elapsedMs / 1000)}
      {:else}
        {slot.lastVisionCheck?.error ?? RU.lobby.visionNotChecked}
      {/if}
    </span>

    {#if onResetWins}<button
        type="button"
        class="btn"
        disabled={!isHost}
        aria-label={`Сбросить победы ${slot.name}`}
        onclick={onResetWins}>Сбросить победы</button
      >{/if}
    <button type="button" class="btn btn-danger" disabled={!isHost} onclick={onRemove}>
      {RU.lobby.removeBot}
    </button>
  </div>

  {#if visionSlowWarning && slot.lastVisionCheck}
    <p class="warn-line" role="note">
      Проверка заняла {formatSecondsOnly(slot.lastVisionCheck.elapsedMs / 1000)} — больше половины бюджета
      ({slot.budgetSec} с). Увеличьте бюджет или выберите более быструю модель.
    </p>
  {/if}
</div>

<style>
  .bot-editor {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--sp-3);
    border-top: 1px solid var(--line);
    background-color: var(--asphalt-900);
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

  .custom-model-row {
    display: flex;
    gap: var(--sp-2);
  }

  .preset-bar {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .preset-btns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .advanced summary {
    cursor: pointer;
    color: var(--paper-dim);
    min-height: var(--control-h);
    display: flex;
    align-items: center;
  }

  .adv-grid {
    margin-top: var(--sp-2);
  }

  .vision-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }

  .vision-status {
    flex: 1;
    font-size: 0.86rem;
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
