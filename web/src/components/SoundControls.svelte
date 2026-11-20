<script lang="ts">
  import LobbyDialog from './LobbyDialog.svelte';
  import { tick } from 'svelte';
  import { Minus, Music2, Plus, Slash, Volume2, VolumeX } from '@lucide/svelte';
  import type { AudioKind } from '../lib/audio-catalog';
  import {
    audioPreferences,
    audioPreferenceSync,
    flushAudioPreferences,
    resetAudioPreferences,
    setAudioVolume,
    toggleAudio,
  } from '../lib/audio-settings.svelte';

  let { modal = false }: { modal?: boolean } = $props();
  const uid = $props.id();
  let root: HTMLDivElement;
  let panel = $state<HTMLDivElement>();
  let slider = $state<HTMLInputElement>();
  let trigger: HTMLButtonElement | null = null;
  let open = $state<AudioKind | null>(null);
  const channelVolume = (kind: AudioKind): number =>
    audioPreferences[kind === 'music' ? 'musicVolume' : 'effectsVolume'];
  const muted = (kind: AudioKind): boolean => !audioPreferences[kind] || channelVolume(kind) === 0;
  const channelName = (kind: AudioKind): string =>
    kind === 'music' ? 'музыки' : 'звуковых эффектов';

  function close(restoreFocus = false): void {
    if (open) flushAudioPreferences();
    open = null;
    if (restoreFocus) trigger?.focus();
  }
  function positionPanel(node: HTMLDivElement): void {
    if (!trigger || !node.matches(':popover-open')) return;
    const anchor = trigger.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const margin = 12;
    const gap = 4;
    const maxLeft = document.documentElement.clientWidth - box.width - margin;
    const maxTop = document.documentElement.clientHeight - box.height - margin;
    let left = anchor.right - box.width;
    let top = anchor.bottom + gap;
    if (top > maxTop) {
      const above = anchor.top - gap - box.height;
      const toggles = root.getBoundingClientRect();
      if (above >= margin) top = above;
      else if (toggles.right + gap <= maxLeft) left = toggles.right + gap;
      else if (toggles.left - gap - box.width >= margin) left = toggles.left - gap - box.width;
    }
    node.style.left = `${Math.max(margin, Math.min(left, maxLeft))}px`;
    node.style.top = `${Math.max(margin, Math.min(top, maxTop))}px`;
  }
  function observePanel(node: HTMLDivElement) {
    const observer = new ResizeObserver(() => {
      positionPanel(node);
    });
    observer.observe(node);
    return {
      destroy: () => {
        observer.disconnect();
      },
    };
  }
  function togglePanel(kind: AudioKind, event: MouseEvent): void {
    if (open === kind) {
      close();
      return;
    }
    trigger = event.currentTarget as HTMLButtonElement;
    open = kind;
    void tick().then(() => {
      if (open !== kind) return;
      if (modal) {
        slider?.focus({ preventScroll: true });
        return;
      }
      if (!panel?.isConnected) return;
      panel.showPopover();
      positionPanel(panel);
      slider?.focus({ preventScroll: true });
    });
  }
  function outside(event: PointerEvent): void {
    if (!modal && open && !root.contains(event.target as Node)) close();
  }
  function keyDown(event: KeyboardEvent): void {
    if (!modal && open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }
</script>

{#snippet controls(open: AudioKind)}
  <div class="volume-heading">
    <label for={`${uid}-range`}>Громкость {channelName(open)}</label><output for={`${uid}-range`}
      >{Math.round(channelVolume(open) * 100)}%</output
    >
  </div>
  <div class="volume-row">
    <button
      type="button"
      class="btn step"
      aria-label={`Уменьшить громкость ${channelName(open)}`}
      onclick={() => {
        setAudioVolume(open, (Math.round(channelVolume(open) * 100) - 5) / 100);
        flushAudioPreferences();
      }}><Minus size={18} /></button
    >
    <input
      id={`${uid}-range`}
      bind:this={slider}
      type="range"
      onchange={flushAudioPreferences}
      onblur={flushAudioPreferences}
      onpointerup={flushAudioPreferences}
      min="0"
      max="100"
      step="1"
      value={Math.round(channelVolume(open) * 100)}
      oninput={(event) => {
        setAudioVolume(open, event.currentTarget.valueAsNumber / 100);
      }}
    />
    <button
      type="button"
      class="btn step"
      aria-label={`Увеличить громкость ${channelName(open)}`}
      onclick={() => {
        setAudioVolume(open, (Math.round(channelVolume(open) * 100) + 5) / 100);
        flushAudioPreferences();
      }}><Plus size={18} /></button
    >
  </div>
  <div class="volume-row">
    <button
      type="button"
      class="btn mute-button"
      aria-label={`${muted(open) ? 'Включить' : 'Выключить'} ${open === 'music' ? 'музыку' : 'звуковые эффекты'}`}
      onclick={() => {
        toggleAudio(open);
      }}
    >
      {muted(open) ? 'Включить' : 'Выключить'}
    </button>
    <button
      type="button"
      class="btn reset-button"
      aria-label="Сбросить настройки звука"
      onclick={resetAudioPreferences}>Сбросить</button
    >
  </div>
  {#if audioPreferenceSync.error}<div class="save-error" role="alert">
      <span>{audioPreferenceSync.error}</span><button
        type="button"
        class="btn"
        onclick={flushAudioPreferences}>Повторить сохранение</button
      >
    </div>{/if}
{/snippet}

<svelte:document onpointerdown={outside} onkeydown={keyDown} />
<svelte:window
  onpagehide={flushAudioPreferences}
  onscroll={() => {
    close();
  }}
  onresize={() => {
    close();
  }}
/>
<div class="sound-controls" role="group" aria-label="Настройки звука" bind:this={root}>
  {#each ['effects', 'music'] as kind (kind)}
    {@const channel = kind as AudioKind}
    <button
      type="button"
      class="btn sound-toggle"
      class:muted={muted(channel)}
      aria-label={channel === 'music' ? 'Фоновая музыка' : 'Звуковые эффекты'}
      title={`Громкость ${channelName(channel)}`}
      aria-expanded={open === channel}
      aria-controls={open === channel ? `${uid}-volume` : undefined}
      onclick={(event) => {
        togglePanel(channel, event);
      }}
    >
      {#if channel === 'music'}
        <Music2 size={18} />
        {#if muted(channel)}<span class="muted-mark"><Slash size={22} /></span>{/if}
      {:else if muted(channel)}<VolumeX size={18} />{:else}<Volume2 size={18} />{/if}
    </button>
  {/each}
  {#if open && modal}
    <LobbyDialog
      title="Настройки звука"
      onClose={() => {
        close(true);
      }}
    >
      <div class="channel-switch" aria-label="Каналы звука" role="group">
        {#each ['effects', 'music'] as kind (kind)}
          <button
            class="btn"
            type="button"
            aria-expanded={open === kind}
            onclick={() => {
              if (open === kind) close(true);
              else {
                flushAudioPreferences();
                open = kind as AudioKind;
              }
            }}>{kind === 'music' ? 'Фоновая музыка' : 'Звуковые эффекты'}</button
          >
        {/each}
      </div>
      <div class="modal-volume" role="region" aria-label={'Громкость ' + channelName(open)}>
        {@render controls(open)}
      </div>
    </LobbyDialog>
  {:else if open}
    <div
      id={`${uid}-volume`}
      class="volume-panel panel"
      popover="manual"
      bind:this={panel}
      use:observePanel
      role="region"
      aria-label={`Громкость ${channelName(open)}`}
    >
      {@render controls(open)}
    </div>
  {/if}
</div>

<style>
  .modal-volume {
    display: grid;
    gap: var(--sp-2);
  }
  .channel-switch {
    display: flex;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
  }
  .channel-switch [aria-expanded='true'] {
    border-color: var(--orbit-aqua);
  }
  @media (orientation: landscape) and (max-height: 430px) {
    .channel-switch {
      margin-bottom: var(--sp-1);
    }
    .modal-volume {
      gap: var(--sp-1);
    }
  }
  .sound-controls {
    display: flex;
    gap: var(--sp-1);
  }
  .sound-toggle {
    position: relative;
    width: var(--control-h);
    padding: 0;
  }
  .muted-mark {
    position: absolute;
    display: flex;
  }
  .muted {
    color: var(--paper-dim);
  }
  .volume-panel {
    position: fixed;
    z-index: 100;
    inset: auto;
    margin: 0;
    box-sizing: border-box;
    width: min(260px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    overflow-y: auto;
    padding: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    color: inherit;
    background: var(--asphalt-800);
    box-shadow: var(--shadow-panel);
  }
  .volume-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
  }
  .volume-heading label {
    min-width: 0;
  }
  .reset-button {
    padding: var(--sp-1) var(--sp-2);
  }
  .save-error {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    color: var(--signal);
  }
  .volume-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .step {
    min-width: var(--control-h);
    padding: 0;
  }
  input {
    min-width: 0;
    width: 100%;
    min-height: var(--control-h);
    accent-color: var(--paper);
  }
  output {
    min-width: 3ch;
    font-variant-numeric: tabular-nums;
  }
  .mute-button {
    flex: 1;
    padding: var(--sp-1) var(--sp-2);
    white-space: normal;
  }
</style>
