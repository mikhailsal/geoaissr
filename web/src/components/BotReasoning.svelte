<script lang="ts">
  import type { RoundResultEntryView } from '$shared/protocol';
  import { RU } from '../i18n/ru';
  let { entry }: { entry: RoundResultEntryView } = $props();
</script>

<div class="reasoning">
  {#if entry.facts}<section>
      <h4>Факты и улики</h4>
      <p>{entry.facts}</p>
    </section>{/if}
  {#if entry.rejectedGuesses?.length}
    <section>
      <h4>Исключённые версии</h4>
      <ul>
        {#each entry.rejectedGuesses as rejected, index (`${rejected.guess}-${index}`)}<li>
            <strong>{rejected.guess}</strong> — {rejected.reason}
          </li>{/each}
      </ul>
    </section>
  {/if}
  {#if entry.conclusion || (entry.lat !== null && entry.lng !== null)}
    <section>
      <h4>
        Итоговый вывод {#if entry.usedDraft}<span class="draft">Черновик</span>{/if}
      </h4>
      {#if entry.conclusion}<p>{entry.conclusion}</p>{/if}
      {#if entry.lat !== null && entry.lng !== null}<p class="coordinates">
          {entry.lat.toFixed(5)}, {entry.lng.toFixed(5)}
        </p>{/if}
    </section>
  {/if}
  {#if entry.explanation}<p>{entry.explanation}</p>{/if}
  {#if entry.lat === null || entry.lng === null}<p class="muted">{RU.results.noBotGuess}</p>{/if}
  {#if entry.quip}<blockquote>«{entry.quip}»</blockquote>{/if}
  {#if entry.turnsUsed === 0 && entry.lat !== null && entry.lng !== null}<p class="muted">
      {RU.results.noMovesMade}
    </p>{/if}
</div>

<style>
  .reasoning {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  h4,
  p,
  ul {
    margin: 0;
  }
  h4 {
    font-size: 0.9rem;
    color: var(--paint);
    margin-bottom: var(--sp-1);
  }
  p,
  li {
    white-space: pre-line;
  }
  ul {
    padding-left: var(--sp-4);
  }
  .coordinates,
  .muted {
    color: var(--paper-dim);
    font-size: 0.85rem;
  }
  .draft {
    color: var(--paper);
    background: var(--asphalt-700);
    border-radius: var(--radius-sm);
    padding: var(--sp-1);
    font-size: 0.75rem;
  }
  blockquote {
    margin: 0;
    padding-left: var(--sp-3);
    border-left: 3px solid var(--paint);
    color: var(--paint);
    font-style: italic;
  }
</style>
