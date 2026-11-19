<script lang="ts">
  import { Map as MapIcon, X } from '@lucide/svelte';
  import type { ClientViewState } from '$shared/protocol';
  import GuessMap from '../components/GuessMap.svelte';
  import HostMenu from '../components/HostMenu.svelte';
  import CompassTape from '../components/CompassTape.svelte';
  import PanoView from '../components/PanoView.svelte';
  import PlayerList from '../components/PlayerList.svelte';
  import TimerRing from '../components/TimerRing.svelte';
  import { attachGlobalKeys } from '../lib/keys';
  import { RU } from '../i18n/ru';
  import { audioPlayer } from '../lib/audio-settings.svelte';

  interface Props {
    onEditProfile: (event: MouseEvent) => void;
    view: ClientViewState;
    browserMapsKey: string | null;
    localPin: { roundNumber: number; lat: number; lng: number } | null;
    submittingGuess: boolean;
    offlinePinWarning: boolean;
    mapsJsFatalError: string | null;
    remainingMs: number;
    countdownSeconds: number | null;
    onPanoLoaded: (roundNumber: number, countedLoad: boolean) => void;
    onMapLoaded: () => void;
    onClientError: (source: 'maps_js' | 'pano' | 'map', code: string, message: string) => void;
    onSetPin: (roundNumber: number, lat: number, lng: number) => void;
    onSubmitGuess: (roundNumber: number, lat: number, lng: number) => void;
    onRetryRound: (gen: number) => void;
    onEndMatch: () => void;
  }

  let {
    onEditProfile,
    view,
    browserMapsKey,
    localPin,
    submittingGuess,
    offlinePinWarning,
    mapsJsFatalError,
    remainingMs,
    countdownSeconds,
    onPanoLoaded,
    onMapLoaded,
    onClientError,
    onSetPin,
    onSubmitGuess,
    onRetryRound,
    onEndMatch,
  }: Props = $props();

  // Keep keyboard pinning separate from hover while the dock resizes.
  let heading = $state(0);
  let mapPinned = $state(false);
  let mapHovered = $state(false);
  const desktopExpanded = $derived(mapPinned || mapHovered);
  let mobileMapOpen = $state(false);
  let hudHeight = $state(0);

  const myColor = $derived(view.players.find((p) => p.id === view.viewerId)?.color ?? 'p-1');
  const panoId = $derived(view.active?.panoId ?? view.loading?.panoId ?? '');
  const fakeSceneIndex = $derived(
    view.active?.fakeSceneIndex ?? view.loading?.fakeSceneIndex ?? view.roundNumber - 1,
  );
  const currentPin = $derived(
    localPin && localPin.roundNumber === view.roundNumber
      ? { lat: localPin.lat, lng: localPin.lng }
      : null,
  );
  const anyBotThinking = $derived(
    view.active?.botProgress.some((b) => b.status === 'thinking') ?? false,
  );
  const timerSubLabel = $derived(
    view.active?.allHumansConfirmed && anyBotThinking
      ? RU.round.allHumansAnsweredAiThinking
      : undefined,
  );
  const isFinalRound = $derived(view.roundNumber >= view.totalRounds);

  function submitCurrentPin(): void {
    if (view.phase !== 'ROUND_ACTIVE' || !view.active) return;
    if (view.viewerIsSpectator || view.active.myConfirmed || !currentPin || submittingGuess) return;
    onSubmitGuess(view.roundNumber, currentPin.lat, currentPin.lng);
  }

  let lastResetRound = -1;

  $effect(() => {
    if (lastResetRound !== view.roundNumber) {
      lastResetRound = view.roundNumber;
      mapPinned = false;
      mobileMapOpen = false;
    }
  });

  $effect(() => {
    return attachGlobalKeys(() => ({
      onEnter: submitCurrentPin,
      onToggleMap: () => {
        audioPlayer.cue('click');
        mapPinned = !mapPinned;
        mobileMapOpen = !mobileMapOpen;
      },
      onEscape: () => {
        mapPinned = false;
        mapHovered = false;
        mobileMapOpen = false;
      },
    }));
  });
</script>

<main class="round-stage" style:--hud-height={`${hudHeight}px`}>
  {#if panoId}
    <PanoView
      fakeMode={view.fakeMode}
      {browserMapsKey}
      {panoId}
      {fakeSceneIndex}
      roundNumber={view.roundNumber}
      moveEnabled={view.moveEnabled}
      {onPanoLoaded}
      bind:heading
      {onClientError}
    />
  {/if}

  <header class="hud-top" bind:clientHeight={hudHeight}>
    <div class="round-chip panel">
      <span>{RU.round.roundTitle(view.roundNumber, view.totalRounds)}</span>
    </div>

    <div class="hud-center">
      {#if panoId}<CompassTape {heading} />{/if}
      {#if view.phase === 'ROUND_ACTIVE' && view.active}
        <TimerRing
          {remainingMs}
          totalMs={view.roundDurationSec * 1000}
          subLabel={timerSubLabel}
          danger={remainingMs <= 10_000}
        />
      {/if}
    </div>

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
  </header>

  {#if view.phase === 'ROUND_ACTIVE' && view.active}
    <div class="hud-left">
      <PlayerList players={view.players} botProgress={view.active.botProgress} />
    </div>
  {/if}

  {#if mapsJsFatalError}
    <div class="fatal-maps panel" role="alert">{mapsJsFatalError}</div>
  {/if}

  {#if view.phase === 'ROUND_ACTIVE' && view.active}
    <button
      type="button"
      class="btn btn-primary mobile-map-fab"
      onclick={() => {
        audioPlayer.cue('click');
        mobileMapOpen = true;
      }}
    >
      <MapIcon size={18} />
      <span>{RU.round.openMapBtn}</span>
    </button>

    <section
      class="map-dock panel"
      class:expanded={desktopExpanded}
      class:mobile-open={mobileMapOpen}
      aria-label="Карта догадки"
      onmouseenter={() => (mapHovered = true)}
      onmouseleave={() => (mapHovered = false)}
    >
      <div class="mobile-sheet-head">
        <span>Карта (M)</span>
        <button
          type="button"
          class="btn"
          onclick={() => {
            audioPlayer.cue('click');
            mobileMapOpen = false;
          }}
        >
          <X size={16} />
          <span>{RU.round.closeMapBtn}</span>
        </button>
      </div>

      <div class="map-frame">
        <GuessMap
          fakeMode={view.fakeMode}
          {browserMapsKey}
          roundNumber={view.roundNumber}
          playerColor={myColor}
          pin={currentPin}
          locked={view.viewerIsSpectator || view.active.myConfirmed}
          expanded={desktopExpanded || mobileMapOpen}
          onPick={(lat: number, lng: number) => {
            onSetPin(view.roundNumber, lat, lng);
          }}
          {onMapLoaded}
          {onClientError}
        />
      </div>

      <div class="answer-bar">
        {#if view.viewerIsSpectator}
          <p class="status-text" role="status">
            {isFinalRound ? RU.round.spectatorFinalRound : RU.round.spectatorRound}
          </p>
        {:else if view.active.myConfirmed}
          <p class="status-text accepted" role="status">
            {RU.round.answerAccepted(view.active.confirmedCount, view.active.playingHumanCount)}
          </p>
        {:else}
          <p class="status-text" class:warn={offlinePinWarning} role="status">
            {#if offlinePinWarning}
              {RU.round.offlineNoChanges}
            {:else if currentPin}
              {RU.round.pinSaved}
            {:else}
              {RU.round.placePinPrompt}
            {/if}
          </p>
          <button
            type="button"
            class="btn btn-primary guess-btn"
            disabled={!currentPin || submittingGuess}
            onclick={submitCurrentPin}
          >
            {submittingGuess ? RU.round.submittingBtn : RU.round.guessBtn}
          </button>
        {/if}
      </div>
    </section>
  {/if}

  {#if view.phase === 'ROUND_LOADING' && view.loading}
    <div class="loading-veil" role="status" aria-live="polite">
      <div class="loading-box panel">
        <p class="loading-round">{RU.round.roundTitle(view.roundNumber, view.totalRounds)}</p>
        {#if view.loading.prepError}
          <p class="err-line">
            {view.viewerIsHost ? RU.round.prepFailedHost : RU.round.prepFailedGuest}
          </p>
          <p class="muted">{view.loading.prepError}</p>
          {#if view.viewerIsHost}
            <div class="err-actions">
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => {
                  onRetryRound(view.gen);
                }}
              >
                {RU.join.retry}
              </button>
              <button type="button" class="btn btn-danger" onclick={onEndMatch}>
                {RU.lobby.endMatchMenu}
              </button>
            </div>
          {/if}
        {:else if countdownSeconds !== null}
          <p class="countdown display-title">{countdownSeconds}</p>
        {:else}
          <p class="loading-label">{RU.round.loadingPano}</p>
          {#if view.loading.waitingFor.length > 0}
            <p class="muted">{RU.round.waitingForPlayers(view.loading.waitingFor)}</p>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  .round-stage {
    position: relative;
    width: 100%;
    height: 100dvh;
    overflow: hidden;
    background-color: var(--asphalt-900);
  }
  .hud-top {
    position: absolute;
    top: var(--sp-3);
    left: var(--sp-3);
    right: var(--sp-3);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-2);
    z-index: 25;
    pointer-events: none;
  }
  .hud-top > :global(*) {
    pointer-events: auto;
  }
  .hud-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
  }
  .round-chip {
    padding: 0.55rem 0.9rem;
    font-family: var(--font-display);
    font-size: 0.88rem;
    background-color: var(--asphalt-900);
  }
  .hud-left {
    position: absolute;
    left: var(--sp-3);
    top: 4.5rem;
    z-index: 20;
  }
  .fatal-maps {
    position: absolute;
    top: 5rem;
    left: 50%;
    transform: translateX(-50%);
    padding: var(--sp-3) var(--sp-4);
    border-color: var(--signal);
    z-index: 40;
  }
  .map-dock {
    position: absolute;
    right: var(--sp-3);
    bottom: 2.2rem;
    width: 340px;
    height: 290px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 25;
    background-color: var(--asphalt-900);
    opacity: 0.8;
    transition:
      opacity var(--dur-fast) var(--ease),
      width var(--dur-fast) var(--ease),
      height var(--dur-fast) var(--ease);
  }
  .map-dock:hover,
  .map-dock:focus-within,
  .map-dock.expanded,
  .map-dock.mobile-open {
    opacity: 1;
  }
  .map-dock.expanded {
    width: min(560px, 52vw);
    height: min(440px, 65vh);
  }
  .mobile-sheet-head,
  .mobile-map-fab {
    display: none;
  }

  .map-frame {
    flex: 1;
    min-height: 0;
  }

  .answer-bar {
    padding: var(--sp-2) var(--sp-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    border-top: 1px solid var(--line);
    background-color: var(--asphalt-900);
  }

  .status-text {
    margin: 0;
    font-size: 0.82rem;
    color: var(--paper-dim);
  }

  .status-text.accepted {
    color: var(--ok);
    font-weight: 600;
  }

  .status-text.warn {
    color: var(--signal);
  }

  .guess-btn {
    flex-shrink: 0;
  }

  .loading-veil {
    position: absolute;
    inset: 0;
    background-color: var(--asphalt-900);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-4);
    z-index: 24;
  }

  .loading-box {
    width: 100%;
    max-width: 420px;
    padding: 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .loading-round,
  .loading-label,
  .muted,
  .err-line {
    margin: 0;
  }

  .loading-round {
    font-family: var(--font-display);
    color: var(--paint);
  }

  .countdown {
    font-size: 4.2rem;
    color: var(--paper);
  }

  .err-line {
    color: var(--signal);
    font-weight: 700;
  }

  .muted {
    color: var(--paper-dim);
    font-size: 0.88rem;
  }

  .err-actions {
    display: flex;
    justify-content: center;
    gap: var(--sp-2);
  }

  @media (max-width: 899px) {
    .hud-top {
      flex-wrap: wrap;
    }

    .hud-left {
      top: calc(var(--hud-height) + 2 * var(--sp-3));
    }

    .mobile-map-fab {
      display: inline-flex;
      position: absolute;
      right: var(--sp-3);
      bottom: 2.2rem;
      z-index: 25;
    }

    .map-dock {
      display: none;
    }

    .map-dock.mobile-open {
      display: flex;
      inset: 0;
      width: 100%;
      height: 100%;
      border-radius: 0;
      z-index: 45;
    }

    .mobile-sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-2) var(--sp-3);
      border-bottom: 1px solid var(--line);
    }
  }
</style>
