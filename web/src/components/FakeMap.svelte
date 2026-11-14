<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte';
  import {
    clampLat,
    pixelsPerDeg,
    renderFakeMapCanvas,
    screenToLatLng,
    wrapLng,
    type FakeMapArc,
    type FakeMapMarker,
    type MapCamera,
  } from '../lib/fake-canvas';

  interface Props {
    interactive?: boolean;
    markers?: readonly FakeMapMarker[];
    arcs?: readonly FakeMapArc[];
    fitKey?: string;
    testId?: string;
    ariaLabel?: string;
    onPick?: (lat: number, lng: number) => void;
    onMarkerClick?: (id: string) => void;
    onMapReady?: () => void;
  }

  let {
    interactive = true,
    markers = [],
    arcs = [],
    fitKey = '',
    testId = 'fake-map',
    ariaLabel = 'Карта мира',
    onPick,
    onMarkerClick,
    onMapReady,
  }: Props = $props();

  let wrapEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let width = $state(400);
  let height = $state(300);
  let camera = $state<MapCamera>({ centerLat: 20, centerLng: 10, zoom: 1.4 });
  let lastFitKey = '';
  let readyNotified = false;

  let dragging = false;
  let movedPx = 0;
  let lastPointer = { x: 0, y: 0 };

  function fitCameraToMarkers(list: readonly FakeMapMarker[]): void {
    if (list.length === 0) {
      camera = { centerLat: 20, centerLng: 10, zoom: 1.4 };
      return;
    }
    const target = list.find((m) => m.isTarget) ?? list[0];
    if (!target) return;
    let minLat = 90;
    let maxLat = -90;
    let minDlng = 0;
    let maxDlng = 0;
    for (const m of list) {
      minLat = Math.min(minLat, m.lat);
      maxLat = Math.max(maxLat, m.lat);
      const dLng = wrapLng(m.lng - target.lng);
      minDlng = Math.min(minDlng, dLng);
      maxDlng = Math.max(maxDlng, dLng);
    }
    const spanLng = Math.max(12, maxDlng - minDlng);
    const spanLat = Math.max(10, maxLat - minLat);
    const zoomLng = Math.log2((360 * 0.72) / spanLng) + 1;
    const zoomLat = Math.log2((180 * 0.65) / spanLat) + 1;
    camera = {
      centerLat: clampLat((minLat + maxLat) / 2),
      centerLng: wrapLng(target.lng + (minDlng + maxDlng) / 2),
      zoom: Math.max(1.2, Math.min(6, Math.min(zoomLng, zoomLat))),
    };
  }

  $effect(() => {
    if (fitKey && fitKey !== lastFitKey) {
      lastFitKey = fitKey;
      fitCameraToMarkers(markers);
    }
  });

  $effect(() => {
    const el = wrapEl;
    if (!el) return;
    const updateSize = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        width = Math.round(rect.width);
        height = Math.round(rect.height);
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  });

  $effect(() => {
    const canvas = canvasEl;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderFakeMapCanvas(ctx, width, height, camera, markers, arcs);
    if (!readyNotified) {
      readyNotified = true;
      onMapReady?.();
    }
  });

  function zoomBy(delta: number): void {
    camera = { ...camera, zoom: Math.max(1, Math.min(7, camera.zoom + delta)) };
  }

  function handlePointerDown(event: PointerEvent): void {
    dragging = true;
    movedPx = 0;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvasEl?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    movedPx += Math.hypot(dx, dy);
    lastPointer = { x: event.clientX, y: event.clientY };
    const scale = pixelsPerDeg(width, camera.zoom);
    camera = {
      ...camera,
      centerLng: wrapLng(camera.centerLng - dx / scale),
      centerLat: clampLat(camera.centerLat + dy / scale),
    };
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      canvasEl?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if capture already released
    }
    if (movedPx >= 6 || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (onMarkerClick) {
      for (const m of markers) {
        if (m.isTarget) continue;
        const scale = pixelsPerDeg(width, camera.zoom);
        const mx = width / 2 + wrapLng(m.lng - camera.centerLng) * scale;
        const my = height / 2 - (m.lat - camera.centerLat) * scale;
        if (Math.hypot(x - mx, y - my) <= 15) {
          onMarkerClick(m.id);
          return;
        }
      }
    }
    if (interactive && onPick) {
      const picked = screenToLatLng(x, y, camera, width, height);
      onPick(picked.lat, picked.lng);
    }
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.4 : -0.4);
  }

  function handleCanvasKeyDown(event: KeyboardEvent): void {
    const stepDeg = 12 / Math.pow(2, camera.zoom - 1);
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      camera = { ...camera, centerLng: wrapLng(camera.centerLng - stepDeg) };
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      camera = { ...camera, centerLng: wrapLng(camera.centerLng + stepDeg) };
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      camera = { ...camera, centerLat: clampLat(camera.centerLat + stepDeg) };
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      camera = { ...camera, centerLat: clampLat(camera.centerLat - stepDeg) };
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(0.5);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomBy(-0.5);
    } else if (event.key === ' ' && interactive && onPick) {
      event.preventDefault();
      onPick(camera.centerLat, camera.centerLng);
    }
  }
</script>

<div class="fake-map-wrap" bind:this={wrapEl} data-fake-map="true" data-testid={testId}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="map-focus-layer"
    role={interactive ? 'application' : 'img'}
    aria-label={ariaLabel}
    tabindex={interactive ? 0 : -1}
    onkeydown={handleCanvasKeyDown}
  >
    <canvas
      bind:this={canvasEl}
      class="map-canvas"
      aria-hidden="true"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onwheel={handleWheel}
    ></canvas>
  </div>

  {#if interactive}
    <span class="center-crosshair" aria-hidden="true"></span>
  {/if}

  <div class="zoom-controls">
    <button
      type="button"
      class="btn zoom-btn"
      aria-label="Приблизить карту"
      onclick={() => {
        zoomBy(0.6);
      }}
    >
      <Plus size={16} />
    </button>
    <button
      type="button"
      class="btn zoom-btn"
      aria-label="Отдалить карту"
      onclick={() => {
        zoomBy(-0.6);
      }}
    >
      <Minus size={16} />
    </button>
  </div>
</div>

<style>
  .fake-map-wrap,
  .map-focus-layer {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    user-select: none;
  }

  .map-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: crosshair;
    touch-action: none;
  }

  .center-crosshair {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border: 1px solid var(--asphalt-900);
    border-radius: 999px;
    pointer-events: none;
    opacity: 0.45;
  }

  .zoom-controls {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 5;
  }

  .zoom-btn {
    min-width: var(--control-h);
    min-height: var(--control-h);
    padding: 0;
  }
</style>
