<script lang="ts">
  import { Eye } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import type { AvatarGesture } from '$shared/avatar';
  import { gestureLabels } from '../lib/lobby-avatars.svelte';
  import type { OrbitGesture } from '../lib/orbit/types';

  interface Member {
    id: string;
    name: string;
    slotLabel: string | null;
  }
  let {
    members,
    playing,
    page,
    size,
    hasActorPicker,
    onShow,
  }: {
    members: Member[];
    playing: Record<string, OrbitGesture | undefined>;
    page: number;
    size: number;
    hasActorPicker: boolean;
    onShow: (index: number) => void;
  } = $props();

  let seen: Record<string, OrbitGesture> = {};
  let notices = $state.raw<Record<string, AvatarGesture>>({});

  $effect(() => {
    const previous = untrack(() => notices);
    const next: typeof previous = {};
    const received: typeof seen = {};
    members.forEach(({ id }, index) => {
      const motion = playing[id];
      if (motion) received[id] = motion;
      if (Math.floor(index / size) === page) return;
      if (motion && motion !== seen[id]) next[id] = motion.kind;
      else if (previous[id]) next[id] = previous[id];
    });
    seen = received;
    notices = next;
  });
</script>

<div
  class="cues"
  class:guestRow={!hasActorPicker}
  aria-live="polite"
  aria-relevant="additions text"
>
  {#each members as member, index (member.id)}
    {@const gesture = notices[member.id]}
    {#if gesture}
      {@const name = member.slotLabel ?? member.name}
      <button
        type="button"
        class="btn"
        onclick={() => {
          onShow(index);
        }}
        aria-label={'Показать на сцене: ' + name + ' — ' + gestureLabels[gesture]}
        title={'Показать на сцене: ' + name + ' — ' + gestureLabels[gesture]}
      >
        <Eye size={16} aria-hidden="true" />
        <span><strong>{name}</strong><small>{gestureLabels[gesture]}</small></span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .cues {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .cues:empty {
    position: absolute;
    width: 0;
    height: 0;
  }
  button {
    flex: none;
    max-width: 100%;
    padding-inline: var(--sp-2);
    text-align: start;
    background: var(--asphalt-800);
    color: var(--paper);
  }
  button span {
    min-width: 0;
  }
  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.15;
  }
  small {
    font-size: var(--text-xs);
    color: var(--paper-dim);
  }
  @media (max-width: 899px) {
    .cues {
      grid-area: cue;
    }
    .guestRow {
      grid-area: actor;
    }
  }
</style>
