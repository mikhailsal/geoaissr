<script lang="ts">
  import { tick } from 'svelte';
  import { Minus, Music2, Plus, Slash, Volume2, VolumeX } from '@lucide/svelte';
  import type { AudioKind } from '../lib/audio-catalog';
  import { audioPreferences, setAudioVolume, toggleAudio } from '../lib/audio-settings.svelte';

  const uid = $props.id();
  let root: HTMLDivElement;
  let slider = $state<HTMLInputElement>();
  let trigger: HTMLButtonElement | null = null;
  let open = $state<AudioKind | null>(null);
  let left = $state(12);
  let top = $state(0);
  const channelVolume = (kind: AudioKind): number =>
    audioPreferences[kind === 'music' ? 'musicVolume' : 'effectsVolume'];
  const muted = (kind: AudioKind): boolean => !audioPreferences[kind] || channelVolume(kind) === 0;
  const channelName = (kind: AudioKind): string =>
    kind === 'music' ? 'музыки' : 'звуковых эффектов';

  function close(restoreFocus = false): void {
    open = null;
    if (restoreFocus) trigger?.focus();
  }
  function togglePanel(kind: AudioKind, event: MouseEvent): void {
    if (open === kind) {
      close();
      return;
    }
    trigger = event.currentTarget as HTMLButtonElement;
    const rect = trigger.getBoundingClientRect();
    left = Math.max(12, Math.min(rect.right - 260, window.innerWidth - 272));
    top = rect.bottom + 4;
    open = kind;
    void tick().then(() => {
      if (open === kind) slider?.focus();
    });
  }
  function outside(event: PointerEvent): void {
    if (open && !root.contains(event.target as Node)) close();
  }
  function keyDown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }
</script>

<svelte:document onpointerdown={outside} onkeydown={keyDown} />
<svelte:window
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
  {#if open}
    <div
      id={`${uid}-volume`}
      class="volume-panel panel"
      role="region"
      aria-label={`Громкость ${channelName(open)}`}
      style:left={`${left}px`}
      style:top={`${top}px`}
    >
      <label for={`${uid}-range`}>Громкость {channelName(open)}</label>
      <div class="volume-row">
        <button
          type="button"
          class="btn step"
          aria-label={`Уменьшить громкость ${channelName(open)}`}
          onclick={() => {
            if (open) setAudioVolume(open, (Math.round(channelVolume(open) * 100) - 5) / 100);
          }}><Minus size={18} /></button
        >
        <input
          id={`${uid}-range`}
          bind:this={slider}
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(channelVolume(open) * 100)}
          oninput={(event) => {
            if (open) setAudioVolume(open, event.currentTarget.valueAsNumber / 100);
          }}
        />
        <button
          type="button"
          class="btn step"
          aria-label={`Увеличить громкость ${channelName(open)}`}
          onclick={() => {
            if (open) setAudioVolume(open, (Math.round(channelVolume(open) * 100) + 5) / 100);
          }}><Plus size={18} /></button
        >
      </div>
      <div class="volume-row">
        <output for={`${uid}-range`}>{Math.round(channelVolume(open) * 100)}%</output>
        <button
          type="button"
          class="btn mute-button"
          onclick={() => {
            if (open) toggleAudio(open);
          }}
        >
          {muted(open) ? 'Включить' : 'Выключить'}
          {open === 'music' ? 'музыку' : 'звуковые эффекты'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
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
    box-sizing: border-box;
    width: min(260px, calc(100vw - 24px));
    padding: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    background: var(--asphalt-800);
    box-shadow: var(--shadow-panel);
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
    accent-color: var(--paint);
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
