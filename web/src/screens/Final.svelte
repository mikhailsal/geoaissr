<script lang="ts">
  import confetti from 'canvas-confetti';
  import type { ClientViewState, RoundResultEntryView } from '$shared/protocol';
  import Avatar from '../components/Avatar.svelte';
  import BotCard from '../components/BotCard.svelte';
  import HostMenu from '../components/HostMenu.svelte';
  import Leaderboard from '../components/Leaderboard.svelte';
  import { formatDistanceRu, formatNumberRu } from '../i18n/format';
  import { attachGlobalKeys, prefersReducedMotion } from '../lib/keys';
  import { RU } from '../i18n/ru';

  interface Props {
    view: ClientViewState;
    onPlayAgain: () => void;
    onEndMatch: () => void;
  }

  let { view, onPlayAgain, onEndMatch }: Props = $props();

  let inspectedCard = $state<{ roundNumber: number; entry: RoundResultEntryView } | null>(null);
  let lastTriggerBtn = $state<HTMLButtonElement | null>(null);
  let confettiPlayed = false;

  const fin = $derived(view.final);
  const topWinners = $derived(fin ? fin.standings.filter((s) => s.rank === 1) : []);
  const bestHuman = $derived(fin?.standings.find((s) => !s.isAi) ?? null);
  const uniqueHumanWon = $derived(
    fin !== undefined &&
      fin.playedRounds > 0 &&
      topWinners.length > 0 &&
      topWinners.every((w) => !w.isAi),
  );
  const roundNums = $derived(
    fin ? Array.from({ length: fin.playedRounds }, (_, idx) => idx + 1) : [],
  );

  const headline = $derived.by(() => {
    if (!fin || fin.playedRounds === 0 || topWinners.length === 0) {
      return RU.final.emptyFinal;
    }
    if (topWinners.length > 1) {
      return RU.final.tieHeading(topWinners.map((w) => w.name));
    }
    const sole = topWinners[0];
    if (!sole) return RU.final.emptyFinal;
    return sole.isAi ? RU.final.winnerAi(sole.name) : RU.final.winnerHuman(sole.name);
  });

  $effect(() => {
    if (uniqueHumanWon && !confettiPlayed && !prefersReducedMotion()) {
      confettiPlayed = true;
      try {
        void confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
      } catch {
        // Ignore headless canvas context unavailability
      }
    }
  });

  function closeInspect(): void {
    inspectedCard = null;
    lastTriggerBtn?.focus();
    lastTriggerBtn = null;
  }

  $effect(() => {
    return attachGlobalKeys(() => ({
      onEscape: () => {
        if (inspectedCard) closeInspect();
      },
    }));
  });
</script>

{#if fin}
  <main class="final-page">
    <header class="top-bar">
      <h1 class="display-title brand">{RU.appName}</h1>
      <HostMenu
        fakeMode={view.fakeMode}
        viewerIsHost={view.viewerIsHost}
        phase={view.phase}
        inviteUrl={view.tunnel.inviteUrl}
        roundNumber={view.roundNumber}
        totalRounds={view.totalRounds}
        {onEndMatch}
      />
    </header>

    <section class="panel hero">
      <h2 class="display-title winner-line">{headline}</h2>
      {#if topWinners.length === 1 && topWinners[0]?.isAi && bestHuman}
        <p class="sub-line">{RU.final.bestHuman(bestHuman.name)}</p>
      {/if}
      {#if fin.playedRounds > 0 && fin.playedRounds < fin.plannedRounds}
        <p class="sub-line">{RU.final.earlyFinish(fin.playedRounds, fin.plannedRounds)}</p>
      {/if}
      {#if fin.humanVsAi.visible}
        <p class="hva-total">
          Люди · ИИ за партию:
          <strong
            >{formatNumberRu(fin.humanVsAi.humansTotal)} : {formatNumberRu(
              fin.humanVsAi.aiTotal,
            )}</strong
          >
        </p>
      {/if}
      {#if view.matchWriteError}
        <p class="warn-line" role="status">{RU.final.matchWriteErr}</p>
      {/if}
    </section>

    {#if fin.standings.length > 0 && fin.playedRounds > 0}
      <Leaderboard standings={fin.standings} />

      <section class="panel matrix-wrap" aria-label="Очки по раундам">
        <div class="table-scroll">
          <table class="rounds-matrix">
            <thead>
              <tr>
                <th class="sticky-col">Участник</th>
                {#each roundNums as rn (rn)}
                  <th>Р{rn}</th>
                {/each}
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {#each fin.standings as row (row.id)}
                <tr>
                  <td class="sticky-col">
                    <div class="who">
                      <span class="rk">#{row.rank}</span>
                      <Avatar name={row.name} colorId={row.color} isAi={row.isAi} size="sm" />
                      <span>{row.name}</span>
                    </div>
                  </td>
                  {#each roundNums as rn (rn)}
                    {@const cell = row.perRound.find((pr) => pr.roundNumber === rn)}
                    <td>
                      {#if cell && cell.played && cell.score !== null}
                        {#if cell.botCard}
                          <button
                            type="button"
                            class="cell-btn"
                            title="Открыть мысли бота в этом раунде"
                            onclick={(e) => {
                              lastTriggerBtn = e.currentTarget;
                              inspectedCard = cell.botCard
                                ? { roundNumber: rn, entry: cell.botCard }
                                : null;
                            }}
                          >
                            <strong>{formatNumberRu(cell.score)}</strong>
                            {#if cell.distanceKm !== null}
                              <span class="dist">{formatDistanceRu(cell.distanceKm)}</span>
                            {/if}
                          </button>
                        {:else}
                          <div class="cell-static">
                            <strong>{formatNumberRu(cell.score)}</strong>
                            {#if cell.distanceKm !== null}
                              <span class="dist">{formatDistanceRu(cell.distanceKm)}</span>
                            {/if}
                          </div>
                        {/if}
                      {:else}
                        <span class="dist">—</span>
                      {/if}
                    </td>
                  {/each}
                  <td><strong>{formatNumberRu(row.totalScore)}</strong></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if inspectedCard}
      <section aria-label={`Мысли бота в раунде ${inspectedCard.roundNumber}`}>
        <BotCard entry={inspectedCard.entry} onClose={closeInspect} />
      </section>
    {/if}

    <footer class="actions">
      {#if view.viewerIsHost}
        <button type="button" class="btn btn-primary again-btn" onclick={onPlayAgain}>
          {RU.final.playAgain}
        </button>
      {:else}
        <p class="sub-line" role="status">{RU.final.waitingHost}</p>
      {/if}
    </footer>
  </main>
{/if}

<style>
  .final-page {
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
  }

  .brand {
    font-size: 1.75rem;
    color: var(--paint);
  }

  .hero {
    padding: var(--sp-4);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .winner-line {
    font-size: 1.7rem;
    color: var(--paper);
  }

  .sub-line,
  .hva-total {
    margin: 0;
    color: var(--paper-dim);
  }

  .warn-line {
    margin: 0 auto;
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--paint);
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
  }

  .matrix-wrap {
    padding: var(--sp-3);
  }

  .table-scroll {
    overflow-x: auto;
  }

  .rounds-matrix {
    width: 100%;
    border-collapse: collapse;
    min-width: 520px;
  }

  .rounds-matrix th,
  .rounds-matrix td {
    padding: 0.55rem 0.65rem;
    border-bottom: 1px solid var(--line);
    text-align: right;
  }

  .rounds-matrix th:first-child,
  .rounds-matrix td:first-child {
    text-align: left;
  }

  .sticky-col {
    position: sticky;
    left: 0;
    background-color: var(--asphalt-800);
    z-index: 2;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .rk {
    font-family: var(--font-display);
    color: var(--paint);
    min-width: 1.75rem;
  }

  .cell-static,
  .cell-btn {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    background: transparent;
    border: 0;
    padding: 0.2rem 0.35rem;
    border-radius: var(--radius-sm);
  }

  .cell-btn {
    cursor: pointer;
    border: 1px solid var(--line);
  }

  .cell-btn:hover {
    border-color: var(--paint);
  }

  .dist {
    font-size: 0.74rem;
    color: var(--paper-dim);
  }

  .actions {
    display: flex;
    justify-content: center;
  }

  .again-btn {
    min-width: 220px;
    font-size: 1.05rem;
  }
</style>
