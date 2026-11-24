<script lang="ts">
  import type { BotRoundProgressView, PlayerView } from '$shared/protocol';
  import Avatar from './Avatar.svelte';
  import { RU } from '../i18n/ru';

  interface Props {
    players: readonly PlayerView[];
    botProgress?: readonly BotRoundProgressView[];
  }

  let { players, botProgress = [] }: Props = $props();

  const visibleHumans = $derived(players.filter((p) => !p.isSpectator));
</script>

<aside class="rail panel" aria-label="Участники раунда">
  <ul class="list">
    {#each visibleHumans as p (p.id)}
      <li class="row">
        <Avatar wins6h={p.wins6h} name={p.name} colorId={p.color} size="sm" dimmed={!p.connected} />
        <div class="meta">
          <span class="name">{p.name}</span>
          <span class="status" class:done={p.confirmed} class:offline={!p.connected}>
            {#if !p.connected}
              {RU.lobby.offlineTag}
            {:else if !p.panoLoaded}
              {RU.round.loadingTag}
            {:else if p.confirmed}
              {RU.round.answeredTag}
            {:else}
              ищет…
            {/if}
          </span>
        </div>
      </li>
    {/each}

    {#each botProgress as bot (bot.id)}
      <li class="row">
        <Avatar wins6h={bot.wins6h} name={bot.name} colorId={bot.color} isAi={true} size="sm" />
        <div class="meta">
          <span class="name">{bot.name}</span>
          <span
            class="status"
            class:done={bot.status === 'done'}
            class:aborted={bot.status === 'aborted'}
          >
            {#if bot.status === 'done'}
              {RU.round.answeredTag}
            {:else if bot.status === 'aborted'}
              {RU.round.abortedTag}
            {:else}
              {#if bot.playStyle === 'detective'}{RU.playStyle.detective.toLowerCase()} ·{/if}
              ход {bot.turnsUsed}/{bot.moveLimit}
            {/if}
          </span>
        </div>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .rail {
    padding: var(--sp-2);
    max-width: 240px;
    background-color: var(--asphalt-900);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: 0.86rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    font-size: 0.75rem;
    color: var(--paper-dim);
  }

  .status.done {
    color: var(--ok);
  }

  .status.offline,
  .status.aborted {
    color: var(--signal);
  }

  @media (max-width: 1279px) {
    .meta {
      display: none;
    }

    .rail {
      max-width: none;
    }
  }
</style>
