<script lang="ts">
  import { ChevronLeft, ChevronRight, Rotate3d, Shirt, UsersRound } from '@lucide/svelte';
  import { onMount, type Snippet } from 'svelte';
  import { AVATAR_GESTURES, defaultAvatar } from '$shared/avatar';
  import type { ClientViewState } from '$shared/protocol';
  import { formatRoundsRu, pluralizeRu } from '../i18n/format';
  import { REGION_LABELS, RU } from '../i18n/ru';
  import { gestureLabels, type LobbyAvatars } from '../lib/lobby-avatars.svelte';
  import OrbitAvatar from './OrbitAvatar.svelte';

  let {
    view,
    avatars,
    connected,
    onEdit,
    menu,
  }: {
    view: ClientViewState;
    avatars: LobbyAvatars;
    connected: boolean;
    onEdit: (event: MouseEvent) => void;
    menu: Snippet;
  } = $props();

  let page = $state(0);
  let narrow = $state(false);
  let actingBot = $state('');
  const human = defaultAvatar(false);
  const robot = defaultAvatar(true);
  const othersPerPage = $derived(narrow ? 2 : 4);
  const members = $derived([
    ...view.players.map((p) => ({
      ...p,
      appearance: p.avatar ?? human,
      ai: false,
      available: p.connected,
    })),
    ...view.bots.map((b) => ({
      ...b,
      appearance: b.avatar ?? robot,
      ai: true,
      available: b.enabled,
    })),
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
    const media = window.matchMedia('(max-width: 600px)');
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
  <div class="lineup" class:pair={visible.length === 2}>
    {#each visible as p, i (p.id)}
      {@const gesture = avatars.playing[p.id]}
      <article
        aria-label={p.name}
        class="performer pos-{i}"
        class:away={!p.available}
        data-gesture={gesture?.kind}
        data-base={p.appearance.base}
      >
        <div class="figure">
          <OrbitAvatar appearance={p.appearance} label={'Аватар ' + p.name} {gesture} />
        </div>
        <div class="nameplate" style:--participant-color={'var(--' + p.color + ')'}>
          {p.name} · {p.id === view.viewerId ? 'Вы' : p.ai ? 'ИИ' : 'Игрок'}
        </div>
        <div class="action-cue" role="status" aria-atomic="true">
          {#if gesture}
            <span class="sr-only">{p.name} — {gestureLabels[gesture.kind]}</span>
            {#if gesture.kind === 'spin'}
              <Rotate3d aria-hidden="true" />
            {:else}
              <img alt="" src={'/orbit-stage/emote-' + gesture.kind + '.png'} />
            {/if}
          {/if}
        </div>
      </article>
    {/each}
  </div>
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

  <div class="deck">
    <button class="wardrobe btn" onclick={onEdit} disabled={!me || !connected}
      ><Shirt size={19} aria-hidden="true" />Изменить аватар</button
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
          {#each view.bots as b (b.id)}<option value={b.id}>ИИ · {b.name}</option>{/each}
        </select>
      {/if}
      <div class="gestures" role="group" aria-label="Жесты">
        {#each AVATAR_GESTURES as g (g)}
          <button
            class="gesture"
            type="button"
            disabled={!connected}
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
  </div>
</section>

<style>
  .scene {
    isolation: isolate;
    color: var(--paper);
    overflow: hidden;
    border: 1px solid var(--orbit-edge);
    border-radius: var(--sp-4);
    background: var(--orbit-night) url('/orbit-stage/lunar-drift.webp') center 55% / cover no-repeat;
    box-shadow: var(--shadow-panel);
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
  .nameplate,
  .paging,
  .action-cue:not(:empty) {
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
    height: clamp(280px, 30vw, 378px);
  }
  .performer {
    position: absolute;
    width: 26%;
    left: 50%;
    bottom: 0;
    height: 100%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 3;
    pointer-events: none;
  }
  .performer.pos-1,
  .performer.pos-2 {
    width: 22%;
    height: 85%;
    bottom: 6%;
    z-index: 2;
  }
  .performer.pos-1 {
    left: 16%;
  }
  .performer.pos-2 {
    left: 84%;
  }
  .performer.pos-3,
  .performer.pos-4 {
    width: 17%;
    height: 70%;
    bottom: 24%;
    z-index: 1;
  }
  .performer.pos-3 {
    left: 32%;
  }
  .performer.pos-4 {
    left: 68%;
  }
  .pair .pos-0 {
    left: 38%;
  }
  .pair .pos-1 {
    left: 65%;
  }
  .figure {
    width: 100%;
    flex: 1;
    min-height: 0;
  }
  .away .figure {
    opacity: 0.65;
  }
  .nameplate {
    flex: 0 0 auto;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0.12rem 0.55rem;
    font-size: 0.82rem;
    font-weight: 650;
    border-bottom: 2px solid var(--participant-color);
  }
  .action-cue:not(:empty) {
    position: absolute;
    right: 5%;
    top: 3%;
    padding: 5px;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }
  .action-cue img,
  .gesture img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  .paging {
    display: flex;
    width: fit-content;
    margin: var(--sp-2) var(--sp-3) 0 auto;
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
    align-items: flex-end;
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
  @media (max-width: 600px) {
    header,
    .deck {
      padding: var(--sp-3);
    }
    .lineup {
      height: clamp(224px, 57vw, 300px);
    }
    .performer {
      width: 41%;
    }
    .performer.pos-1,
    .performer.pos-2 {
      width: 30%;
      height: 79%;
      bottom: 12%;
    }
    .nameplate {
      font-size: 0.72rem;
      padding-inline: 0.35rem;
    }
    .deck {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }
    .performance {
      display: contents;
    }
    .wardrobe {
      justify-self: start;
      padding-inline: var(--sp-2);
    }
    .gesture {
      min-width: 44px;
    }
    .menu {
      width: 100%;
    }
    .menu :global(.btn) {
      padding-inline: var(--sp-2);
    }
    .gestures {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(8, 1fr);
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
</style>
