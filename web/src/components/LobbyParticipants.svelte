<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import type { ClientViewState } from '$shared/protocol';
  import { PRESET_LABELS, RU } from '../i18n/ru';
  import { fallbackNote, styleSuffix } from '../lib/play-style';
  import Avatar from './Avatar.svelte';

  let {
    view,
    onAddBot,
    onCharacter,
  }: {
    view: ClientViewState;
    onAddBot: () => void;
    onCharacter: (event: MouseEvent, id: string, bot: boolean) => void;
  } = $props();
</script>

<section aria-label="Игроки">
  <h3>{RU.lobby.playersHeading(view.players.length)}</h3>
  <ul>
    {#each view.players as player (player.id)}
      <li>
        <button
          type="button"
          class="entry"
          aria-label={'Открыть персонажа: ' + player.name}
          aria-haspopup="dialog"
          onclick={(event) => {
            onCharacter(event, player.id, false);
          }}
        >
          <Avatar
            wins6h={player.wins6h}
            name={player.name}
            colorId={player.color}
            size="md"
            dimmed={!player.connected}
          />
          <span class="identity"
            ><strong>{player.name}</strong><small>
              {player.isHost ? RU.lobby.hostTag : 'Игрок'}{player.id === view.viewerId
                ? ' · Вы'
                : ''}{player.connected ? '' : ' · ' + RU.lobby.offlineTag}
            </small>{#if player.mapsError}<small class="warning">{player.mapsError}</small
              >{/if}</span
          >
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </li>
    {/each}
  </ul>
  {#if view.players.length === 1}<p>{RU.lobby.aloneHint}</p>{/if}
</section>
<section aria-label="ИИ-соперники">
  <header>
    <h3>{RU.lobby.aiHeading(view.bots.filter((b) => b.enabled).length)}</h3>
    {#if view.viewerIsHost && view.bots.length < 3}
      <button class="btn" type="button" onclick={onAddBot}>{RU.lobby.addBot}</button>
    {/if}
  </header>
  {#if view.bots.length}
    <ul>
      {#each view.bots as bot, index (bot.id)}
        {@const label = view.bots.some((other) => other.name === bot.name && other.id !== bot.id)
          ? `ИИ №${index + 1} · ${bot.name}`
          : bot.name}
        {@const fallback = fallbackNote(bot, view.roundDurationSec)}
        <li>
          <button
            type="button"
            class="entry"
            aria-label={'Настройки ' + label}
            aria-haspopup="dialog"
            onclick={(event) => {
              onCharacter(event, bot.id, true);
            }}
          >
            <Avatar
              wins6h={bot.wins6h}
              name={bot.name}
              colorId={bot.color}
              isAi={true}
              size="sm"
              dimmed={!bot.enabled}
            />
            <span class="identity"
              ><strong>{label}</strong>
              <small
                >{bot.harness} · {bot.model} · {PRESET_LABELS[bot.difficultyPreset]}{styleSuffix(
                  bot,
                  view.roundDurationSec,
                )}{bot.enabled ? '' : ' · выключен'}</small
              >{#if fallback}<small class="warning">{fallback}</small>{/if}
            </span>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{view.viewerIsHost ? RU.lobby.noBotsHost : RU.lobby.noBotsGuest}</p>
  {/if}
</section>

<style>
  section + section {
    margin-top: var(--sp-4);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
  }
  h3 {
    margin: 0;
    color: var(--paper-dim);
    font: 650 0.85rem var(--font-display);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: var(--sp-2) 0;
    display: grid;
    gap: var(--sp-1);
  }
  .entry {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--sp-3);
    padding: var(--sp-2);
    cursor: pointer;
    text-align: start;
    color: var(--paper);
    background: var(--asphalt-700);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .entry:hover {
    border-color: var(--paper-dim);
  }
  .identity {
    flex: 1;
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  small,
  p {
    color: var(--paper-dim);
    font-size: 0.85rem;
  }
  p {
    margin: var(--sp-2) 0;
  }
  .warning {
    color: var(--signal);
  }
</style>
