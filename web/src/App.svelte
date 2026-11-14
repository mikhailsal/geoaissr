<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { ParticipantColorId } from '$shared/colors';
  import { COUNTDOWN_MS, type RoundResultEntryView } from '$shared/protocol';
  import type { RegionId } from '$shared/storage-schemas';
  import StatusBanner from './components/StatusBanner.svelte';
  import { GameStore } from './lib/game-store.svelte';
  import Final from './screens/Final.svelte';
  import Join from './screens/Join.svelte';
  import Lobby from './screens/Lobby.svelte';
  import Round from './screens/Round.svelte';
  import RoundResults from './screens/RoundResults.svelte';

  const store = new GameStore();

  onMount(() => {
    store.connect();
  });

  onDestroy(() => {
    store.destroy();
  });

  const view = $derived(store.view);
  const inGamePhase = $derived(store.authState !== 'error' && store.joined && view !== null);
  const roundRemainingMs = $derived(view?.active ? store.remainingMs(view.active.endsAt) : 0);
  const countdownStartsAt = $derived(view?.loading?.countdownStartsAt ?? null);
  const countdownSeconds = $derived(
    countdownStartsAt === null
      ? null
      : Math.max(1, Math.ceil(store.remainingMs(countdownStartsAt + COUNTDOWN_MS) / 1000)),
  );
  const autoNextRemainingMs = $derived(
    view?.results ? store.remainingMs(view.results.autoNextEndsAt) : 0,
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
        tunnelLocal={view.tunnel.mode === 'local'}
        onRetryConnect={handleRetryConnect}
      />
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
      onRetry={handleRetryConnect}
      onJoin={handleJoin}
    />
  {:else if view.phase === 'LOBBY'}
    <Lobby
      {view}
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
      remainingAutoNextMs={autoNextRemainingMs}
      onSelectBotCard={handleSelectBotCard}
      onCloseBotCard={handleCloseBotCard}
      onNextRound={handleNextRound}
      onEndMatch={handleEndMatch}
      onMapLoaded={handleResultsMapLoaded}
      onClientError={handleClientError}
    />
  {:else}
    <Final {view} onPlayAgain={handlePlayAgain} onEndMatch={handleEndMatch} />
  {/if}
</div>

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
</style>
