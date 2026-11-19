<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { DifficultyPreset } from '$shared/bot-tools';
  import type { ParticipantColorId } from '$shared/colors';
  import { COUNTDOWN_MS, type RoundResultEntryView } from '$shared/protocol';
  import type { RegionId } from '$shared/storage-schemas';
  import ProfileModal from './components/ProfileModal.svelte';
  import ProfileEditor from './components/ProfileEditor.svelte';
  import StatusBanner from './components/StatusBanner.svelte';
  import GameAudio from './components/GameAudio.svelte';
  import { audioPlayer } from './lib/audio-settings.svelte';
  import { GameStore } from './lib/game-store.svelte';
  import Final from './screens/Final.svelte';
  import Join from './screens/Join.svelte';
  import Lobby from './screens/Lobby.svelte';
  import Round from './screens/Round.svelte';
  import RoundResults from './screens/RoundResults.svelte';

  const store = new GameStore(() => {
    audioPlayer.cue('locked');
  });
  let editingProfile = $state(false);
  let profileTrigger: HTMLElement | null = null;
  let lobby = $state<{ openProfile: (event: MouseEvent) => void }>();
  let afterProfileSave: (() => void) | undefined;
  function openProfile(e: MouseEvent): void {
    audioPlayer.cue('click');
    profileTrigger = e.currentTarget as HTMLElement;
    store.profile.error = null;
    editingProfile = true;
  }
  function closeProfile(): void {
    audioPlayer.cue('click');
    editingProfile = false;
    void tick().then(() => {
      if (!editingProfile) profileTrigger?.focus();
    });
  }
  let wasPending = false;
  $effect(() => {
    if (wasPending && !store.profile.pending) {
      if (!store.profile.error) (afterProfileSave ?? closeProfile)();
      afterProfileSave = undefined;
    }
    wasPending = store.profile.pending;
  });
  onMount(() => {
    store.connect();
  });
  onDestroy(() => {
    store.destroy();
  });
  const view = $derived(store.view);
  const hasProfile = $derived(store.joined && view !== null);
  const inGamePhase = $derived(hasProfile && store.authState !== 'error');
  const roundRemainingMs = $derived(view?.active ? store.remainingMs(view.active.endsAt) : 0);
  const countdownStartsAt = $derived(view?.loading?.countdownStartsAt ?? null);
  const countdownSeconds = $derived.by(() => {
    if (countdownStartsAt === null) return null;
    const elapsedMs = store.serverNow() - countdownStartsAt;
    if (elapsedMs < 0) return null;
    return Math.max(1, Math.ceil((COUNTDOWN_MS - elapsedMs) / 1000));
  });

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
    if (patch.roundDurationSec !== undefined && patch.roundDurationSec !== view?.roundDurationSec) {
      audioPlayer.cue('tick');
    }
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
    if (view?.phase === 'ROUND_ACTIVE' && !view.viewerIsSpectator && !view.active?.myConfirmed) {
      audioPlayer.cue('pin');
    }
    store.setPin(roundNumber, lat, lng);
  };
  const handleSubmitGuess = (roundNumber: number, lat: number, lng: number): void => {
    store.submitGuess(roundNumber, lat, lng);
  };
  const handleRetryRound = (gen: number): void => {
    store.retryRound(gen);
  };
  const handleSelectBotCard = (rn: number, entry: RoundResultEntryView): void => {
    audioPlayer.cue('click');
    store.openBotCard(rn, entry);
  };
  const handleCloseBotCard = (): void => {
    audioPlayer.cue('click');
    store.closeBotCard();
  };
  const handleNextRound = (rn: number): void => {
    store.nextRound(rn);
  };
  const handlePlayAgain = (): void => {
    store.playAgain();
  };
</script>

<GameAudio
  {view}
  now={store.serverNow()}
  connected={store.joined && store.authState === 'ready' && store.connectionState === 'connected'}
/>

{#snippet profileNotice()}
  {#if store.showCodeNotice}
    <div class="save-code-notice panel" role="status">
      <p>
        <strong>Профиль создан. Вы уже в игре.</strong>
        Сохраните код профиля, если хотите войти с другого устройства или по новой ссылке.
      </p>
      <button
        class="btn"
        onclick={(event) => {
          if (lobby) lobby.openProfile(event);
          else openProfile(event);
        }}>Показать код</button
      ><button
        class="btn"
        onclick={() => {
          store.showCodeNotice = false;
          if (view?.phase === 'LOBBY') window.scrollTo(0, 0);
        }}>Понятно</button
      >
    </div>
  {/if}
{/snippet}

<div class="app-shell">
  {#if hasProfile && !inGamePhase}<button type="button" class="btn owner-menu" onclick={openProfile}
      >Профиль</button
    >{/if}
  {#if inGamePhase && view}
    {#if view.phase !== 'LOBBY'}{@render profileNotice()}{/if}
    <div class="global-banner">
      <StatusBanner
        connectionState={store.connectionState}
        reconnectAttempt={store.reconnectAttempt}
        backOnline={store.backOnline}
        hostConnected={view.hostConnected}
        hostHasJoined={view.players.some((player) => player.isHost)}
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
      role={store.role}
      authState={store.authState}
      authError={store.authError}
      fakeMode={store.fakeMode}
      lobbySummary={store.lobbySummary}
      joinPending={store.joinPending}
      joinError={store.joinError}
      savedProfile={store.profile.saved}
      sessionActive={hasProfile}
      onLogout={() => {
        store.logout();
      }}
      onRetry={handleRetryConnect}
      onLogin={(code: string) => {
        store.login(code);
      }}
      canRegister={store.profile.canRegister}
      onNewProfile={() => {
        store.profile.registerNew();
      }}
      onCodeLogin={() => {
        store.useCodeLogin();
      }}
      onJoin={handleJoin}
    />
  {:else if view.phase === 'LOBBY'}
    <Lobby
      bind:this={lobby}
      {view}
      {profileNotice}
      avatars={store.avatars}
      connected={store.connectionState === 'connected'}
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
    >
      {#snippet profile(close: () => void)}
        {@const me = view.players.find((player) => player.id === view.viewerId)}
        {#if me}<ProfileEditor
            name={me.name}
            color={me.color}
            profileToken={store.profile.saved?.profileToken}
            pending={store.profile.pending}
            error={store.profile.error}
            onSave={(nick: string, color: ParticipantColorId) => {
              afterProfileSave = close;
              store.profile.update(nick, color);
            }}
            onLogout={() => {
              close();
              store.logout();
            }}
          />{/if}
      {/snippet}
    </Lobby>
  {:else if view.phase === 'ROUND_LOADING' || view.phase === 'ROUND_ACTIVE'}
    <Round
      {view}
      onEditProfile={openProfile}
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
      onEditProfile={openProfile}
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

{#if editingProfile && view}
  {@const me = view.players.find((p) => p.id === view.viewerId)}
  {#if me}<ProfileModal
      name={me.name}
      color={me.color}
      profileToken={store.profile.saved?.profileToken}
      editable={inGamePhase && (view.phase === 'LOBBY' || view.phase === 'FINAL')}
      onLogout={() => {
        editingProfile = false;
        store.logout();
      }}
      pending={store.profile.pending}
      error={store.profile.error}
      onSave={(nick: string, color: ParticipantColorId) => {
        store.profile.update(nick, color);
      }}
      onClose={closeProfile}
    />{/if}
{/if}

<style>
  .owner-menu {
    margin: var(--sp-3);
  }
  .save-code-notice {
    width: min(560px, calc(100% - 2rem));
    margin: var(--sp-3) auto;
    padding: var(--sp-3);
  }
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
