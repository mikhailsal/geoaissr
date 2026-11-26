<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClientViewState } from '$shared/protocol';
  import { AudioDirector } from '../lib/audio-director';
  import { audioPlayer, audioPreferences } from '../lib/audio-settings.svelte';

  let { view, now, connected }: { view: ClientViewState | null; now: number; connected: boolean } =
    $props();
  const director = new AudioDirector(audioPlayer);

  // A hidden tab keeps its sound: players switch tabs while the bots think and still need to
  // hear an opponent's answer, the push and the next round. Only a lost connection silences it.
  $effect.pre(() => {
    const live = connected;
    audioPlayer.configure(
      {
        effects: audioPreferences.effects,
        music: audioPreferences.music,
        effectsVolume: audioPreferences.effectsVolume,
        musicVolume: audioPreferences.musicVolume,
      },
      live,
    );
    director.update(view, now, live);
  });

  onMount(() => {
    const activate = (): void => {
      void audioPlayer.unlock();
    };
    document.addEventListener('pointerdown', activate);
    document.addEventListener('pointerup', activate);
    document.addEventListener('touchend', activate);
    document.addEventListener('keydown', activate);
    return () => {
      document.removeEventListener('pointerdown', activate);
      document.removeEventListener('pointerup', activate);
      document.removeEventListener('touchend', activate);
      document.removeEventListener('keydown', activate);
      audioPlayer.destroy();
    };
  });
</script>
