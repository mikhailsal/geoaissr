<script lang="ts">
  import { Check, ChevronDown, ChevronUp, Copy } from '@lucide/svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { ParticipantColorId } from '$shared/colors';
  import type { ClientViewState } from '$shared/protocol';
  import type { RegionId } from '$shared/storage-schemas';
  import Avatar from '../components/Avatar.svelte';
  import BotSlotEditor from '../components/BotSlotEditor.svelte';
  import HostMenu from '../components/HostMenu.svelte';
  import LobbySettingsPanel from '../components/LobbySettingsPanel.svelte';
  import type { VisionToast } from '../lib/game-store.svelte';
  import { PRESET_LABELS, RU } from '../i18n/ru';

  interface Props {
    view: ClientViewState;
    starting: boolean;
    checkingVisionBotId: string | null;
    visionToastByBot: Record<string, VisionToast | undefined>;
    onUpdateLobby: (patch: {
      rounds?: number;
      roundDurationSec?: number;
      moveEnabled?: boolean;
      region?: RegionId;
      aiWaitWindowSec?: number;
    }) => void;
    onAddBot: () => void;
    onRemoveBot: (botId: string) => void;
    onUpdateBot: (botId: string, patch: Record<string, unknown>) => void;
    onApplyBotPreset: (botId: string, preset: Exclude<DifficultyPreset, 'custom'>) => void;
    onCheckBotVision: (botId: string) => void;
    onConfirmQuotaReset: () => void;
    onStartMatch: () => void;
    onEndMatch: () => void;
  }

  let {
    view,
    starting,
    checkingVisionBotId,
    visionToastByBot,
    onUpdateLobby,
    onAddBot,
    onRemoveBot,
    onUpdateBot,
    onApplyBotPreset,
    onCheckBotVision,
    onConfirmQuotaReset,
    onStartMatch,
    onEndMatch,
  }: Props = $props();

  let expandedBotId = $state<string | null>(null);
  let copiedInvite = $state(false);

  const usedColors = $derived<ParticipantColorId[]>([
    ...view.players.map((p) => p.color),
    ...view.bots.map((b) => b.color),
  ]);
  const enabledBotsCount = $derived(view.bots.filter((b) => b.enabled).length);
  const hostName = $derived(view.players.find((p) => p.isHost)?.name ?? 'хоста');
  const minDurationSec = $derived(enabledBotsCount > 0 ? 60 : 30);

  async function copyInviteInline(): Promise<void> {
    if (!view.tunnel.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(view.tunnel.inviteUrl);
      copiedInvite = true;
      window.setTimeout(() => {
        copiedInvite = false;
      }, 2_000);
    } catch {
      copiedInvite = false;
    }
  }
</script>

<main class="lobby-page">
  <header class="top-bar">
    <h1 class="display-title brand">{RU.appName}</h1>
    <HostMenu
      fakeMode={view.fakeMode}
      viewerIsHost={view.viewerIsHost}
      phase={view.phase}
      inviteUrl={view.tunnel.inviteUrl}
      roundNumber={view.roundNumber}
      totalRounds={view.totalRounds}
      {onEndMatch}
    />
  </header>

  {#if view.tunnel.mode === 'local'}
    <!-- Inline, not in the fixed banner: a permanent notice must not cover header controls. -->
    <p class="muted" role="note">{RU.connection.localOnly}</p>
  {/if}

  <div class="columns">
    <section class="panel card" aria-label="Участники и ИИ">
      <h2 class="sec-head">{RU.lobby.playersHeading(view.players.length)}</h2>
      <ul class="participant-list">
        {#each view.players as player (player.id)}
          <li class="player-row">
            <Avatar
              name={player.name}
              colorId={player.color}
              size="md"
              dimmed={!player.connected}
            />
            <div class="p-info">
              <span class="p-name">{player.name}</span>
              <span class="p-tags">
                {#if player.isHost}
                  <span class="tag">{RU.lobby.hostTag}</span>
                {/if}
                {#if !player.connected}
                  <span class="tag tag-warn">{RU.lobby.offlineTag}</span>
                {/if}
                {#if player.mapsError}
                  <span class="tag tag-warn">{player.mapsError}</span>
                {/if}
              </span>
            </div>
          </li>
        {/each}
      </ul>

      {#if view.players.length === 1}
        <div class="alone-box">
          <span>{RU.lobby.aloneHint}</span>
          {#if view.tunnel.inviteUrl}
            <button type="button" class="btn" onclick={() => void copyInviteInline()}>
              {#if copiedInvite}<Check size={16} />{RU.lobby.copiedInvite}{:else}<Copy
                  size={16}
                />{RU.lobby.copyInvite}{/if}
            </button>
          {/if}
        </div>
      {/if}

      <div class="bot-head-row">
        <h2 class="sec-head">{RU.lobby.aiHeading(enabledBotsCount)}</h2>
        {#if view.viewerIsHost && view.bots.length < 3}
          <button type="button" class="btn" onclick={onAddBot}>{RU.lobby.addBot}</button>
        {/if}
      </div>

      {#if view.bots.length === 0}
        <p class="muted">{view.viewerIsHost ? RU.lobby.noBotsHost : RU.lobby.noBotsGuest}</p>
      {:else}
        <div class="bot-list">
          {#each view.bots as bot (bot.id)}
            {@const open = expandedBotId === bot.id}
            <div class="bot-accordion" class:disabled-bot={!bot.enabled}>
              <button
                type="button"
                class="bot-summary"
                aria-expanded={open}
                onclick={() => {
                  expandedBotId = open ? null : bot.id;
                }}
              >
                <Avatar
                  name={bot.name}
                  colorId={bot.color}
                  isAi={true}
                  size="sm"
                  dimmed={!bot.enabled}
                />
                <div class="bot-meta">
                  <span class="bot-title">{bot.name}</span>
                  <span class="bot-sub">
                    {bot.harness} · {bot.model} · {PRESET_LABELS[bot.difficultyPreset]}
                    {#if !bot.enabled}
                      · выключен{/if}
                  </span>
                </div>
                {#if open}<ChevronUp size={18} />{:else}<ChevronDown size={18} />{/if}
              </button>

              {#if open}
                <BotSlotEditor
                  slot={bot}
                  availableHarnesses={view.availableHarnesses}
                  {usedColors}
                  isCheckingVision={checkingVisionBotId === bot.id}
                  visionToast={visionToastByBot[bot.id]}
                  isHost={view.viewerIsHost}
                  onUpdate={(patch: Record<string, unknown>) => {
                    onUpdateBot(bot.id, patch);
                  }}
                  onApplyPreset={(preset: Exclude<DifficultyPreset, 'custom'>) => {
                    onApplyBotPreset(bot.id, preset);
                  }}
                  onCheckVision={() => {
                    onCheckBotVision(bot.id);
                  }}
                  onRemove={() => {
                    if (expandedBotId === bot.id) expandedBotId = null;
                    onRemoveBot(bot.id);
                  }}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <LobbySettingsPanel
      {view}
      {minDurationSec}
      {hostName}
      {starting}
      {onUpdateLobby}
      {onConfirmQuotaReset}
      onStart={onStartMatch}
    />
  </div>
</main>

<style>
  .lobby-page {
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
  }

  .brand {
    font-size: 1.75rem;
    color: var(--paint);
  }

  .columns {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: var(--sp-4);
    align-items: start;
  }

  .card {
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .sec-head {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.92rem;
    letter-spacing: 0.04em;
    color: var(--paper-dim);
  }

  .participant-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .player-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: 0.35rem 0;
  }

  .p-info {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .p-name {
    font-weight: 600;
  }

  .tag {
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--paper-dim);
  }

  .tag-warn {
    border-color: var(--signal);
    color: var(--signal);
  }

  .alone-box {
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

  .bot-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
  }

  .bot-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .bot-accordion {
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .bot-summary {
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    background-color: var(--asphalt-700);
    border: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    cursor: pointer;
    text-align: left;
  }

  .bot-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .bot-title {
    font-weight: 600;
  }

  .bot-sub,
  .muted {
    font-size: 0.85rem;
    color: var(--paper-dim);
    margin: 0;
  }

  @media (max-width: 899px) {
    .columns {
      grid-template-columns: 1fr;
    }
  }
</style>
