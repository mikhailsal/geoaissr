<script lang="ts">
  import type { ClientViewState } from '$shared/protocol';
  import { formatNumberRu } from '../i18n/format';

  type MatchStandings = NonNullable<NonNullable<ClientViewState['results']>['matchStandings']>;

  interface Props {
    standings: MatchStandings;
  }

  let { standings }: Props = $props();
</script>

<div class="table-scroll">
  <table class="results-table" data-testid="match-standings-table">
    <thead>
      <tr>
        <th aria-label="Место в партии">#</th>
        <th>Участник</th>
        <th class="num-col">Всего</th>
      </tr>
    </thead>
    <tbody>
      {#each standings as entry (entry.id)}
        <tr>
          <td class="rank-cell">{entry.rank}</td>
          <td><span class="p-name">{entry.name}</span></td>
          <td class="num-col"><strong>{formatNumberRu(entry.totalScore)}</strong></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .table-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .results-table {
    width: 100%;
    border-collapse: collapse;
  }
  .results-table th {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid var(--line);
    color: var(--paper-dim);
    font-size: 0.78rem;
    text-align: left;
  }
  .results-table td {
    padding: 0.55rem 0.5rem;
    border-bottom: 1px solid var(--line);
  }
  .num-col {
    text-align: right !important;
  }
  .p-name {
    overflow-wrap: anywhere;
  }
</style>
