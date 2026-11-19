<script lang="ts">
  import { Rotate3d, Shirt } from '@lucide/svelte';
  import type { AvatarAppearance } from '$shared/avatar';
  import type { ParticipantColorId } from '$shared/colors';
  import { gestureLabels } from '../lib/lobby-avatars.svelte';
  import type { OrbitGesture } from '../lib/orbit/types';
  import TurnableAvatar from './TurnableAvatar.svelte';

  interface Member {
    name: string;
    color: ParticipantColorId;
    slotLabel: string | null;
    appearance: AvatarAppearance;
    ai: boolean;
    available: boolean;
  }
  let {
    member,
    position,
    pair,
    self,
    gesture,
    onSpin,
    canSpin,
    onEdit,
    connected,
  }: {
    member: Member;
    position: number;
    pair: boolean;
    self: boolean;
    gesture?: OrbitGesture;
    onSpin: () => void;
    canSpin: boolean;
    onEdit?: (event: MouseEvent) => void;
    connected: boolean;
  } = $props();
  const name = $derived(member.slotLabel ?? member.name);
  const caption = $derived(
    member.slotLabel ?? `${member.name} · ${self ? 'Вы' : member.ai ? 'ИИ' : 'Игрок'}`,
  );
</script>

<article
  aria-label={name}
  class="performer pos-{position}"
  class:pair
  class:away={!member.available}
  data-gesture={gesture?.kind}
  data-base={member.appearance.base}
  style:--participant-color={'var(--' + member.color + ')'}
>
  <div class="figure">
    <TurnableAvatar appearance={member.appearance} {name} {gesture} {onSpin} disabled={!canSpin} />
  </div>
  {#if onEdit}
    <button
      type="button"
      class="nameplate edit"
      aria-label={'Открыть гардероб: ' + name}
      title={'Открыть гардероб: ' + name}
      aria-haspopup="dialog"
      disabled={!connected}
      onclick={onEdit}
    >
      <Shirt size={16} aria-hidden="true" /><span>{caption}</span>
    </button>
  {:else}
    <div class="nameplate">{caption}</div>
  {/if}
  <div class="action-cue" role="status" aria-atomic="true">
    {#if gesture}
      <span class="sr-only">{name} — {gestureLabels[gesture.kind]}</span>
      {#if gesture.kind === 'spin'}<Rotate3d aria-hidden="true" />{:else}<img
          alt=""
          src={'/orbit-stage/emote-' + gesture.kind + '.png'}
        />{/if}
    {/if}
  </div>
</article>

<style>
  .nameplate,
  .action-cue:not(:empty) {
    border: 1px solid var(--orbit-edge);
    border-radius: var(--radius-sm);
    color: var(--paper);
    background: var(--orbit-plate);
  }
  .performer {
    position: absolute;
    width: 26%;
    left: 50%;
    bottom: 0;
    height: 100%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 3;
    pointer-events: none;
  }
  .performer.pos-1,
  .performer.pos-2 {
    width: 22%;
    height: 85%;
    bottom: 6%;
    z-index: 2;
  }
  .performer.pos-1 {
    left: 16%;
  }
  .performer.pos-2 {
    left: 84%;
  }
  .performer.pos-3,
  .performer.pos-4 {
    width: 17%;
    height: 70%;
    bottom: 24%;
    z-index: 1;
  }
  .performer.pos-3 {
    left: 32%;
  }
  .performer.pos-4 {
    left: 68%;
  }
  .pair.pos-0 {
    left: 38%;
  }
  .pair.pos-1 {
    left: 65%;
  }
  .figure {
    width: 100%;
    flex: 1;
    min-height: 0;
  }
  .away .figure {
    opacity: 0.65;
  }
  .nameplate {
    flex: 0 0 auto;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0.12rem 0.55rem;
    font-size: 0.82rem;
    font-weight: 650;
    border-bottom: 2px solid var(--participant-color);
  }
  .action-cue:not(:empty) {
    position: absolute;
    right: 5%;
    top: 3%;
    padding: 5px;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }
  .action-cue img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  .edit {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: var(--control-h);
    pointer-events: auto;
    cursor: pointer;
  }
  .edit span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .edit :global(svg) {
    flex-shrink: 0;
  }
  @media (max-width: 600px),
    (orientation: landscape) and (max-height: 480px) and (max-width: 899px) {
    .performer {
      width: 41%;
    }
    .performer.pos-1,
    .performer.pos-2 {
      width: 30%;
      height: 79%;
      bottom: 12%;
    }
    .nameplate {
      font-size: 0.72rem;
      padding-inline: 0.35rem;
    }
  }
</style>
