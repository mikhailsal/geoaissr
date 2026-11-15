<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { ParticipantColorId } from '$shared/colors';
  import { COUNTDOWN_MS, type RoundResultEntryView } from '$shared/protocol';
  import type { RegionId } from '$shared/storage-schemas';
  import ProfileModal from './components/ProfileModal.svelte';
  import StatusBanner from './components/StatusBanner.svelte';
  import { GameStore } from './lib/game-store.svelte';
  import Final from './screens/Final.svelte';
  import Join from './screens/Join.svelte';
  import Lobby from './screens/Lobby.svelte';
  import Round from './screens/Round.svelte';
  import RoundResults from './screens/RoundResults.svelte';

  const store = new GameStore();
  let editingProfile = $state(false);
  let profileTrigger: HTMLElement | null = null;
  function openProfile(e: MouseEvent): void {
    profileTrigger = e.currentTarget as HTMLElement;
    store.profile.error = null;
    editingProfile = true;
  }
  function closeProfile(): void {
    editingProfile = false;
    void tick().then(() => {
      if (!editingProfile) profileTrigger?.focus();
    });
  }
  let wasPending = false;
  $effect(() => {
    if (wasPending && !store.profile.pending && !store.profile.error) closeProfile();
    wasPending = store.profile.pending;
  });

  onMount(() => {
    store.connect();
  });

  onDestroy(() => {
    store.destroy();
  });

  const view = $derived(store.view);
  $effect(() => {
    if (editingProfile && view && view.phase !== 'LOBBY' && view.phase !== 'FINAL') {
      closeProfile();
    }
  });
  const inGamePhase = $derived(store.authState !== 'error' && store.joined && view !== null);
  const roundRemainingMs = $derived(view?.active ? store.remainingMs(view.active.endsAt) : 0);
  const countdownStartsAt = $derived(view?.loading?.countdownStartsAt ?? null);
  const countdownSeconds = $derived(
    countdownStartsAt === null
      ? null
      : Math.max(1, Math.ceil(store.remainingMs(countdownStartsAt + COUNTDOWN_MS) / 1000)),
  );

  const handleRetryConnect = (): void => {
    store.retryConnect();
  };
  const handleJoin = (nick: string, color: ParticipantColorId): void => {
    store.join(nick, color);
  };
  const handleUpdateLobby = (patch: {
    rounds?: number;
    roundDurationSec?: number;
    moveEnabled?: boolean;
    region?: RegionId;
    aiWaitWindowSec?: number;
  }): void => {
    store.updateLobby(patch);
  };
  const handleAddBot = (): void => {
    store.addBot();
  };
  const handleRemoveBot = (botId: string): void => {
    store.removeBot(botId);
  };
  const handleUpdateBot = (botId: string, patch: Record<string, unknown>): void => {
    store.updateBot(botId, patch);
  };
  const handleApplyBotPreset = (
    botId: string,
    preset: Exclude<DifficultyPreset, 'custom'>,
  ): void => {
    store.applyBotPreset(botId, preset);
  };
  const handleCheckBotVision = (botId: string): void => {
    store.checkBotVision(botId);
  };
  const handleConfirmQuotaReset = (): void => {
    store.confirmQuotaReset();
  };
  const handleStartMatch = (): void => {
    store.startMatch();
  };
  const handleEndMatch = (): void => {
    store.endMatch();
  };
  const handlePanoLoaded = (roundNumber: number, counted: boolean): void => {
    store.sendPanoLoaded(roundNumber, counted);
  };
  const handleGuessMapLoaded = (): void => {
    store.sendMapLoaded('guess');
  };
  const handleResultsMapLoaded = (): void => {
    store.sendMapLoaded('results');
  };
  const handleClientError = (
    source: 'maps_js' | 'pano' | 'map',
    code: string,
    message: string,
  ): void => {
    store.reportClientError(source, code, message);
  };
  const handleSetPin = (roundNumber: number, lat: number, lng: number): void => {
    store.setPin(roundNumber, lat, lng);
  };
  const handleSubmitGuess = (roundNumber: number, lat: number, lng: number): void => {
    store.submitGuess(roundNumber, lat, lng);
  };
  const handleRetryRound = (gen: number): void => {
    store.retryRound(gen);
  };
  const handleSelectBotCard = (rn: number, entry: RoundResultEntryView): void => {
    store.openBotCard(rn, entry);
  };
  const handleCloseBotCard = (): void => {
    store.closeBotCard();
  };
  const handleNextRound = (rn: number): void => {
    store.nextRound(rn);
  };
  const handlePlayAgain = (): void => {
    store.playAgain();
  };
</script>

<div class="app-shell">
  {#if inGamePhase && view}
    <div class="global-banner">
      <StatusBanner
        connectionState={store.connectionState}
        reconnectAttempt={store.reconnectAttempt}
        backOnline={store.backOnline}
        hostConnected={view.hostConnected}
        tunnelChanged={view.tunnel.changedSinceStart}
        onRetryConnect={handleRetryConnect}
      />
      {#if view.winsWarning}
        <p class="wins-warning panel" role="alert">{view.winsWarning}</p>
      {/if}
    </div>
  {/if}

  {#if !inGamePhase || !view}
    <Join
      authState={store.authState}
      authError={store.authError}
      fakeMode={store.fakeMode}
      lobbySummary={store.lobbySummary}
      joinPending={store.joinPending}
      joinError={store.joinError}
      savedProfile={store.profile.saved}
      onRetry={handleRetryConnect}
      onJoin={handleJoin}
    />
  {:else if view.phase === 'LOBBY'}
    <Lobby
      {view}
      onEditProfile={openProfile}
      onResetBotWins={(id: string) => {
        store.resetBotWins(id);
      }}
      starting={store.startMatchPending}
      checkingVisionBotId={store.checkingVisionBotId}
      visionToastByBot={store.visionToastByBot}
      onUpdateLobby={handleUpdateLobby}
      onAddBot={handleAddBot}
      onRemoveBot={handleRemoveBot}
      onUpdateBot={handleUpdateBot}
      onApplyBotPreset={handleApplyBotPreset}
      onCheckBotVision={handleCheckBotVision}
      onConfirmQuotaReset={handleConfirmQuotaReset}
      onStartMatch={handleStartMatch}
      onEndMatch={handleEndMatch}
    />
  {:else if view.phase === 'ROUND_LOADING' || view.phase === 'ROUND_ACTIVE'}
    <Round
      {view}
      browserMapsKey={store.browserMapsKey}
      localPin={store.localPin}
      submittingGuess={store.submittingGuess}
      offlinePinWarning={store.offlinePinWarning}
      mapsJsFatalError={store.mapsJsFatalError}
      remainingMs={roundRemainingMs}
      {countdownSeconds}
      onPanoLoaded={handlePanoLoaded}
      onMapLoaded={handleGuessMapLoaded}
      onClientError={handleClientError}
      onSetPin={handleSetPin}
      onSubmitGuess={handleSubmitGuess}
      onRetryRound={handleRetryRound}
      onEndMatch={handleEndMatch}
    />
  {:else if view.phase === 'ROUND_RESULTS'}
    <RoundResults
      {view}
      browserMapsKey={store.browserMapsKey}
      activeBotCard={store.activeBotCard}
      onSelectBotCard={handleSelectBotCard}
      onCloseBotCard={handleCloseBotCard}
      onNextRound={handleNextRound}
      onEndMatch={handleEndMatch}
      onMapLoaded={handleResultsMapLoaded}
      onClientError={handleClientError}
    />
  {:else}
    <Final
      {view}
      onPlayAgain={handlePlayAgain}
      onEndMatch={handleEndMatch}
      onEditProfile={openProfile}
      onResetBotWins={(id: string) => {
        store.resetBotWins(id);
      }}
    />
  {/if}
</div>

{#if editingProfile && view && (view.phase === 'LOBBY' || view.phase === 'FINAL')}
  {@const me = view.players.find((p) => p.id === view.viewerId)}
  {#if me}<ProfileModal
      name={me.name}
      color={me.color}
      usedColors={[
        ...view.players.filter((p) => p.id !== me.id).map((p) => p.color),
        ...view.bots.map((b) => b.color),
      ]}
      pending={store.profile.pending}
      error={store.profile.error}
      onSave={(nick: string, color: ParticipantColorId) => {
        store.updateProfile(nick, color);
      }}
      onClose={closeProfile}
    />{/if}
{/if}

<style>
  .app-shell {
    min-height: 100dvh;
    position: relative;
  }

  .global-banner {
    position: fixed;
    top: var(--sp-2);
    left: 50%;
    transform: translateX(-50%);
    z-index: 80;
    width: min(560px, calc(100vw - 2rem));
    pointer-events: none;
  }

  .global-banner :global(button) {
    pointer-events: auto;
  }

  .wins-warning {
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    color: var(--signal);
  }
</style>
