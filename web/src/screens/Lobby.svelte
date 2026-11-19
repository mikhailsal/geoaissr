<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { defaultAvatar, type AvatarAppearance } from '$shared/avatar';
  import type { LobbyAvatars } from '../lib/lobby-avatars.svelte';
  import AvatarWardrobe from '../components/AvatarWardrobe.svelte';
  import LobbyDialog from '../components/LobbyDialog.svelte';
  import LobbyParticipants from '../components/LobbyParticipants.svelte';
  import LobbyStage from '../components/LobbyStage.svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { ParticipantColorId } from '$shared/colors';
  import type { ClientViewState } from '$shared/protocol';
  import type { RegionId } from '$shared/storage-schemas';
  import BotSlotEditor from '../components/BotSlotEditor.svelte';
  import HostMenu from '../components/HostMenu.svelte';
  import LobbySettingsPanel from '../components/LobbySettingsPanel.svelte';
  import type { VisionToast } from '../lib/game-store.svelte';

  interface Props {
    profileNotice: Snippet;
    view: ClientViewState;
    avatars: LobbyAvatars;
    connected: boolean;
    profile: Snippet<[() => void]>;
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
    profileNotice,
    view,
    avatars,
    connected,
    profile,
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

  type CharacterTab = 'appearance' | 'profile' | 'bot';
  let roomDialog = $state<'participants' | 'settings' | null>(null);
  interface OpenCharacter {
    id: string;
    bot: boolean;
    self: boolean;
    tab: CharacterTab;
    name: string;
    appearance: AvatarAppearance;
  }
  let editing = $state<OpenCharacter | null>(null);
  const activeBot = $derived(
    editing?.bot ? view.bots.find((b) => b.id === editing?.id) : undefined,
  );
  const person = $derived(
    editing?.bot
      ? activeBot
      : view.players.find((p) => p.id === (editing?.self ? view.viewerId : editing?.id)),
  );
  const ownProfile = $derived(editing?.self === true);
  const canEdit = $derived(ownProfile || Boolean(activeBot && view.viewerIsHost));
  let savePending = $state(false);
  let saveError = $state<string | null>(null);
  let wardrobeTrigger: HTMLElement | null = null;

  function closeWardrobe(): void {
    editing = null;
    void tick().then(() => {
      if (!editing && wardrobeTrigger?.isConnected) wardrobeTrigger.focus();
    });
  }
  function openWardrobe(
    event: MouseEvent,
    id = view.viewerId,
    bot = false,
    tab: CharacterTab = 'appearance',
  ): void {
    const member = bot ? view.bots.find((b) => b.id === id) : view.players.find((p) => p.id === id);
    if (!member) return;
    wardrobeTrigger = event.currentTarget as HTMLElement;
    saveError = null;
    editing = {
      id,
      bot,
      self: !bot && id === view.viewerId,
      tab,
      name: member.name,
      appearance: member.avatar ?? defaultAvatar(bot),
    };
  }
  export function openProfile(event: MouseEvent): void {
    openWardrobe(event, view.viewerId, false, 'profile');
  }
  async function saveWardrobe(appearance: AvatarAppearance): Promise<void> {
    const participant = editing;
    if (!participant || !canEdit || savePending) return;
    savePending = true;
    const error = await avatars.save(
      view,
      appearance,
      participant.bot ? participant.id : undefined,
    );
    savePending = false;
    if (editing !== participant) return;
    saveError = error;
    if (!error) closeWardrobe();
  }

  $effect(() => {
    if (connected && editing && !editing.self && !person) closeWardrobe();
  });
  const usedColors = $derived<ParticipantColorId[]>([
    ...view.players.map((p) => p.color),
    ...view.bots.map((b) => b.color),
  ]);
  const enabledBotsCount = $derived(view.bots.filter((b) => b.enabled).length);
  const hostName = $derived(view.players.find((p) => p.isHost)?.name ?? 'хоста');
  const minDurationSec = $derived(enabledBotsCount > 0 ? 60 : 30);
</script>

<main>
  <LobbyStage
    {view}
    {avatars}
    {connected}
    {starting}
    onEdit={openWardrobe}
    onStart={onStartMatch}
    onOpenParticipants={() => {
      roomDialog = 'participants';
    }}
    onOpenSettings={() => {
      roomDialog = 'settings';
    }}
    {profileNotice}
  >
    {#snippet menu()}
      <HostMenu
        onOpenProfile={openProfile}
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
</main>

{#if roomDialog === 'participants'}
  <LobbyDialog
    title="Участники"
    onClose={() => {
      roomDialog = null;
    }}
  >
    <LobbyParticipants
      {view}
      {onAddBot}
      onCharacter={(event: MouseEvent, id: string, bot: boolean) => {
        openWardrobe(event, id, bot, bot ? 'bot' : 'appearance');
      }}
    />
  </LobbyDialog>
{:else if roomDialog === 'settings'}
  <LobbyDialog
    title="Настройки партии"
    onClose={() => {
      roomDialog = null;
    }}
  >
    <LobbySettingsPanel {view} {minDurationSec} {hostName} {onUpdateLobby} {onConfirmQuotaReset} />
  </LobbyDialog>
{/if}

{#snippet selfProfile()}
  {@render profile(closeWardrobe)}
{/snippet}
{#snippet botSettings()}
  {#if activeBot}
    {@const bot = activeBot}
    <BotSlotEditor
      config={bot}
      availableHarnesses={view.availableHarnesses}
      {usedColors}
      isCheckingVision={checkingVisionBotId === bot.id}
      visionToast={visionToastByBot[bot.id]}
      isHost={view.viewerIsHost}
      onResetWins={() => {
        onResetBotWins(bot.id);
      }}
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
        closeWardrobe();
        onRemoveBot(bot.id);
      }}
    />
  {/if}
{/snippet}
{#if editing}
  <AvatarWardrobe
    name={person?.name ?? editing.name}
    appearance={person?.avatar ?? editing.appearance}
    initialTab={editing.tab}
    readOnly={!canEdit}
    profile={ownProfile ? selfProfile : undefined}
    botSettings={activeBot ? botSettings : undefined}
    pending={savePending}
    error={saveError}
    onSave={(appearance: AvatarAppearance) => {
      void saveWardrobe(appearance);
    }}
    onClose={closeWardrobe}
  />
{/if}
