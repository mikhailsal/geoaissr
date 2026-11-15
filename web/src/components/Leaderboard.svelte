<script lang="ts">
  import { flip } from 'svelte/animate';
  import type { ParticipantColorId } from '$shared/colors';
  import { prefersReducedMotion } from '../lib/keys';
  import { formatPointsRu, formatRoundsRu } from '../i18n/format';
  import Avatar from './Avatar.svelte';

  export interface StandingRow {
    id: string;
    name: string;
    color: ParticipantColorId;
    isAi: boolean;
    rank: number;
    totalScore: number;
    answeredRounds: number;
  }

  interface Props {
    standings: readonly StandingRow[];
  }

  let { standings }: Props = $props();

  const topThree = $derived(standings.slice(0, 3));
  const flipDuration = $derived(prefersReducedMotion() ? 0 : 250);
</script>

<div class="podium-grid" role="list" aria-label="Подиум итогов">
  {#each topThree as row (row.id)}
    <div
      class="podium-card panel rank-{row.rank}"
      role="listitem"
      animate:flip={{ duration: flipDuration }}
    >
      <span class="place">#{row.rank}</span>
      <Avatar name={row.name} colorId={row.color} isAi={row.isAi} size="lg" />
      <span class="name">{row.name}</span>
      <strong class="score">{formatPointsRu(row.totalScore)}</strong>
      <span class="sub">{formatRoundsRu(row.answeredRounds)} с ответом</span>
    </div>
  {/each}
</div>

<style>
  .podium-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--sp-3);
  }

  .podium-card {
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
  }

  .rank-1 {
    border-color: var(--paint);
  }

  .place {
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--paint);
  }

  .name {
    font-weight: 700;
  }

  .score {
    font-family: var(--font-display);
    font-size: 1.35rem;
  }

  .sub {
    font-size: 0.8rem;
    color: var(--paper-dim);
  }
</style>
