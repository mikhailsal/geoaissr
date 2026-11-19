<script lang="ts">
  import { onMount } from 'svelte';
  import type { AvatarAppearance } from '$shared/avatar';
  import { mountStage } from '../lib/orbit/client';
  import { gestureDuration, type OrbitGesture } from '../lib/orbit/types';

  let {
    appearance,
    label,
    gesture = null,
  }: {
    appearance: AvatarAppearance;
    label: string;
    gesture?: OrbitGesture | null;
  } = $props();

  let canvas: HTMLCanvasElement;
  let stage = $state<ReturnType<typeof mountStage>>();
  let width = $state(0);
  let height = $state(0);
  let visible = $state(false);
  let reduced = $state(false);
  let active = $state<OrbitGesture | null>(null);

  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let intersecting = false;
    const updateMotion = () => {
      reduced = motion.matches;
    };
    const updateVisibility = () => {
      visible = intersecting && !document.hidden;
    };
    const intersection = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      updateVisibility();
    });
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const density = Math.min(window.devicePixelRatio, 1.7);
      width = Math.round(entry.contentRect.width * density);
      height = Math.round(entry.contentRect.height * density);
    });
    resize.observe(canvas);
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', updateVisibility);
    motion.addEventListener('change', updateMotion);
    updateMotion();
    const instance = mountStage(canvas);
    stage = instance;
    return () => {
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      motion.removeEventListener('change', updateMotion);
      instance?.destroy();
    };
  });

  $effect(() => {
    const remaining = gesture ? gesture.at + gestureDuration[gesture.kind] - Date.now() : 0;
    active = remaining > 0 ? gesture : null;
    if (remaining > 0) {
      const timer = setTimeout(() => {
        active = null;
      }, remaining);
      return () => {
        clearTimeout(timer);
      };
    }
  });

  $effect(() => {
    stage?.update({
      appearance: { ...appearance },
      gesture: active ? { ...active } : null,
      width,
      height,
      reduced,
      visible: visible && width > 0 && height > 0,
    });
  });
</script>

<div
  class="orbit-avatar"
  role="img"
  aria-label={label}
  data-avatar-base={appearance.base}
  data-avatar-outfit={appearance.outfit}
  data-avatar-gesture={active?.kind}
>
  <span class="pedestal" aria-hidden="true"></span>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  .orbit-avatar {
    width: 100%;
    height: 100%;
    position: relative;
    isolation: isolate;
    pointer-events: none;
    --rim: var(--orbit-pedestal, var(--orbit-violet));
  }
  .orbit-avatar[data-avatar-base='robot'] {
    --rim: var(--orbit-pedestal, var(--orbit-aqua));
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .pedestal {
    position: absolute;
    bottom: 1.5%;
    left: 50%;
    width: 80%;
    max-width: 34vh;
    height: 10%;
    transform: translateX(-50%);
    border-radius: 50%;
    border: 1px solid var(--rim);
    background: radial-gradient(
      ellipse at 50% 48%,
      var(--orbit-platform-shade) 8%,
      var(--orbit-platform) 60%,
      var(--rim) 97%
    );
    box-shadow:
      0 2px 0 var(--orbit-platform),
      0 4px 0 var(--orbit-aqua),
      0 6px 0 var(--orbit-platform-shade),
      0 7px 14px color-mix(in srgb, var(--rim) 35%, transparent);
  }
</style>
