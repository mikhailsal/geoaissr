<script lang="ts">
  import { Rotate3d } from '@lucide/svelte';
  import { AVATAR_GESTURES, type AvatarGesture } from '$shared/avatar';
  import { gestureLabels } from '../lib/lobby-avatars.svelte';
  let { disabled, onGesture }: { disabled: boolean; onGesture: (gesture: AvatarGesture) => void } =
    $props();
</script>

<div class="gestures" role="group" aria-label="Жесты">
  {#each AVATAR_GESTURES as g (g)}
    <button
      class="gesture"
      type="button"
      {disabled}
      aria-label={gestureLabels[g]}
      title={gestureLabels[g]}
      onclick={() => {
        onGesture(g);
      }}
    >
      {#if g === 'spin'}<Rotate3d size={23} aria-hidden="true" />{:else}<img
          alt=""
          src={'/orbit-stage/emote-' + g + '.png'}
        />{/if}
    </button>
  {/each}
</div>

<style>
  .gestures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }
  .gesture {
    display: grid;
    place-items: center;
    min-width: var(--control-h);
    padding: 0;
    cursor: pointer;
    border: 1px solid var(--orbit-edge);
    border-radius: var(--radius-md);
    color: var(--paper);
    background: var(--orbit-plate);
    transition:
      transform var(--dur-fast) var(--ease),
      background var(--dur-fast);
  }
  .gesture:hover:enabled {
    transform: translateY(-2px);
    background: var(--orbit-hover);
  }
  .gesture:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .gesture img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  @media (max-width: 899px) {
    .gestures {
      grid-area: gestures;
      display: grid;
      grid-template-columns: repeat(8, minmax(44px, 1fr));
    }
  }
  @media (max-width: 445px),
    (orientation: landscape) and (max-height: 480px) and (max-width: 899px) {
    .gestures {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
