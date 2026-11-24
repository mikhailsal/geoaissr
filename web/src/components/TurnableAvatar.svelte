<script lang="ts">
  import type { AvatarAppearance } from '$shared/avatar';
  import type { OrbitGesture } from '../lib/orbit/types';
  import { nextSpin, spinDuration, spinMotion } from '../lib/orbit/spin';
  import OrbitAvatar from './OrbitAvatar.svelte';

  let {
    appearance,
    name,
    preview = false,
    gesture,
    onSpin,
    disabled = false,
    facingYaw = 0,
    manualYaw = 0,
    onTurn,
    followPointer = false,
  }: {
    appearance: AvatarAppearance;
    name: string;
    preview?: boolean;
    gesture?: OrbitGesture;
    onSpin?: () => void;
    disabled?: boolean;
    facingYaw?: number;
    manualYaw?: number;
    onTurn?: (yaw: number, final: boolean) => void;
    followPointer?: boolean;
  } = $props();
  const instructions = $props.id();
  let localTurn = $state<OrbitGesture | null>(null);
  let previewYaw = $state(0);
  let dragYaw = $state<number | null>(null);
  let pointer: { id: number; x: number; y: number; scale: number; origin: number } | null = null;
  let suppressClick = false;
  const restingYaw = $derived(preview ? previewYaw : manualYaw);
  const motion = $derived(preview ? localTurn : gesture);

  function turn(event: MouseEvent): void {
    if (suppressClick && event.detail !== 0) return;
    if (onSpin) onSpin();
    else localTurn = nextSpin(localTurn, Date.now());
  }

  function currentYaw(): number {
    const now = Date.now();
    if (motion?.kind !== 'spin' || now - motion.at >= spinDuration(motion)) return restingYaw;
    return matchMedia('(prefers-reduced-motion: reduce)').matches
      ? restingYaw
      : restingYaw + spinMotion(motion, now).angle;
  }

  function publish(yaw: number, final: boolean): void {
    if (preview) {
      localTurn = null;
      previewYaw = yaw;
    } else onTurn?.(yaw, final);
  }

  function start(event: PointerEvent & { currentTarget: HTMLButtonElement }): void {
    if (disabled || pointer || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    const width = event.currentTarget.getBoundingClientRect().width;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scale: Math.PI / Math.max(96, width * 0.75),
      origin: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent): void {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    if (dragYaw === null) {
      const threshold = event.pointerType === 'touch' ? 8 : 4;
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(event.clientY - pointer.y)) return;
      pointer.origin = currentYaw();
      suppressClick = true;
    }
    dragYaw = pointer.origin + dx * pointer.scale;
    publish(dragYaw, false);
  }

  function finish(event: PointerEvent): void {
    if (pointer?.id !== event.pointerId) return;
    if (dragYaw !== null) {
      if (event.type === 'pointerup')
        dragYaw = pointer.origin + (event.clientX - pointer.x) * pointer.scale;
      publish(dragYaw, true);
    }
    pointer = null;
    dragYaw = null;
  }

  function keyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 1 : 10) * (Math.PI / 180);
    publish(currentYaw() + (event.key === 'ArrowLeft' ? -step : step), true);
  }
</script>

<div class="turntable">
  <OrbitAvatar
    {appearance}
    label={(preview ? 'Предпросмотр: ' : 'Аватар ') + name}
    gesture={dragYaw !== null && motion?.kind === 'spin' ? null : motion}
    yaw={facingYaw + (dragYaw ?? restingYaw)}
    followPointer={preview || followPointer}
  />
  <span class="sr-only" id={instructions}
    >Поверните перетаскиванием или стрелками. С Shift шаг составляет один градус.</span
  >
  <button
    type="button"
    aria-label={'Повернуть на 360°: ' + name}
    title="Перетащите, чтобы повернуть персонажа. Нажмите для полного оборота."
    aria-describedby={instructions}
    class:dragging={dragYaw !== null}
    onpointerdown={start}
    onpointermove={move}
    onpointerup={finish}
    onpointercancel={finish}
    onlostpointercapture={finish}
    onkeydown={keyboard}
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
    margin-inline: auto;
    width: var(--turn-target-width, 100%);
    height: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: grab;
    touch-action: pan-y pinch-zoom;
    user-select: none;
    pointer-events: auto;
  }
  button.dragging {
    cursor: grabbing;
  }
  button:focus-visible {
    outline-offset: -3px;
  }
</style>
