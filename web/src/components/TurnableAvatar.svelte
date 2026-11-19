<script lang="ts">
  import type { AvatarAppearance } from '$shared/avatar';
  import type { OrbitGesture } from '../lib/orbit/types';
  import { nextSpin } from '../lib/avatar-spin';
  import OrbitAvatar from './OrbitAvatar.svelte';

  let {
    appearance,
    name,
    preview = false,
    gesture,
    onSpin,
    disabled = false,
  }: {
    appearance: AvatarAppearance;
    name: string;
    preview?: boolean;
    gesture?: OrbitGesture;
    onSpin?: () => void;
    disabled?: boolean;
  } = $props();
  let localTurn = $state<OrbitGesture | null>(null);
  function turn(): void {
    if (onSpin) onSpin();
    else localTurn = nextSpin(localTurn, Date.now());
  }
</script>

<div class="turntable">
  <OrbitAvatar
    {appearance}
    label={(preview ? 'Предпросмотр: ' : 'Аватар ') + name}
    gesture={preview ? localTurn : gesture}
  />
  <button
    type="button"
    aria-label={'Повернуть на 360°: ' + name}
    title="Повернуть на 360°"
    {disabled}
    onclick={turn}
  ></button>
</div>

<style>
  .turntable {
    position: relative;
    width: 100%;
    height: 100%;
  }
  button {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
  }
  button:focus-visible {
    outline-offset: -3px;
  }
</style>
