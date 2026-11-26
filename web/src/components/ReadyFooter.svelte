<script lang="ts">
  import type { ClientViewState } from '$shared/protocol';
  import { RU } from '../i18n/ru';
  import LobbyDialog from './LobbyDialog.svelte';

  /** The footer of a screen the host leaves for everyone: round results and the final screen. */
  interface Props {
    view: ClientViewState;
    /** Humans who pressed «Готов» on this screen. */
    readyIds: readonly string[];
    /** Shown to guests: what the host's button will do. */
    waitText: string;
    goLabel: string;
    /** The question's button that leaves without those who are not ready. */
    goAnywayLabel: string;
    question: (names: string[]) => string;
    /** `force`: the host has seen the question. The server refuses an unforced leave while it waits. */
    onGo: (force: boolean) => void;
    onReady: () => void;
  }

  let { view, readyIds, waitText, goLabel, goAnywayLabel, question, onGo, onReady }: Props =
    $props();

  let confirmOpen = $state(false);

  // The host never marks themselves ready, and nobody waits for a player who has dropped off.
  const others = $derived(view.players.filter((p) => !p.isHost && p.connected));
  const notReady = $derived(others.filter((p) => !readyIds.includes(p.id)));
  const iAmReady = $derived(readyIds.includes(view.viewerId));

  $effect(() => {
    // The question is about the people named in it: once all of them are ready, it is moot.
    if (notReady.length === 0) confirmOpen = false;
  });

  function go(force: boolean): void {
    confirmOpen = false;
    onGo(force);
  }
</script>

<footer class="ready-footer">
  <span class="muted" role="status">
    {#if !view.viewerIsHost}
      {waitText}
    {/if}
    {#if others.length > 0}
      <span class="count"
        >{RU.results.readyCount(others.length - notReady.length, others.length)}</span
      >
    {/if}
  </span>
  {#if view.viewerIsHost}
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => {
        if (notReady.length > 0) confirmOpen = true;
        else go(false);
      }}
    >
      {goLabel}
    </button>
  {:else}
    <button type="button" class="btn btn-primary" disabled={iAmReady} onclick={onReady}>
      {iAmReady ? RU.results.readyDone : RU.results.readyBtn}
    </button>
  {/if}
</footer>

{#if confirmOpen}
  <LobbyDialog
    title={RU.results.notReadyTitle}
    onClose={() => {
      confirmOpen = false;
    }}
  >
    <p class="question">{question(notReady.map((p) => p.name))}</p>
    <div class="actions">
      <button
        type="button"
        class="btn"
        onclick={() => {
          confirmOpen = false;
        }}
      >
        {RU.results.notReadyCancel}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => {
          go(true);
        }}
      >
        {goAnywayLabel}
      </button>
    </div>
  </LobbyDialog>
{/if}

<style>
  .ready-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding-top: var(--sp-2);
    border-top: 1px solid var(--line);
  }

  .count {
    display: block;
  }

  .question {
    margin: 0 0 var(--sp-3);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
  }
</style>
