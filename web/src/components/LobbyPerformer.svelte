<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { Eye, Rotate3d, Shirt } from '@lucide/svelte';
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
    count,
    self,
    gesture,
    onSpin,
    manualYaw,
    onTurn,
    canSpin,
    onEdit,
    editable,
  }: {
    member: Member;
    position: number;
    count: number;
    self: boolean;
    gesture?: OrbitGesture;
    onSpin: () => void;
    manualYaw: number;
    onTurn: (yaw: number, final: boolean) => void;
    canSpin: boolean;
    onEdit: (event: MouseEvent) => void;
    editable: boolean;
  } = $props();
  const name = $derived(member.slotLabel ?? member.name);
  // Percent from the lineup's left edge. Each row gets its own horizontal spacing.
  const compactColumns = [
    [],
    [50],
    [50, 78],
    [50, 16, 84],
    [50, 16, 84, 50],
    [50, 16, 84, 31, 69],
    [50, 16, 84, 17, 83, 50],
  ];
  const wideStage = new MediaQuery(
    '(min-width: 760px) and (min-height: 481px) and (min-aspect-ratio: 6/5)',
  );
  // Stagger the rear podiums between the shoulders of the foreground players.
  const wideColumns: Record<number, number[]> = {
    4: [50, 18, 80, 35],
    5: [50, 16, 84, 33, 67],
    6: [50, 24, 84, 37, 67, 10],
  };
  const ensemble = $derived(wideStage.current && count >= 4);
  const column = $derived((ensemble ? wideColumns : compactColumns)[count]?.[position] ?? 50);
  const facingYaw = $derived((50 - column) * 0.012);
  const caption = $derived(
    member.slotLabel ?? `${member.name} · ${self ? 'Вы' : member.ai ? 'ИИ' : 'Игрок'}`,
  );
</script>

<article
  aria-label={name}
  class="performer pos-{position}"
  class:ensemble
  class:crowded={count >= 4}
  class:away={!member.available}
  data-gesture={gesture?.kind}
  data-base={member.appearance.base}
  style:left={`${String(column)}%`}
  style:--participant-color={'var(--' + member.color + ')'}
>
  <div class="figure">
    <TurnableAvatar
      appearance={member.appearance}
      {name}
      {gesture}
      {onSpin}
      {onTurn}
      {manualYaw}
      {facingYaw}
      followPointer={self}
      disabled={!canSpin}
    />
  </div>
  <button
    type="button"
    class="nameplate edit"
    aria-label={'Открыть гардероб: ' + name}
    title={'Открыть гардероб: ' + name}
    aria-haspopup="dialog"
    onclick={onEdit}
  >
    {#if editable}<Shirt size={16} aria-hidden="true" />{:else}<Eye
        size={16}
        aria-hidden="true"
      />{/if}<span>{caption}</span>
  </button>
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
  .crowded.pos-0 {
    height: 53%;
  }
  .crowded.pos-1,
  .crowded.pos-2 {
    height: 51%;
    bottom: 1%;
  }
  .crowded.pos-3,
  .crowded.pos-4,
  .crowded.pos-5 {
    width: 25%;
    height: 46%;
    bottom: 54%;
    z-index: 1;
  }
  .ensemble {
    --turn-target-width: 62%;
  }
  .ensemble.pos-0 {
    width: 36%;
    height: 95%;
    bottom: 1%;
  }
  .ensemble.pos-1,
  .ensemble.pos-2 {
    width: 30%;
    height: 81%;
    bottom: 9%;
  }
  .ensemble.pos-3,
  .ensemble.pos-4,
  .ensemble.pos-5 {
    width: 25%;
    height: 67%;
    bottom: 27%;
  }
  .ensemble.pos-5 {
    width: 20%;
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
    .crowded {
      width: 32%;
    }
    .crowded.pos-1,
    .crowded.pos-2 {
      width: 32%;
      height: 52%;
      bottom: 0;
    }
    .crowded.pos-3,
    .crowded.pos-4,
    .crowded.pos-5 {
      width: 32%;
    }
    .nameplate {
      font-size: 0.72rem;
      padding-inline: 0.35rem;
    }
  }
</style>
