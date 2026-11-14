<script lang="ts">
  import { Compass, Navigation } from '@lucide/svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { renderFakePanoCanvas } from '../lib/fake-canvas';
  import { mountReusableStreetView } from '../lib/maps-loader';
  import { RU } from '../i18n/ru';

  interface Props {
    fakeMode: boolean;
    browserMapsKey: string | null;
    panoId: string;
    fakeSceneIndex: number;
    roundNumber: number;
    moveEnabled: boolean;
    onPanoLoaded: (roundNumber: number, countedLoad: boolean) => void;
    onClientError: (source: 'maps_js' | 'pano', code: string, message: string) => void;
  }

  let {
    fakeMode,
    browserMapsKey,
    panoId,
    fakeSceneIndex,
    roundNumber,
    moveEnabled,
    onPanoLoaded,
    onClientError,
  }: Props = $props();

  let googleHost = $state<HTMLDivElement | null>(null);
  let fakeCanvas = $state<HTMLCanvasElement | null>(null);
  let fakeWrap = $state<HTMLDivElement | null>(null);
  let fakeHeading = $state(90);
  let fakeStep = $state(0);
  let canvasW = $state(1280);
  let canvasH = $state(720);
  let panoErr = $state<string | null>(null);
  let resetForRound = -1;
  let hadPanoError = false;

  const loadedRounds = new SvelteSet<string>();
  let dragging = false;
  let lastX = 0;

  $effect(() => {
    if (resetForRound !== roundNumber) {
      resetForRound = roundNumber;
      fakeHeading = 90;
      fakeStep = 0;
      panoErr = null;
    }
  });

  $effect(() => {
    const el = fakeWrap;
    if (!fakeMode || !el) return;
    const update = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvasW = Math.round(rect.width);
        canvasH = Math.round(rect.height);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  });

  $effect(() => {
    if (!fakeMode || !fakeCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    fakeCanvas.width = Math.round(canvasW * dpr);
    fakeCanvas.height = Math.round(canvasH * dpr);
    const ctx = fakeCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderFakePanoCanvas(ctx, canvasW, canvasH, fakeSceneIndex, fakeHeading, fakeStep);
    if (!loadedRounds.has(`fake:${roundNumber}`)) {
      loadedRounds.add(`fake:${roundNumber}`);
      onPanoLoaded(roundNumber, true);
    }
  });

  $effect(() => {
    if (fakeMode || !googleHost || !panoId) return;
    if (!browserMapsKey) {
      panoErr = RU.round.mapsBlocked;
      hadPanoError = true;
      onClientError('maps_js', 'missing_key', 'Missing browser Maps key');
      return;
    }
    let cancelled = false;
    let statusListener: { remove: () => void } | null = null;
    const loadKey = `${roundNumber}:${panoId}`;
    void mountReusableStreetView(browserMapsKey, googleHost)
      .then((pano) => {
        if (cancelled) return;
        const notifyStatus = (): void => {
          if (cancelled) return;
          const status = pano.getStatus();
          if (status === 'OK') {
            panoErr = null;
            if (hadPanoError) {
              hadPanoError = false;
              onClientError('pano', 'OK', '');
            }
            if (!loadedRounds.has(loadKey)) {
              loadedRounds.add(loadKey);
              onPanoLoaded(roundNumber, true);
            }
          } else {
            panoErr = RU.round.panoError;
            hadPanoError = true;
            onClientError('pano', status, `StreetView status: ${status}`);
          }
        };
        const alreadyLoaded = pano.getPano() === panoId && pano.getStatus() === 'OK';
        statusListener = pano.addListener('status_changed', notifyStatus);
        pano.setOptions({
          linksControl: moveEnabled,
          clickToGo: moveEnabled,
          panControl: true,
          zoomControl: true,
        });
        pano.setPano(panoId);
        pano.setPov({ heading: 0, pitch: 0 });
        if (alreadyLoaded) {
          notifyStatus();
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : RU.round.panoError;
        panoErr = RU.round.panoError;
        hadPanoError = true;
        onClientError('maps_js', 'street_view_load', msg);
      });
    return () => {
      cancelled = true;
      statusListener?.remove();
      statusListener = null;
    };
  });

  function rotateBy(delta: number): void {
    fakeHeading = (fakeHeading + delta + 360) % 360;
  }

  function handlePointerDown(event: PointerEvent): void {
    dragging = true;
    lastX = event.clientX;
    fakeCanvas?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    rotateBy(-dx * 0.28);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      fakeCanvas?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore
    }
  }
</script>

<div class="pano-root" data-fake-pano={fakeMode ? 'true' : 'false'}>
  {#if fakeMode}
    <div class="fake-pano-wrap" bind:this={fakeWrap}>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="pano-focus-layer"
        tabindex="0"
        role="application"
        aria-label="Уличная панорама"
        onkeydown={(e) => {
          if (e.key === 'ArrowLeft') rotateBy(-15);
          if (e.key === 'ArrowRight') rotateBy(15);
        }}
      >
        <canvas
          bind:this={fakeCanvas}
          class="fake-pano-canvas"
          aria-hidden="true"
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerUp}
          onpointercancel={handlePointerUp}
        ></canvas>
      </div>

      <div class="compass-chip panel">
        <Compass size={16} />
        <span>{Math.round(fakeHeading)}°</span>
      </div>

      {#if moveEnabled}
        <div class="fake-move-controls">
          <button type="button" class="btn" onclick={() => (fakeStep += 1)}>
            <Navigation size={16} />
            <span>Шаг вперёд</span>
          </button>
          <button
            type="button"
            class="btn"
            onclick={() => {
              rotateBy(-45);
            }}
          >
            Повернуть
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="google-pano-host" bind:this={googleHost}></div>
  {/if}

  {#if panoErr}
    <div class="pano-error panel" role="alert">{panoErr}</div>
  {/if}
</div>

<style>
  .pano-root,
  .fake-pano-wrap,
  .pano-focus-layer,
  .google-pano-host {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .fake-pano-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    touch-action: none;
  }

  .fake-pano-canvas:active {
    cursor: grabbing;
  }

  .compass-chip {
    position: absolute;
    left: 1rem;
    bottom: 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    background-color: var(--asphalt-900);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .fake-move-controls {
    position: absolute;
    left: 50%;
    bottom: 1rem;
    transform: translateX(-50%);
    display: flex;
    gap: var(--sp-2);
  }

  .pano-error {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: var(--sp-4);
    border-color: var(--signal);
  }
</style>
