<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClientViewState } from '$shared/protocol';
  import { AudioDirector } from '../lib/audio-director';
  import { audioPlayer, audioPreferences } from '../lib/audio-settings.svelte';

  let { view, now, connected }: { view: ClientViewState | null; now: number; connected: boolean } =
    $props();
  let visible = $state(true);
  const director = new AudioDirector(audioPlayer);

  $effect.pre(() => {
    const live = connected && visible;
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
    visible = document.visibilityState === 'visible';
    const activate = (): void => {
      void audioPlayer.unlock();
    };
    const visibility = (): void => {
      visible = document.visibilityState === 'visible';
    };
    document.addEventListener('pointerdown', activate);
    document.addEventListener('pointerup', activate);
    document.addEventListener('touchend', activate);
    document.addEventListener('keydown', activate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerdown', activate);
      document.removeEventListener('pointerup', activate);
      document.removeEventListener('touchend', activate);
      document.removeEventListener('keydown', activate);
      document.removeEventListener('visibilitychange', visibility);
      audioPlayer.destroy();
    };
  });
</script>
