<script lang="ts">
  import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Rotate3d,
    Shirt,
    UsersRound,
  } from '@lucide/svelte';
  import { onMount, type Snippet } from 'svelte';
  import { AVATAR_GESTURES, defaultAvatar } from '$shared/avatar';
  import type { ClientViewState } from '$shared/protocol';
  import { formatRoundsRu, pluralizeRu } from '../i18n/format';
  import { REGION_LABELS, RU } from '../i18n/ru';
  import { gestureLabels, type LobbyAvatars } from '../lib/lobby-avatars.svelte';
  import LobbyPerformer from './LobbyPerformer.svelte';

  let {
    view,
    avatars,
    connected,
    onEdit,
    onOpenSettings,
    menu,
  }: {
    view: ClientViewState;
    avatars: LobbyAvatars;
    connected: boolean;
    onEdit: (event: MouseEvent, botId?: string) => void;
    onOpenSettings: () => void;
    menu: Snippet;
  } = $props();

  let page = $state(0);
  let narrow = $state(false);
  let actingBot = $state('');
  const human = defaultAvatar(false);
  const robot = defaultAvatar(true);
  const othersPerPage = $derived(narrow ? 2 : 4);
  const stageBots = $derived(
    view.bots.map((bot, index, bots) => ({
      ...bot,
      slotLabel: bots.some((other) => other.id !== bot.id && other.name === bot.name)
        ? `ИИ №${index + 1} · ${bot.name}`
        : null,
      appearance: bot.avatar ?? robot,
      ai: true,
      available: bot.enabled,
    })),
  );
  const members = $derived([
    ...view.players.map((p) => ({
      ...p,
      slotLabel: null,
      appearance: p.avatar ?? human,
      ai: false,
      available: p.connected,
    })),
    ...stageBots,
  ]);
  const me = $derived(members.find((p) => p.id === view.viewerId));
  const others = $derived(members.filter((p) => p.id !== view.viewerId));
  const pages = $derived(Math.max(1, Math.ceil(others.length / othersPerPage)));
  const current = $derived(Math.min(page, pages - 1));
  const visible = $derived([
    ...(me ? [me] : []),
    ...others.slice(current * othersPerPage, (current + 1) * othersPerPage),
  ]);
  const partySize = $derived(view.players.length + view.bots.filter((b) => b.enabled).length);
  const actor = $derived(view.viewerIsHost ? view.bots.find((b) => b.id === actingBot) : undefined);

  function selectActor(id: string): void {
    actingBot = id;
    const index = others.findIndex((p) => p.id === id);
    if (index >= 0) page = Math.floor(index / othersPerPage);
  }

  onMount(() => {
    const media = window.matchMedia(
      '(max-width: 600px), (orientation: landscape) and (max-height: 480px) and (max-width: 899px)',
    );
    const resize = (): void => {
      narrow = media.matches;
    };
    resize();
    media.addEventListener('change', resize);
    return () => {
      media.removeEventListener('change', resize);
    };
  });
</script>

<section class="scene" aria-label="Сцена лобби">
  <header>
    <div class="room">
      <span class="eyebrow">Лобби</span>
      <h1>{RU.appName}</h1>
      <div class="stats">
        <span>{REGION_LABELS[view.region]}</span>
        <span>{formatRoundsRu(view.totalRounds)}</span>
        <span>{view.moveEnabled ? 'С движением' : 'Без движения'}</span>
        <span class="party-size"
          ><UsersRound size={14} aria-hidden="true" /><b aria-hidden="true">{partySize}</b><span
            class="sr-only">{pluralizeRu(partySize, 'участник', 'участника', 'участников')}</span
          ></span
        >
      </div>
    </div>
    <div class="menu">{@render menu()}</div>
  </header>
  <div class="lineup">
    {#each visible as p, i (p.id)}
      <LobbyPerformer
        member={p}
        position={i}
        pair={visible.length === 2}
        self={p.id === view.viewerId}
        gesture={avatars.playing[p.id]}
        onSpin={() => {
          avatars.spin(p.id);
        }}
        canSpin={connected && avatars.canAnimate}
        onEdit={p.ai && view.viewerIsHost
          ? (event: MouseEvent) => {
              onEdit(event, p.id);
            }
          : undefined}
        {connected}
      />
    {/each}
  </div>
  <div class="deck">
    {#if pages > 1}
      <nav class="paging" aria-label="Страницы сцены">
        <button
          class="page-btn"
          aria-label="Предыдущие участники"
          disabled={current === 0}
          onclick={() => {
            page = current - 1;
          }}><ChevronLeft /></button
        >
        <span>{current + 1} / {pages}</span>
        <button
          class="page-btn"
          aria-label="Следующие участники"
          disabled={current + 1 === pages}
          onclick={() => {
            page = current + 1;
          }}><ChevronRight /></button
        >
      </nav>
    {/if}

    <button
      class="wardrobe btn"
      onclick={(event) => {
        onEdit(event, actor?.id);
      }}
      disabled={!me || !connected}
      ><Shirt size={19} aria-hidden="true" />{actor ? 'Гардероб ИИ' : 'Изменить аватар'}</button
    >
    <div class="performance">
      {#if view.viewerIsHost && view.bots.length}
        <select
          class="actor"
          aria-label="Жесты персонажа"
          value={actor?.id ?? ''}
          onchange={(e) => {
            selectActor(e.currentTarget.value);
          }}
        >
          <option value="">Мои жесты</option>
          {#each stageBots as b (b.id)}
            <option value={b.id}>{b.slotLabel ?? `ИИ · ${b.name}`}</option>
          {/each}
        </select>
      {/if}
      <div class="gestures" role="group" aria-label="Жесты">
        {#each AVATAR_GESTURES as g (g)}
          <button
            class="gesture"
            type="button"
            disabled={!connected || !avatars.canAnimate}
            aria-label={gestureLabels[g]}
            title={gestureLabels[g]}
            onclick={() => {
              avatars.animate(g, actor?.id);
            }}
          >
            {#if g === 'spin'}<Rotate3d size={23} aria-hidden="true" />{:else}<img
                alt=""
                src={'/orbit-stage/emote-' + g + '.png'}
              />{/if}
          </button>
        {/each}
      </div>
    </div>
    <button type="button" class="details-link btn" onclick={onOpenSettings}>
      Участники и настройки <ChevronDown size={18} aria-hidden="true" />
    </button>
  </div>
</section>

<style>
  .scene {
    isolation: isolate;
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    color: var(--paper);
    background: var(--orbit-night) url('/orbit-stage/lunar-drift.webp') center 55% / cover no-repeat;
  }
  header,
  .deck {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-3);
    padding: clamp(14px, 2vw, 28px);
  }
  header {
    background: linear-gradient(var(--orbit-scrim), transparent);
  }
  .eyebrow {
    font-size: 0.78rem;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--orbit-ice);
  }
  h1 {
    margin: 0 0 0.5rem;
    font: italic 850 clamp(1.75rem, 4vw, 3.25rem)/1 var(--font-display);
    letter-spacing: -0.06em;
  }
  .stats,
  .menu :global(.host-menu-bar) {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .stats span,
  .paging {
    border: 1px solid var(--orbit-edge);
    border-radius: var(--radius-sm);
    color: var(--paper);
    background: var(--orbit-plate);
  }
  .stats span {
    padding: 0.22rem 0.55rem;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .party-size {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .lineup {
    position: relative;
    flex: 1 0 min(26dvh, 240px);
  }
  .gesture img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  .paging {
    display: flex;
    width: fit-content;
    align-items: center;
    gap: 2px;
    font-size: 0.85rem;
  }
  .page-btn,
  .gesture,
  .actor,
  .wardrobe {
    background: var(--orbit-plate);
    border: 1px solid var(--orbit-edge);
    color: var(--paper);
    cursor: pointer;
    border-radius: var(--radius-md);
  }
  .page-btn {
    display: grid;
    place-content: center;
    width: 44px;
    border: 0;
  }
  .deck {
    align-items: center;
    gap: var(--sp-2);
    background: linear-gradient(transparent, var(--orbit-scrim));
  }
  .performance {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .gestures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }
  .gesture {
    min-width: 44px;
    display: grid;
    place-items: center;
    padding: 0;
    transition:
      transform var(--dur-fast) var(--ease),
      background var(--dur-fast);
  }
  .gesture:hover:enabled,
  .page-btn:hover:enabled,
  .wardrobe:hover:enabled {
    background: var(--orbit-hover);
  }
  .gesture:hover:enabled {
    transform: translateY(-2px);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .actor {
    padding: 0 var(--sp-2);
    max-width: 11rem;
  }
  .actor option {
    background: var(--orbit-night);
  }
  @media (max-width: 899px) {
    .deck {
      display: grid;
      align-items: center;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas: 'wardrobe details' 'paging actor' 'gestures gestures';
    }
    .wardrobe {
      grid-area: wardrobe;
      justify-self: start;
    }
    .details-link {
      grid-area: details;
      justify-self: end;
    }
    .actor {
      grid-area: actor;
      justify-self: end;
    }
    .paging {
      grid-area: paging;
    }
    .performance {
      display: contents;
    }
    .gestures {
      grid-area: gestures;
      display: grid;
      grid-template-columns: repeat(8, minmax(44px, 1fr));
    }
  }
  @media (max-width: 600px) {
    header,
    .deck {
      padding: var(--sp-2);
    }
    header,
    .stats,
    .menu :global(.host-menu-bar) {
      gap: var(--sp-1);
    }
    .room h1 {
      display: inline;
    }
    .stats span {
      padding: 0.1rem var(--sp-1);
      font-size: 0.75rem;
    }
    .menu :global(.fake-pill) {
      padding-inline: var(--sp-2);
    }
    .wardrobe,
    .details-link {
      padding-inline: var(--sp-2);
      font-size: var(--text-xs);
    }
    .menu {
      width: 100%;
    }
    .menu :global(.btn) {
      padding-inline: var(--sp-2);
      font-size: var(--text-xs);
    }
    .actor {
      max-width: min(32vw, 11rem);
    }
  }
  @media (max-width: 445px) {
    .gestures {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  @media (orientation: landscape) and (max-height: 480px) and (max-width: 899px) {
    .scene {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(246px, 40%);
      grid-template-rows: auto 1fr;
    }
    header {
      grid-column: 1 / -1;
      flex-wrap: nowrap;
    }
    header,
    .deck {
      gap: var(--sp-1);
      padding: var(--sp-1) var(--sp-2);
    }
    .room h1 {
      display: inline;
      font-size: 1.4rem;
    }
    .stats,
    .menu :global(.host-menu-bar) {
      gap: var(--sp-1);
    }
    .stats span {
      padding: 0 var(--sp-1);
    }
    .menu :global(.btn) {
      padding-inline: var(--sp-2);
      font-size: var(--text-xs);
    }
    .menu {
      width: auto;
    }
    .menu :global(.host-menu-bar) {
      flex-wrap: nowrap;
    }
    .menu :global(.fake-pill) {
      padding-inline: var(--sp-1);
      white-space: nowrap;
    }
    .menu :global(.copy-btn) {
      width: var(--control-h);
    }
    .menu :global(.copy-btn span) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .deck {
      align-content: end;
      grid-template-columns: minmax(116px, 1fr) minmax(0, 1fr);
    }
    .wardrobe,
    .details-link {
      width: 100%;
      padding-inline: var(--sp-1);
      font-size: var(--text-xs);
    }
    .actor {
      width: 100%;
      min-width: 0;
    }
    .paging {
      gap: 0;
      max-width: 100%;
      font-size: 0.75rem;
      white-space: nowrap;
    }
    .page-btn {
      flex-shrink: 0;
    }
    .gestures {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
