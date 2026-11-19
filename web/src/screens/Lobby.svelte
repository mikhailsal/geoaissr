<script lang="ts">
  import { tick } from 'svelte';
  import { Settings2, Shirt } from '@lucide/svelte';
  import { defaultAvatar, type AvatarAppearance } from '$shared/avatar';
  import type { LobbyAvatars } from '../lib/lobby-avatars.svelte';
  import AvatarWardrobe from '../components/AvatarWardrobe.svelte';
  import BotSettingsDialog from '../components/BotSettingsDialog.svelte';
  import LobbyStage from '../components/LobbyStage.svelte';
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
    avatars: LobbyAvatars;
    connected: boolean;
    onEditProfile: (e: MouseEvent) => void;
    onResetBotWins: (id: string) => void;
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
    avatars,
    connected,
    onEditProfile,
    onResetBotWins,
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
  let roomDetails: HTMLDivElement;

  let editing = $state<{ botId?: string; name: string; appearance: AvatarAppearance } | null>(null);
  let savePending = $state(false);
  let saveError = $state<string | null>(null);

  let wardrobeTrigger: HTMLElement | null = null;
  function closeWardrobe(): void {
    editing = null;
    void tick().then(() => {
      if (!editing && wardrobeTrigger?.isConnected) wardrobeTrigger.focus();
    });
  }
  function openWardrobe(event: MouseEvent, botId?: string): void {
    if (botId && !view.viewerIsHost) return;
    const person = botId
      ? view.bots.find((b) => b.id === botId)
      : view.players.find((p) => p.id === view.viewerId);
    if (!person) return;
    wardrobeTrigger = event.currentTarget as HTMLElement;
    saveError = null;
    editing = {
      botId,
      name: person.name,
      appearance: person.avatar ?? defaultAvatar(Boolean(botId)),
    };
  }

  async function saveWardrobe(appearance: AvatarAppearance): Promise<void> {
    const participant = editing;
    if (!participant || savePending) return;
    savePending = true;
    const error = await avatars.save(view, appearance, participant.botId);
    savePending = false;
    if (editing !== participant) return;
    saveError = error;
    if (!error) closeWardrobe();
  }

  const usedColors = $derived<ParticipantColorId[]>([
    ...view.players.map((p) => p.color),
    ...view.bots.map((b) => b.color),
  ]);
  const enabledBotsCount = $derived(view.bots.filter((b) => b.enabled).length);
  const hostName = $derived(view.players.find((p) => p.isHost)?.name ?? 'хоста');
  const minDurationSec = $derived(enabledBotsCount > 0 ? 60 : 30);
</script>

<main class="lobby-page">
  <LobbyStage
    {view}
    {avatars}
    {connected}
    onEdit={openWardrobe}
    onOpenSettings={() => {
      roomDetails.focus({ preventScroll: true });
      roomDetails.scrollIntoView({ block: 'start' });
    }}
  >
    {#snippet menu()}
      <HostMenu
        onOpenProfile={onEditProfile}
        fakeMode={view.fakeMode}
        viewerIsHost={view.viewerIsHost}
        phase={view.phase}
        inviteUrl={view.tunnel.inviteUrl}
        roundNumber={view.roundNumber}
        totalRounds={view.totalRounds}
        {onEndMatch}
      />
    {/snippet}
  </LobbyStage>

  {#if view.tunnel.mode === 'local'}
    <!-- Inline, not in the fixed banner: a permanent notice must not cover header controls. -->
    <p class="muted" role="note">{RU.connection.localOnly}</p>
  {/if}

  <div class="columns" bind:this={roomDetails} tabindex="-1">
    <section class="panel card" aria-label="Участники и ИИ">
      <h2 class="sec-head">{RU.lobby.playersHeading(view.players.length)}</h2>
      <ul class="participant-list">
        {#each view.players as player (player.id)}
          <li class="player-row">
            <Avatar
              wins6h={player.wins6h}
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
            {#if player.id === view.viewerId}<button
                type="button"
                class="btn"
                onclick={onEditProfile}>Изменить профиль</button
              >{/if}
          </li>
        {/each}
      </ul>

      {#if view.players.length === 1}
        <div class="alone-box">
          <span>{RU.lobby.aloneHint}</span>
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
              <div class="bot-summary">
                <Avatar
                  wins6h={bot.wins6h}
                  name={bot.name}
                  colorId={bot.color}
                  isAi={true}
                  size="sm"
                  dimmed={!bot.enabled}
                />
                <div class="bot-meta">
                  <span class="bot-title">{bot.name}</span>
                  <span class="bot-sub">
                    {bot.harness} · {bot.model} · {PRESET_LABELS[bot.difficultyPreset]}{bot.enabled
                      ? ''
                      : ' · выключен'}
                  </span>
                </div>
                {#if view.viewerIsHost}
                  <button
                    type="button"
                    class="btn"
                    aria-label={`Изменить аватар ${bot.name}`}
                    title="Изменить аватар"
                    disabled={!connected}
                    onclick={(event) => {
                      openWardrobe(event, bot.id);
                    }}><Shirt size={18} aria-hidden="true" /> Гардероб</button
                  >
                {/if}
                <button
                  type="button"
                  class="btn bot-action"
                  aria-label={`Настройки ${bot.name}`}
                  title="Настройки ИИ"
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  onclick={() => {
                    expandedBotId = open ? null : bot.id;
                  }}
                >
                  <Settings2 size={18} />
                </button>
              </div>

              {#if open}
                <BotSettingsDialog
                  name={bot.name}
                  onClose={() => {
                    expandedBotId = null;
                  }}
                >
                  {#if view.viewerIsHost}<button
                      type="button"
                      class="btn"
                      aria-label={`Сбросить победы ${bot.name}`}
                      onclick={() => {
                        onResetBotWins(bot.id);
                      }}>Сбросить победы</button
                    >{/if}
                  <BotSlotEditor
                    config={bot}
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
                </BotSettingsDialog>
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

{#if editing}
  <AvatarWardrobe
    appearance={editing.appearance}
    name={editing.name}
    pending={savePending}
    error={saveError}
    onSave={(appearance: AvatarAppearance) => {
      void saveWardrobe(appearance);
    }}
    onClose={closeWardrobe}
  />
{/if}

<style>
  .lobby-page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    padding-bottom: var(--sp-4);
  }

  .lobby-page > .muted,
  .columns {
    width: min(calc(100% - 2 * var(--sp-4)), 1120px);
    margin-inline: auto;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: var(--sp-4);
    align-items: start;
  }

  .card {
    min-width: 0;
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
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    padding: 0.35rem 0;
  }

  .p-info {
    flex: 1 1 10rem;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .player-row > button {
    margin-left: auto;
  }

  .p-name {
    font-weight: 600;
    overflow-wrap: anywhere;
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
    text-align: left;
  }

  .bot-action {
    width: 44px;
    flex-shrink: 0;
    padding: 0;
  }
  .bot-title,
  .bot-sub {
    overflow-wrap: anywhere;
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
