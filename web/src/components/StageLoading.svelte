<script lang="ts">
  import { onMount } from 'svelte';

  let anchor: HTMLSpanElement;
  let ready = $state(0);
  let total = $state(0);
  let loading = $state(true);
  let slow = $state(false);
  let dismissed = $state(false);
  const message = $derived(loading && !dismissed);

  onMount(() => {
    const lineup = anchor.parentElement;
    if (!lineup) return;
    const painted = new WeakSet<HTMLCanvasElement>();
    const refresh = () => {
      const actors = lineup.querySelectorAll('article');
      total = actors.length;
      ready = Array.from(actors).filter((actor) => {
        const canvas = actor.querySelector('canvas');
        if (!canvas) return false;
        // Outfit changes retain the old pixels until their replacement is ready.
        if (canvas.dataset.avatarRenderer) painted.add(canvas);
        return painted.has(canvas);
      }).length;
      loading = ready < total;
      if (!loading) dismissed = false;
    };
    const observer = new MutationObserver(refresh);
    observer.observe(lineup, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-avatar-renderer'],
    });
    refresh();
    return () => {
      observer.disconnect();
    };
  });
  $effect(() => {
    slow = false;
    if (!message) return;
    const timer = window.setTimeout(() => {
      slow = true;
    }, 10000);
    return () => {
      window.clearTimeout(timer);
    };
  });
</script>

<span hidden bind:this={anchor}></span>
{#if message}
  <div class="loading-screen">
    <div role="status">
      <span class="orbit" aria-hidden="true"></span>
      <strong>Загружаем персонажей</strong>
      <progress value={ready} max={Math.max(total, 1)} aria-label="Готовность персонажей"
      ></progress>
      {#if total}<span>{ready} из {total}</span>{/if}
    </div>
    {#if slow}<button type="button" class="btn" onclick={() => (dismissed = true)}
        >Открыть лобби</button
      >{/if}
  </div>
{/if}

<style>
  .loading-screen {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--sp-3);
    color: var(--paper);
    background:
      linear-gradient(var(--orbit-scrim), var(--orbit-scrim)),
      var(--orbit-night) url('/orbit-stage/lunar-drift.webp') center / cover;
  }
  [role='status'] {
    display: grid;
    justify-items: center;
    gap: var(--sp-3);
  }
  strong {
    font-family: var(--font-display);
  }
  progress {
    accent-color: var(--orbit-aqua);
    width: min(220px, 60vw);
    height: 5px;
  }
  .orbit {
    width: 38px;
    height: 38px;
    border: 2px solid var(--orbit-edge);
    border-top-color: var(--orbit-aqua);
    border-radius: 50%;
    animation: orbit 1.1s linear infinite;
  }
  @keyframes orbit {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .orbit {
      animation: none;
    }
  }
</style>
