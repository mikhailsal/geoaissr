<script lang="ts">
  type ResultsTab = 'round' | 'standings';

  let { activeTab, selectTab }: { activeTab: ResultsTab; selectTab: (tab: ResultsTab) => void } =
    $props();

  function moveTab(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let next: ResultsTab = activeTab === 'round' ? 'standings' : 'round';
    if (event.key === 'Home') next = 'round';
    if (event.key === 'End') next = 'standings';
    selectTab(next);
    document
      .getElementById(next === 'round' ? 'round-results-tab' : 'match-standings-tab')
      ?.focus();
  }
</script>

<div class="results-tabs" role="tablist" aria-label="Результаты">
  <button
    id="round-results-tab"
    type="button"
    role="tab"
    tabindex={activeTab === 'round' ? 0 : -1}
    aria-selected={activeTab === 'round'}
    aria-controls={activeTab === 'round' ? 'round-results-panel' : undefined}
    onkeydown={moveTab}
    onclick={() => {
      selectTab('round');
    }}>Раунд</button
  >
  <button
    id="match-standings-tab"
    type="button"
    role="tab"
    tabindex={activeTab === 'standings' ? 0 : -1}
    aria-selected={activeTab === 'standings'}
    aria-controls={activeTab === 'standings' ? 'match-standings-panel' : undefined}
    onkeydown={moveTab}
    onclick={() => {
      selectTab('standings');
    }}>Рейтинг за игру</button
  >
</div>

<style>
  .results-tabs {
    display: flex;
    gap: var(--sp-1);
    border-bottom: 1px solid var(--line);
  }

  .results-tabs button {
    min-height: 44px;
    padding: 0 var(--sp-2);
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--paper-dim);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .results-tabs button[aria-selected='true'] {
    border-bottom-color: var(--signal);
    color: var(--paper);
  }
</style>
