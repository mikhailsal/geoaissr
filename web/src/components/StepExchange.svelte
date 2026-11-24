<script lang="ts">
  import type { JournalRequest } from '$shared/bot-journal';
  import { BRAIN_TAG, EYES_TAG, answerLine, requestLine } from '../lib/detective-format';

  /** One exchange of a Detective: what the brain asked for and what the eyes answered. */
  let { requests }: { requests: readonly JournalRequest[] } = $props();
</script>

<ol class="exchange" aria-label="Запросы мозга и ответы глаз">
  {#each requests as request (request.n)}
    {@const answer = answerLine(request)}
    <li>
      <p><span class="who">{BRAIN_TAG}</span> {requestLine(request)}</p>
      <p class:status={!answer.answered}>
        <span class="who">{EYES_TAG}</span>
        {answer.text}
        {#if answer.meta}<span class="meta">({answer.meta})</span>{/if}
      </p>
    </li>
  {/each}
</ol>

<style>
  .exchange {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    padding-left: var(--sp-2);
    border-left: 1px solid var(--line);
  }
  p {
    margin: 0;
  }
  .who {
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--paper-dim);
  }
  .status,
  .meta {
    color: var(--paper-dim);
  }
  .meta {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
</style>
