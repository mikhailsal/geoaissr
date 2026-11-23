<script lang="ts">
  import type { JournalReportLine } from '$shared/bot-journal';
  import { REPORT_TITLE, reportGroups } from '../lib/detective-format';

  /** The scene report of a Detective's eyes, as the brain read it: grouped lines with frames. */
  let { lines }: { lines: readonly JournalReportLine[] } = $props();
  let groups = $derived(reportGroups(lines));
</script>

<section class="report" aria-label={REPORT_TITLE}>
  <p class="caption">{REPORT_TITLE}</p>
  {#if groups.length === 0}
    <p class="empty">отчёт пуст</p>
  {/if}
  {#each groups as group (group.id)}
    <div class="group">
      <h5>{group.title}</h5>
      <ul>
        {#each group.lines as line, index (`${group.id}-${index}`)}
          <li>{line.text} <span class="ref">(кадр {line.frame})</span></li>
        {/each}
      </ul>
    </div>
  {/each}
</section>

<style>
  .report {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--asphalt-800);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  p,
  h5,
  ul {
    margin: 0;
  }
  .caption,
  .empty,
  .ref {
    color: var(--paper-dim);
  }
  .caption,
  h5 {
    font-size: var(--text-xs);
  }
  h5 {
    font-weight: 600;
  }
  ul {
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .ref {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
