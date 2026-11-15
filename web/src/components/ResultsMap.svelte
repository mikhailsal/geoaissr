<script lang="ts">
  import { getParticipantColor } from '$shared/colors';
  import type { RoundResultEntryView } from '$shared/protocol';
  import type { FakeMapArc, FakeMapMarker } from '../lib/fake-canvas';
  import { prefersReducedMotion } from '../lib/keys';
  import {
    mountReusableResultsMap,
    type GoogleResultsMapController,
    type PinOverlaySpec,
  } from '../lib/maps-loader';
  import FakeMap from './FakeMap.svelte';
  import { RU } from '../i18n/ru';

  interface Props {
    fakeMode: boolean;
    browserMapsKey: string | null;
    roundNumber: number;
    targetLat: number;
    targetLng: number;
    countryNameRu: string;
    entries: readonly RoundResultEntryView[];
    selectedEntryId: string | null;
    revealNowCount: number;
    onSelectEntry: (entry: RoundResultEntryView) => void;
    onMapLoaded: () => void;
    onClientError: (source: 'maps_js' | 'map', code: string, message: string) => void;
  }

  let {
    fakeMode,
    browserMapsKey,
    roundNumber,
    targetLat,
    targetLng,
    countryNameRu,
    entries,
    selectedEntryId,
    revealNowCount,
    onSelectEntry,
    onMapLoaded,
    onClientError,
  }: Props = $props();

  let googleHost = $state<HTMLDivElement | null>(null);
  let controller = $state<GoogleResultsMapController | null>(null);
  let mapErr = $state<string | null>(null);
  let hadMapError = false;

  const withCoordsWorstFirst = $derived(
    [...entries]
      .filter(
        (e): e is RoundResultEntryView & { lat: number; lng: number } =>
          e.lat !== null && e.lng !== null,
      )
      .reverse(),
  );

  const visibleCount = $derived(
    prefersReducedMotion()
      ? withCoordsWorstFirst.length
      : Math.min(revealNowCount, withCoordsWorstFirst.length),
  );
  const visibleEntries = $derived(withCoordsWorstFirst.slice(0, visibleCount));

  const fakeMarkers = $derived.by<FakeMapMarker[]>(() => {
    const out: FakeMapMarker[] = visibleEntries.map((entry) => {
      const c = getParticipantColor(entry.color);
      return {
        id: entry.id,
        label: entry.name,
        lat: entry.lat,
        lng: entry.lng,
        fillHex: c.hex,
        inkHex: c.inkHex,
        selected: selectedEntryId === entry.id,
      };
    });
    out.push({
      id: '__target__',
      label: countryNameRu,
      lat: targetLat,
      lng: targetLng,
      fillHex: '',
      inkHex: '',
      isTarget: true,
    });
    return out;
  });

  const fakeArcs = $derived.by<FakeMapArc[]>(() =>
    visibleEntries.map((entry) => {
      const c = getParticipantColor(entry.color);
      return {
        id: entry.id,
        fromLat: entry.lat,
        fromLng: entry.lng,
        toLat: targetLat,
        toLng: targetLng,
        colorHex: c.hex,
        highlighted: selectedEntryId === entry.id,
      };
    }),
  );

  $effect(() => {
    if (fakeMode || !googleHost) return;
    if (!browserMapsKey) {
      mapErr = RU.round.mapsBlocked;
      return;
    }
    let cancelled = false;
    void mountReusableResultsMap(browserMapsKey, googleHost)
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
        onClientError('maps_js', 'results_map_load', msg);
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (fakeMode || !controller) return;
    const pins: PinOverlaySpec[] = visibleEntries.map((entry) => {
      const color = getParticipantColor(entry.color);
      return {
        id: entry.id,
        lat: entry.lat,
        lng: entry.lng,
        fillHex: color.hex,
        inkHex: color.inkHex,
        label: entry.name,
        isAi: entry.isAi,
        selected: selectedEntryId === entry.id,
        onClick: () => {
          onSelectEntry(entry);
        },
      };
    });
    controller.render(
      { lat: targetLat, lng: targetLng, label: countryNameRu },
      pins,
      selectedEntryId,
    );
  });
</script>

<div class="results-map-box" data-testid="results-map">
  {#if fakeMode}
    <FakeMap
      interactive={true}
      markers={fakeMarkers}
      arcs={fakeArcs}
      fitKey={`res-${roundNumber}-${targetLat}-${targetLng}`}
      testId="fake-results-map"
      ariaLabel="Карта результатов раунда"
      onMarkerClick={(id: string) => {
        const hit = entries.find((e) => e.id === id);
        if (hit) onSelectEntry(hit);
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
  .results-map-box,
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
    background-color: var(--asphalt-900);
    color: var(--signal);
  }
</style>
