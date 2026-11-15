<script lang="ts">
  import { getParticipantColor, type ParticipantColorId } from '$shared/colors';
  import { mountReusableGuessMap, type GoogleGuessMapController } from '../lib/maps-loader';
  import type { FakeMapMarker } from '../lib/fake-canvas';
  import FakeMap from './FakeMap.svelte';
  import { RU } from '../i18n/ru';

  interface Props {
    fakeMode: boolean;
    browserMapsKey: string | null;
    roundNumber: number;
    playerColor: ParticipantColorId;
    pin: { lat: number; lng: number } | null;
    locked: boolean;
    expanded: boolean;
    onPick: (lat: number, lng: number) => void;
    onMapLoaded: () => void;
    onClientError: (source: 'maps_js' | 'map', code: string, message: string) => void;
  }

  let {
    fakeMode,
    browserMapsKey,
    roundNumber,
    playerColor,
    pin,
    locked,
    expanded,
    onPick,
    onMapLoaded,
    onClientError,
  }: Props = $props();

  let googleHost = $state<HTMLDivElement | null>(null);
  let controller = $state<GoogleGuessMapController | null>(null);
  let mapErr = $state<string | null>(null);
  let lastResetRound = -1;
  let lastExpanded = false;
  let hadMapError = false;

  const colorMeta = $derived(getParticipantColor(playerColor));
  const fakeMarkers = $derived<FakeMapMarker[]>(
    pin
      ? [
          {
            id: 'my-pin',
            label: '',
            lat: pin.lat,
            lng: pin.lng,
            fillHex: colorMeta.hex,
            inkHex: colorMeta.inkHex,
          },
        ]
      : [],
  );

  $effect(() => {
    if (fakeMode || !googleHost) return;
    if (!browserMapsKey) {
      mapErr = RU.round.mapsBlocked;
      hadMapError = true;
      onClientError('maps_js', 'missing_key', 'Missing browser Maps key');
      return;
    }
    let cancelled = false;
    void mountReusableGuessMap(browserMapsKey, googleHost)
      .then((ctrl) => {
        if (cancelled) return;
        controller = ctrl;
        mapErr = null;
        if (hadMapError) {
          hadMapError = false;
          onClientError('map', 'OK', '');
        }
        onMapLoaded();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : RU.round.mapLoadError;
        mapErr = RU.round.mapLoadError;
        hadMapError = true;
        onClientError('maps_js', 'guess_map_load', msg);
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (fakeMode || !controller) return;
    controller.setClickHandler(
      locked
        ? null
        : (lat: number, lng: number) => {
            onPick(lat, lng);
          },
    );
  });

  $effect(() => {
    if (fakeMode || !controller) return;
    if (lastResetRound !== roundNumber) {
      lastResetRound = roundNumber;
      controller.resetView();
    }
  });

  $effect(() => {
    if (fakeMode || !controller) return;
    controller.setPin(
      pin
        ? {
            id: 'my-pin',
            lat: pin.lat,
            lng: pin.lng,
            fillHex: colorMeta.hex,
            inkHex: colorMeta.inkHex,
            label: '',
          }
        : null,
    );
  });

  $effect(() => {
    if (!fakeMode && controller && expanded !== lastExpanded) {
      lastExpanded = expanded;
      controller.triggerResize();
    }
  });
</script>

<div class="guess-map-box" data-testid="guess-map">
  {#if fakeMode}
    <FakeMap
      interactive={!locked}
      markers={fakeMarkers}
      fitKey={roundNumber > 0 ? `guess-${roundNumber}` : ''}
      testId="fake-guess-map"
      ariaLabel="Карта для отметки догадки"
      onPick={(lat: number, lng: number) => {
        if (!locked) onPick(lat, lng);
      }}
      onMapReady={onMapLoaded}
    />
  {:else}
    <div class="google-host" bind:this={googleHost}></div>
    {#if mapErr}
      <div class="map-err" role="alert">{mapErr}</div>
    {/if}
  {/if}
</div>

<style>
  .guess-map-box,
  .google-host {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .map-err {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-3);
    background-color: var(--asphalt-900);
    color: var(--signal);
    text-align: center;
  }
</style>
