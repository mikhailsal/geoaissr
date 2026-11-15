<script lang="ts">
  import { Cpu, Trophy } from '@lucide/svelte';
  import { getParticipantColor, type ParticipantColorId } from '$shared/colors';
  import { participantDisplayAria } from '../i18n/format';

  interface Props {
    name: string;
    wins6h?: number;
    colorId: ParticipantColorId;
    isAi?: boolean;
    size?: 'sm' | 'md' | 'lg';
    dimmed?: boolean;
  }

  let { name, wins6h, colorId, isAi = false, size = 'md', dimmed = false }: Props = $props();

  const colorMeta = $derived(getParticipantColor(colorId));
  const initial = $derived(name.trim().slice(0, 1).toUpperCase() || '?');
</script>

<span
  class="avatar size-{size}"
  class:is-ai={isAi}
  class:is-dimmed={dimmed}
  style="background-color: var({colorMeta.cssVar}); color: var({colorMeta.inkToken});"
  aria-label={participantDisplayAria(name, isAi)}
  role="img"
>
  <span aria-hidden="true" class="initial">{initial}</span>
  {#if isAi}
    <span class="ai-badge" aria-hidden="true">
      <Cpu size={10} strokeWidth={2.5} />
    </span>
  {/if}
</span>
{#if wins6h !== undefined}
  <span class="wins" role="img" aria-label={`Побед за 6 часов: ${wins6h} — ${name}`}>
    <Trophy size={14} aria-hidden="true" /> <span aria-hidden="true">{wins6h}</span>
  </span>
{/if}

<style>
  .wins {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 14px;
    color: var(--paper-dim);
  }
  .avatar {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 999px;
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1;
    border: 2px solid var(--paper);
    box-shadow: var(--shadow-panel);
    user-select: none;
  }

  .avatar.is-ai {
    border-radius: 6px;
  }

  .avatar.is-dimmed {
    opacity: 0.48;
    filter: grayscale(0.45);
  }

  .size-sm {
    width: 28px;
    height: 28px;
    font-size: 0.72rem;
  }

  .size-md {
    width: 36px;
    height: 36px;
    font-size: 0.85rem;
  }

  .size-lg {
    width: 44px;
    height: 44px;
    font-size: 1rem;
  }

  .ai-badge {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background-color: var(--asphalt-900);
    color: var(--paper);
    border: 1px solid var(--paper);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
