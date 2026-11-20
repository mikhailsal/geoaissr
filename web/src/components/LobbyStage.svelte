<script lang="ts">
  import { Settings2, Play, Shirt, UsersRound } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { defaultAvatar, type AvatarGesture } from '$shared/avatar';
  import type { ClientViewState } from '$shared/protocol';
  import { RU } from '../i18n/ru';
  import type { LobbyAvatars } from '../lib/lobby-avatars.svelte';
  import OffstageGestures from './OffstageGestures.svelte';
  import StagePager from './StagePager.svelte';
  import StageLoading from './StageLoading.svelte';
  import LobbyGestures from './LobbyGestures.svelte';
  import LobbyPerformer from './LobbyPerformer.svelte';

  let {
    view,
    avatars,
    connected,
    onEdit,
    onOpenSettings,
    onOpenParticipants,
    starting,
    onStart,
    profileNotice,
    menu,
  }: {
    view: ClientViewState;
    avatars: LobbyAvatars;
    connected: boolean;
    onEdit: (event: MouseEvent, id: string, bot: boolean) => void;
    onOpenSettings: () => void;
    onOpenParticipants: () => void;
    starting: boolean;
    onStart: () => void;
    profileNotice: Snippet;
    menu: Snippet;
  } = $props();

  let page = $state(0);
  let covered = $state(false);
  let scene: HTMLElement;
  let revealId = $state<string | null>(null);
  let actingBot = $state('');
  const human = defaultAvatar(false);
  const robot = defaultAvatar(true);
  const othersPerPage = 5;
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

  function reveal(index: number): void {
    revealId = others[index]?.id ?? null;
    page = Math.floor(index / othersPerPage);
  }
  $effect(() => {
    if (!revealId || covered) return;
    const index = visible.findIndex((member) => member.id === revealId);
    const performer = scene.querySelectorAll('article')[index];
    performer?.querySelector('button')?.focus({ preventScroll: true });
    revealId = null;
  });

  function selectActor(id: string): void {
    actingBot = id;
    const index = others.findIndex((p) => p.id === id);
    if (index >= 0) page = Math.floor(index / othersPerPage);
  }
</script>

<section bind:this={scene} class="scene" aria-label="Сцена лобби">
  <header inert={covered}>
    <div class="room">
      <span class="eyebrow">Лобби</span>
      <h1>{RU.appName}</h1>
      <div class="room-actions">
        <button
          type="button"
          class="btn"
          aria-haspopup="dialog"
          aria-label="Участники"
          title="Участники"
          onclick={onOpenParticipants}
        >
          <UsersRound size={17} aria-hidden="true" /><span>Участники</span><b>{partySize}</b>
        </button>
        <button
          type="button"
          class="btn"
          aria-haspopup="dialog"
          aria-label="Настройки партии"
          title="Настройки партии"
          onclick={onOpenSettings}
        >
          <Settings2 size={17} aria-hidden="true" />Настройки
        </button>
      </div>
    </div>
    <div class="menu">{@render menu()}</div>
  </header>
  <div class="lineup">
    <div inert={covered}>
      {#each visible as p, i (p.id)}
        <LobbyPerformer
          member={p}
          position={i}
          count={visible.length}
          self={p.id === view.viewerId}
          gesture={avatars.playing[p.id]}
          onSpin={() => {
            avatars.spin(p.id);
          }}
          manualYaw={avatars.yawById[p.id] ?? 0}
          onTurn={(yaw: number, final: boolean) => {
            avatars.turn(p.id, yaw, final);
          }}
          canSpin={connected}
          onEdit={(event: MouseEvent) => {
            onEdit(event, p.id, p.ai);
          }}
          editable={p.ai ? view.viewerIsHost : p.id === view.viewerId}
        />
      {/each}
    </div>
    <StageLoading onCover={(value: boolean) => (covered = value)} />
    <div class="profile-notice" inert={covered}>
      {@render profileNotice()}
    </div>
  </div>
  <div class="deck" class:paged={pages > 1} inert={covered}>
    {#if pages > 1}
      <StagePager {current} {pages} onChange={(next: number) => (page = next)} />
      <OffstageGestures
        members={others}
        playing={avatars.playing}
        page={current}
        size={othersPerPage}
        hasActorPicker={view.viewerIsHost && view.bots.length > 0}
        onShow={reveal}
      />
    {/if}

    <button
      class="wardrobe btn"
      onclick={(event) => {
        onEdit(event, actor?.id ?? view.viewerId, Boolean(actor));
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
      <LobbyGestures
        disabled={!connected || !avatars.canAnimate}
        onGesture={(gesture: AvatarGesture) => {
          avatars.animate(gesture, actor?.id);
        }}
      />
    </div>
    {#if view.viewerIsHost}
      <button
        type="button"
        class="launch btn btn-primary"
        disabled={starting || view.startBlockedReasons.length > 0}
        title={view.startBlockedReasons.length ? view.startBlockedReasons.join(' · ') : undefined}
        onclick={onStart}
      >
        <Play size={17} aria-hidden="true" />{starting
          ? RU.lobby.preparingFirstRound
          : RU.lobby.startBtn}
      </button>
    {:else}
      <span class="launch waiting" role="status">Ожидаем старта</span>
    {/if}
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
  .room-actions,
  .menu :global(.host-menu-bar) {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .room-actions .btn {
    padding-inline: var(--sp-2);
    font-size: var(--text-xs);
  }
  .waiting {
    color: var(--paper);
    background: var(--orbit-plate);
    border-radius: var(--radius-sm);
    padding: var(--sp-1) var(--sp-2);
    font-size: var(--text-xs);
  }
  .profile-notice {
    position: absolute;
    z-index: 5;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: min(540px, calc(100% - var(--sp-4)));
    pointer-events: none;
  }
  .profile-notice :global(.save-code-notice) {
    width: 100%;
    margin: 0;
    pointer-events: auto;
  }
  .lineup {
    position: relative;
    flex: 1 0 min(26dvh, 240px);
  }
  .actor,
  .wardrobe {
    background: var(--orbit-plate);
    border: 1px solid var(--orbit-edge);
    color: var(--paper);
    cursor: pointer;
    border-radius: var(--radius-md);
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
  .wardrobe:hover:enabled {
    background: var(--orbit-hover);
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
      grid-template-areas: 'wardrobe launch' 'paging actor' 'gestures gestures';
    }
    .deck:has(.actor):has(:global(.cues > button)) {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      grid-template-areas: 'wardrobe wardrobe actor actor launch launch' 'paging paging paging cue cue cue' 'gestures gestures gestures gestures gestures gestures';
    }
    .deck:has(:global(.cues > button)) .actor {
      min-width: 0;
      max-width: 100%;
    }
    .wardrobe {
      grid-area: wardrobe;
      justify-self: start;
    }
    .launch {
      grid-area: launch;
      justify-self: end;
    }
    .actor {
      grid-area: actor;
      justify-self: end;
    }
    .performance {
      display: contents;
    }
  }
  @media (max-width: 600px) and (orientation: portrait) {
    .room {
      width: 100%;
    }
    .room h1 {
      font-size: clamp(1.27rem, 6vw, 1.75rem);
    }
    .room-actions {
      flex-wrap: nowrap;
    }
    .deck:not(.paged) {
      grid-template-columns: minmax(0, 1fr) auto auto;
      grid-template-areas: 'wardrobe actor launch' 'gestures gestures gestures';
    }
  }
  @media (max-width: 600px) {
    header,
    .deck {
      padding: var(--sp-2);
    }
    header,
    .room-actions,
    .menu :global(.host-menu-bar) {
      gap: var(--sp-1);
    }
    .menu :global(.fake-pill) {
      padding-inline: var(--sp-2);
    }
    .wardrobe,
    .launch {
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
  @media (max-width: 600px) and (orientation: portrait),
    (orientation: landscape) and (min-width: 630px) and (max-height: 330px) {
    .room {
      display: grid;
      grid-template-columns: auto auto;
      align-items: center;
      column-gap: var(--sp-2);
    }
    .room .eyebrow,
    .room h1 {
      grid-column: 1;
      margin: 0;
    }
    .room-actions {
      grid-column: 2;
      grid-row: 1 / 3;
    }
    .room-actions span {
      display: none;
    }
  }
  @media (orientation: landscape) and (max-height: 480px) and (max-width: 899px) {
    .room-actions span {
      display: none;
    }
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
    .room-actions,
    .menu :global(.host-menu-bar) {
      gap: var(--sp-1);
    }
    .room-actions .btn {
      gap: var(--sp-1);
      padding-inline: var(--sp-1);
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
    .launch {
      width: 100%;
      padding-inline: var(--sp-1);
      font-size: var(--text-xs);
    }
    .actor {
      width: 100%;
      min-width: 0;
    }
  }
</style>
