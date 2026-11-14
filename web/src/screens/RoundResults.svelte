<script lang="ts">
  import { untrack } from 'svelte';
  import type { ClientViewState, RoundResultEntryView } from '$shared/protocol';
  import Avatar from '../components/Avatar.svelte';
  import BotCard from '../components/BotCard.svelte';
  import HostMenu from '../components/HostMenu.svelte';
  import ResultsMap from '../components/ResultsMap.svelte';
  import { formatDistanceRu, formatNumberRu, formatSecondsOnly } from '../i18n/format';
  import { attachGlobalKeys, prefersReducedMotion } from '../lib/keys';
  import { RU } from '../i18n/ru';

  interface Props {
    view: ClientViewState;
    browserMapsKey: string | null;
    activeBotCard: { roundNumber: number; entry: RoundResultEntryView } | null;
    remainingAutoNextMs: number;
    onSelectBotCard: (roundNumber: number, entry: RoundResultEntryView) => void;
    onCloseBotCard: () => void;
    onNextRound: (roundNumber: number) => void;
    onEndMatch: () => void;
    onMapLoaded: () => void;
    onClientError: (source: 'maps_js' | 'map', code: string, message: string) => void;
  }

  let {
    view,
    browserMapsKey,
    activeBotCard,
    remainingAutoNextMs,
    onSelectBotCard,
    onCloseBotCard,
    onNextRound,
    onEndMatch,
    onMapLoaded,
    onClientError,
  }: Props = $props();

  let selectedId = $state<string | null>(null);
  let revealCount = $state(0);
  let lastTriggerBtn = $state<HTMLButtonElement | null>(null);

  const res = $derived(view.results);
  const roundKey = $derived(res ? `${view.matchId}:${view.roundNumber}` : '');
  const myEntry = $derived(res?.entries.find((e) => e.id === view.viewerId));
  const anyoneAnswered = $derived(res?.entries.some((e) => e.lat !== null) ?? false);
  const isFinalRound = $derived(view.roundNumber >= view.totalRounds);

  $effect(() => {
    if (!roundKey) return;
    const count = untrack(() => res?.entries.length ?? 0);
    selectedId = null;
    if (count === 0 || prefersReducedMotion()) {
      revealCount = count;
      return;
    }
    revealCount = 1;
    const timer = window.setInterval(() => {
      if (revealCount >= count) {
        window.clearInterval(timer);
        return;
      }
      revealCount += 1;
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  });

  function closeAndRestoreFocus(): void {
    onCloseBotCard();
    lastTriggerBtn?.focus();
    lastTriggerBtn = null;
  }

  $effect(() => {
    return attachGlobalKeys(() => ({
      onSpace: () => {
        if (res) revealCount = res.entries.length;
      },
      onEscape: () => {
        if (activeBotCard) closeAndRestoreFocus();
      },
    }));
  });
</script>

{#if res}
  <main class="results-layout">
    <section class="map-pane" aria-label="Карта результатов">
      <div class="map-top-bar">
        <span class="country-pill panel">{RU.results.correctCountry(res.countryNameRu)}</span>
        <HostMenu
          fakeMode={view.fakeMode}
          viewerIsHost={view.viewerIsHost}
          phase={view.phase}
          inviteUrl={view.tunnel.inviteUrl}
          roundNumber={view.roundNumber}
          totalRounds={view.totalRounds}
          {onEndMatch}
        />
      </div>

      <ResultsMap
        fakeMode={view.fakeMode}
        {browserMapsKey}
        roundNumber={view.roundNumber}
        targetLat={res.targetLat}
        targetLng={res.targetLng}
        countryNameRu={res.countryNameRu}
        entries={res.entries}
        selectedEntryId={selectedId}
        revealNowCount={revealCount}
        onSelectEntry={(entry: RoundResultEntryView) => {
          selectedId = entry.id;
          if (entry.isAi) onSelectBotCard(view.roundNumber, entry);
        }}
        {onMapLoaded}
        {onClientError}
      />
    </section>

    <section class="panel table-pane" aria-label="Таблица раунда">
      <header class="summary-head">
        <div>
          <h1 class="display-title round-title">
            {RU.round.roundTitle(view.roundNumber, view.totalRounds)}
          </h1>
          {#if myEntry}
            <p class="personal-line">
              Ваш результат: {formatNumberRu(myEntry.roundScore)} очков
              {#if myEntry.distanceKm !== null}
                · {formatDistanceRu(myEntry.distanceKm)}
              {/if}
            </p>
          {/if}
        </div>

        {#if res.humanVsAi.visible}
          <div class="hva-box" aria-label="Счёт люди против ИИ">
            <span class="hva-label">Люди · ИИ (среднее)</span>
            <strong class="hva-score">
              {formatNumberRu(res.humanVsAi.humansRound)} : {formatNumberRu(res.humanVsAi.aiRound)}
            </strong>
          </div>
        {/if}
      </header>

      {#if !anyoneAnswered}
        <p class="muted" role="status">{RU.results.noAnswersAtAll}</p>
      {/if}

      {#if res.pausedByReaderName}
        <p class="pause-banner" role="status">{RU.results.pausedBy(res.pausedByReaderName)}</p>
      {/if}

      <div class="table-scroll">
        <table class="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Участник</th>
              <th>Дистанция</th>
              <th class="num-col">Очки</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each res.entries as entry (entry.id)}
              {@const cardOpen = activeBotCard?.entry.id === entry.id}
              <tr
                class:selected-row={selectedId === entry.id}
                onclick={() => (selectedId = entry.id)}
              >
                <td class="rank-cell">{entry.rank}</td>
                <td>
                  <div class="player-cell">
                    <Avatar name={entry.name} colorId={entry.color} isAi={entry.isAi} size="sm" />
                    <span class="p-name">{entry.name}</span>
                  </div>
                </td>
                <td>
                  {#if entry.distanceKm !== null}
                    {formatDistanceRu(entry.distanceKm)}
                  {:else}
                    <span class="muted"
                      >{entry.isAi ? RU.results.noBotGuess : RU.results.noHumanAnswer}</span
                    >
                    {#if entry.isAi && entry.terminationReason && entry.terminationReason !== 'normal'}
                      <span class="muted">· {entry.terminationReason}</span>
                    {/if}
                  {/if}
                </td>
                <td class="num-col"><strong>{formatNumberRu(entry.roundScore)}</strong></td>
                <td class="act-col">
                  {#if entry.isAi}
                    <button
                      type="button"
                      class="btn why-btn"
                      aria-expanded={cardOpen}
                      onclick={(e) => {
                        e.stopPropagation();
                        selectedId = entry.id;
                        if (cardOpen) {
                          closeAndRestoreFocus();
                        } else {
                          lastTriggerBtn = e.currentTarget;
                          onSelectBotCard(view.roundNumber, entry);
                        }
                      }}
                    >
                      {cardOpen ? RU.results.hideWhyBtn : RU.results.whyBtn}
                    </button>
                  {/if}
                </td>
              </tr>

              {#if cardOpen && activeBotCard}
                <tr class="bot-card-row">
                  <td colspan={5}>
                    <BotCard entry={activeBotCard.entry} onClose={closeAndRestoreFocus} />
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>

      <footer class="next-footer">
        <span class="muted" role="status">
          {isFinalRound ? RU.results.hostWaitFinal : RU.results.hostWaitNext}
          {formatSecondsOnly(remainingAutoNextMs / 1000)}
        </span>
        {#if view.viewerIsHost}
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => {
              onNextRound(view.roundNumber);
            }}
          >
            {isFinalRound ? 'К итогам' : RU.results.nextBtn}
          </button>
        {/if}
      </footer>
    </section>
  </main>
{/if}

<style>
  .results-layout {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    height: 100dvh;
    overflow: hidden;
  }

  .map-pane {
    position: relative;
    min-height: 0;
  }

  .map-top-bar {
    position: absolute;
    top: var(--sp-3);
    left: var(--sp-3);
    right: var(--sp-3);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-2);
    z-index: 20;
    pointer-events: none;
  }

  .map-top-bar > :global(*) {
    pointer-events: auto;
  }

  .country-pill {
    padding: 0.55rem 0.9rem;
    font-weight: 700;
    background-color: var(--asphalt-900);
  }

  .table-pane {
    border-radius: 0;
    border-top: 0;
    border-bottom: 0;
    border-right: 0;
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-height: 0;
  }

  .summary-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
  }

  .round-title {
    font-size: 1.25rem;
    color: var(--paint);
  }

  .personal-line,
  .muted {
    margin: 0.25rem 0 0;
    color: var(--paper-dim);
    font-size: 0.9rem;
  }

  .hva-box {
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background-color: var(--asphalt-900);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .hva-label {
    font-size: 0.75rem;
    color: var(--paper-dim);
  }

  .hva-score {
    font-family: var(--font-display);
  }

  .pause-banner {
    margin: 0;
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--paint);
    background-color: var(--asphalt-900);
    font-size: 0.88rem;
  }

  .table-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .results-table {
    width: 100%;
    border-collapse: collapse;
  }

  .results-table th {
    text-align: left;
    font-size: 0.78rem;
    color: var(--paper-dim);
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid var(--line);
  }

  .results-table td {
    padding: 0.55rem 0.5rem;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }

  .selected-row {
    background-color: var(--asphalt-700);
  }

  .player-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .num-col,
  .act-col {
    text-align: right;
  }

  .why-btn {
    min-height: 36px;
    padding: 0 0.65rem;
    font-size: 0.85rem;
  }

  .bot-card-row td {
    padding: var(--sp-2) 0;
  }

  .next-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding-top: var(--sp-2);
    border-top: 1px solid var(--line);
  }

  @media (max-width: 899px) {
    .results-layout {
      grid-template-columns: 1fr;
      grid-template-rows: 42dvh 1fr;
      height: auto;
      min-height: 100dvh;
      overflow: visible;
    }
  }
</style>
