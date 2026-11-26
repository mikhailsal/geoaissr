<script lang="ts">
  import type { ClientViewState } from '$shared/protocol';
  import { RU } from '../i18n/ru';
  import LobbyDialog from './LobbyDialog.svelte';

  interface Props {
    view: ClientViewState;
    isFinalRound: boolean;
    onNextRound: (roundNumber: number) => void;
    onReady: (roundNumber: number) => void;
  }

  let { view, isFinalRound, onNextRound, onReady }: Props = $props();

  let confirmOpen = $state(false);

  const readyIds = $derived(view.results?.readyIds ?? []);
  // The host never marks themselves ready, and nobody waits for a player who has dropped off.
  const others = $derived(view.players.filter((p) => !p.isHost && p.connected));
  const notReady = $derived(others.filter((p) => !readyIds.includes(p.id)));
  const iAmReady = $derived(readyIds.includes(view.viewerId));

  $effect(() => {
    // The question is about the people named in it: once all of them are ready, it is moot.
    if (notReady.length === 0) confirmOpen = false;
  });

  function next(): void {
    confirmOpen = false;
    onNextRound(view.roundNumber);
  }
</script>

<footer class="next-footer">
  <span class="muted" role="status">
    {#if !view.viewerIsHost}
      {isFinalRound ? RU.results.waitHostFinal : RU.results.waitHostNext}
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
        else next();
      }}
    >
      {isFinalRound ? RU.results.finalBtn : RU.results.nextBtn}
    </button>
  {:else}
    <button
      type="button"
      class="btn btn-primary"
      disabled={iAmReady}
      onclick={() => {
        onReady(view.roundNumber);
      }}
    >
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
    <p class="question">{RU.results.notReadyBody(notReady.map((p) => p.name))}</p>
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
      <button type="button" class="btn btn-primary" onclick={next}>
        {RU.results.notReadyGo}
      </button>
    </div>
  </LobbyDialog>
{/if}

<style>
  .next-footer {
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
