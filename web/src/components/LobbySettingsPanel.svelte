<script lang="ts">
  import type { ClientViewState, LobbySettingsPatch } from '$shared/protocol';
  import { REGION_IDS, type RegionId } from '$shared/storage-schemas';
  import { formatRoundsRu, formatSecondsOnly } from '../i18n/format';
  import { REGION_LABELS, RU } from '../i18n/ru';
  import QuotaMetric from './QuotaMetric.svelte';

  interface Props {
    view: ClientViewState;
    minDurationSec: number;
    hostName: string;
    onUpdateLobby: (patch: LobbySettingsPatch) => void;
    onConfirmQuotaReset: () => void;
  }

  let { view, minDurationSec, hostName, onUpdateLobby, onConfirmQuotaReset }: Props = $props();

  function commitNumber(
    input: HTMLInputElement,
    setting: 'rounds' | 'roundDurationSec' | 'aiWaitWindowSec',
    current: number,
  ): void {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      input.value = String(current);
      return;
    }
    const accepted = Math.max(Number(input.min), Math.min(Number(input.max), Math.trunc(value)));
    input.value = String(accepted);
    onUpdateLobby({ [setting]: accepted });
  }
</script>

<section class="settings">
  <div class="settings-grid">
    <label class="field">
      <span class="lbl">{RU.lobby.roundsLabel}</span>
      <input
        type="number"
        class="field-input"
        min={1}
        max={20}
        disabled={!view.viewerIsHost}
        value={view.totalRounds}
        onchange={(e) => {
          commitNumber(e.currentTarget, 'rounds', view.totalRounds);
        }}
      />
    </label>

    <label class="field">
      <span class="lbl">{RU.lobby.durationLabel}</span>
      <input
        type="number"
        class="field-input"
        min={minDurationSec}
        max={600}
        step={15}
        disabled={!view.viewerIsHost}
        value={view.roundDurationSec}
        onchange={(e) => {
          commitNumber(e.currentTarget, 'roundDurationSec', view.roundDurationSec);
        }}
      />
    </label>

    <div class="field">
      <span class="lbl">{RU.lobby.moveLabel}</span>
      <button
        type="button"
        class="btn"
        disabled={!view.viewerIsHost}
        aria-pressed={view.moveEnabled}
        onclick={() => {
          onUpdateLobby({ moveEnabled: !view.moveEnabled });
        }}
      >
        {view.moveEnabled ? RU.lobby.moveOn : RU.lobby.moveOff}
      </button>
    </div>

    <label class="field">
      <span class="lbl">{RU.lobby.regionLabel}</span>
      <select
        class="field-select"
        disabled={!view.viewerIsHost}
        value={view.region}
        onchange={(e) => {
          onUpdateLobby({ region: e.currentTarget.value as RegionId });
        }}
      >
        {#each REGION_IDS as reg (reg)}
          <option value={reg}>{REGION_LABELS[reg]}</option>
        {/each}
      </select>
    </label>

    <label class="standings-option full-span">
      <input
        type="checkbox"
        checked={view.showMatchStandings}
        disabled={!view.viewerIsHost}
        onchange={(e) => {
          onUpdateLobby({ showMatchStandings: e.currentTarget.checked });
        }}
      />
      <span>{RU.lobby.showMatchStandings}</span>
    </label>

    <label class="standings-option full-span">
      <input
        type="checkbox"
        checked={view.pushEnabled}
        disabled={!view.viewerIsHost}
        onchange={(e) => {
          onUpdateLobby({ pushEnabled: e.currentTarget.checked });
        }}
      />
      <span>{RU.lobby.pushEnabled}</span>
    </label>

    {#if view.pushEnabled}
      <label class="standings-option full-span">
        <input
          type="checkbox"
          checked={view.allowBotPush}
          disabled={!view.viewerIsHost}
          onchange={(e) => {
            onUpdateLobby({ allowBotPush: e.currentTarget.checked });
          }}
        />
        <span>{RU.lobby.allowBotPush}</span>
      </label>
    {/if}

    {#if view.bots.some((b) => b.enabled)}
      <label class="field full-span">
        <span class="lbl">{RU.lobby.waitWindowLabel}</span>
        <input
          type="number"
          class="field-input"
          min={0}
          max={120}
          disabled={!view.viewerIsHost}
          value={view.aiWaitWindowSec}
          onchange={(e) => {
            commitNumber(e.currentTarget, 'aiWaitWindowSec', view.aiWaitWindowSec);
          }}
        />
        <span class="hint">{RU.lobby.waitWindowHint}</span>
      </label>
    {/if}
  </div>

  {#if view.settingsNotice}
    <p class="notice" role="status">{view.settingsNotice}</p>
  {/if}

  <div class="quota-box">
    <span class="lbl">Квота за месяц</span>
    <div class="quota-lines">
      <QuotaMetric kind="static" metric={view.quota.metrics.static} />
      <QuotaMetric kind="pano" metric={view.quota.metrics.pano} />
      <QuotaMetric kind="map" metric={view.quota.metrics.map} />
    </div>
    {#if view.quota.exceedsMessage}
      <p class="err-msg" role="alert">{view.quota.exceedsMessage}</p>
    {:else if view.quotaWarning}
      <p class="notice" role="status">{view.quotaWarning}</p>
    {/if}
    {#if view.quota.needsResetConfirm}
      <div class="notice" role="alert">
        <p>{RU.lobby.quotaResetPrompt}</p>
        {#if view.viewerIsHost}
          <button type="button" class="btn" onclick={onConfirmQuotaReset}>
            {RU.lobby.quotaResetAction}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if view.tunnel.mode === 'local'}
    <p class="muted" role="note">{RU.connection.localOnly}</p>
  {/if}
  <div class="start-zone">
    {#if view.viewerIsHost}
      {#if view.startBlockedReasons.length > 0}
        <ul class="blocked-list" aria-label="Почему нельзя начать">
          {#each view.startBlockedReasons as reason (reason)}
            <li>{reason}</li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="muted" role="status">
        {RU.lobby.onlyHostCanStartPrefix}{hostName} · {formatRoundsRu(view.totalRounds)} ·
        {formatSecondsOnly(view.roundDurationSec)} · {REGION_LABELS[view.region]}
      </p>
    {/if}
  </div>
</section>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .standings-option {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 2.5rem;
  }

  .standings-option input {
    accent-color: var(--paint);
  }

  .full-span {
    grid-column: 1 / -1;
  }

  .lbl,
  .hint,
  .muted {
    font-size: 0.85rem;
    color: var(--paper-dim);
    margin: 0;
  }

  .notice {
    padding: var(--sp-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--paint);
    background-color: var(--asphalt-900);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    flex-wrap: wrap;
    margin: 0;
  }

  .quota-box {
    padding: var(--sp-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background-color: var(--asphalt-900);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .quota-lines {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
    font-size: 0.88rem;
  }

  .start-zone {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .blocked-list {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--signal);
    font-size: 0.88rem;
  }

  .err-msg {
    margin: 0;
    color: var(--signal);
    font-size: 0.88rem;
  }
</style>
