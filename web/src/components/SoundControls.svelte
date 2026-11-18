<script lang="ts">
  import { Music2, Slash, Volume2, VolumeX } from '@lucide/svelte';
  import { audioPreferences, toggleAudio } from '../lib/audio-settings.svelte';
</script>

<div class="sound-controls" role="group" aria-label="Настройки звука">
  <button
    type="button"
    class="btn sound-toggle"
    aria-label="Звуковые эффекты"
    aria-pressed={audioPreferences.effects}
    title={audioPreferences.effects ? 'Выключить звуковые эффекты' : 'Включить звуковые эффекты'}
    onclick={() => {
      toggleAudio('effects');
    }}
  >
    {#if audioPreferences.effects}<Volume2 size={18} />{:else}<VolumeX size={18} />{/if}
  </button>
  <button
    type="button"
    class="btn sound-toggle"
    aria-label="Фоновая музыка"
    aria-pressed={audioPreferences.music}
    title={audioPreferences.music ? 'Выключить фоновую музыку' : 'Включить фоновую музыку'}
    onclick={() => {
      toggleAudio('music');
    }}
    ><Music2 size={18} />{#if !audioPreferences.music}<span class="muted-mark"
        ><Slash size={22} /></span
      >{/if}</button
  >
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
  .sound-toggle[aria-pressed='false'] {
    color: var(--paper-dim);
  }
</style>
