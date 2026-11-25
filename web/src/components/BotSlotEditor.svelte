<script lang="ts">
  import { hasTerminalControlCharacters } from '$shared/display-name';
  import type { ParticipantColorId } from '$shared/colors';
  import { slotHarnesses, visionSubject } from '$shared/play-style';
  import BotPlayStyle from './BotPlayStyle.svelte';
  import BotSlotAdvanced from './BotSlotAdvanced.svelte';
  import ParticipantColorPicker from './ParticipantColorPicker.svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { HarnessCatalogEntry } from '$shared/protocol';
  import type { BotSlotConfig } from '$shared/storage-schemas';
  import type { VisionToast } from '../lib/game-store.svelte';
  import { formatSecondsOnly } from '../i18n/format';
  import { EFFORT_LABELS, PRESET_LABELS, RU } from '../i18n/ru';

  interface Props {
    config: BotSlotConfig;
    availableHarnesses: readonly HarnessCatalogEntry[];
    usedColors: readonly ParticipantColorId[];
    isCheckingVision: boolean;
    visionToast?: VisionToast;
    isHost: boolean;
    /** The match's round duration: it caps the bot's budget and decides the play style. */
    roundDurationSec: number;
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
    roundDurationSec,
    onUpdate,
    onApplyPreset,
    onCheckVision,
    onRemove,
    onResetWins,
  }: Props = $props();

  let draftName = $state('');
  const invalidName = $derived(hasTerminalControlCharacters(draftName));
  let draftModel = $state('');
  let customModelMode = $state(false);

  const selectedHarness = $derived(availableHarnesses.find((h) => h.id === slot.harness));
  const modelChoices = $derived(selectedHarness?.models ?? []);
  const isDetective = $derived(slot.playStyle === 'detective');
  // A Detective's check tests its eyes: it counts while their model and effort are unchanged.
  const visionTarget = $derived(visionSubject(slot));
  const checkMatchesSettings = $derived(
    slot.lastVisionCheck !== undefined &&
      slot.lastVisionCheck.model === visionTarget.model &&
      slot.lastVisionCheck.effort === visionTarget.effort &&
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
    customModelMode = !modelChoices.includes(slot.model);
  });

  function commitName(): void {
    const clean = draftName.trim().slice(0, 24); // empty: the server names the bot after its model
    if (!invalidName && clean !== slot.name) {
      onUpdate({ name: clean });
    }
  }

  function commitModel(): void {
    const clean = draftModel.trim().slice(0, 120);
    if (clean && clean !== slot.model) {
      onUpdate({ model: clean });
    }
  }
</script>

<div class="bot-editor">
  {#if slot.disabledReason}
    <p class="slot-warn" role="status">{slot.disabledReason}</p>
  {/if}

  <div class="slot-row">
    <label class="slot-field">
      <span class="slot-label">Имя бота</span>
      <input
        type="text"
        class="field-input"
        maxlength={24}
        disabled={!isHost}
        aria-invalid={invalidName}
        bind:value={draftName}
        onblur={commitName}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitName();
        }}
      />
    </label>

    {#if invalidName && isHost}<span class="slot-warn" role="status">{RU.join.invalidName}</span
      >{/if}
    <label class="slot-field toggle-field">
      <span class="slot-label">Участвует</span>
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

  <div class="slot-row">
    <label class="slot-field">
      <span class="slot-label">{isDetective ? RU.playStyle.brainHarness : 'CLI-харнесс'}</span>
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

    <div class="slot-field">
      <label class="slot-label" for="model-{slot.id}"
        >{isDetective ? RU.playStyle.brainModel : 'Модель'}</label
      >
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

  {#if slotHarnesses(slot).includes('agy')}
    <p class="slot-warn" role="note">{RU.lobby.agyPrivacyWarning}</p>
  {/if}

  <BotPlayStyle config={slot} {availableHarnesses} {roundDurationSec} {isHost} {onUpdate} />

  <div class="slot-group" role="group" aria-label="Уровень сложности бота">
    <span class="slot-label">Сложность ({PRESET_LABELS[slot.difficultyPreset]})</span>
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

  <div class="slot-row">
    <label class="slot-field">
      <span class="slot-label">{isDetective ? RU.playStyle.brainEffort : 'Усилия (effort)'}</span>
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

    <label class="slot-field">
      <span class="slot-label">
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
      <span class="slot-hint">{RU.lobby.turnHint}</span>
    </label>
  </div>

  <BotSlotAdvanced config={slot} {isHost} {onUpdate} />

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
    <p class="slot-warn" role="note">
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

  .custom-model-row {
    display: flex;
    gap: var(--sp-2);
  }

  .preset-btns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
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
</style>
