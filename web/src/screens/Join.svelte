<script lang="ts">
  import { untrack } from 'svelte';
  import { PARTICIPANT_COLORS, type ParticipantColorId } from '$shared/colors';
  import type { LobbySummary } from '$shared/protocol';
  import type { AuthScreenError } from '../lib/game-store.svelte';
  import type { SavedUserProfile } from '../lib/profile';
  import InlineState from '../components/InlineState.svelte';
  import { formatRoundsRu } from '../i18n/format';
  import { normalizeProfileToken } from '../lib/profile';
  import { RU } from '../i18n/ru';

  interface Props {
    authState: 'checking' | 'error' | 'ready';
    authError: AuthScreenError | null;
    fakeMode: boolean;
    lobbySummary: LobbySummary | null;
    joinPending: boolean;
    joinError: { code: string; message: string } | null;
    savedProfile: SavedUserProfile | null;
    sessionActive: boolean;
    onLogout: () => void;
    onRetry: () => void;
    onLogin: (code: string) => void;
    onCodeLogin: () => void;
    onJoin: (nick: string, color: ParticipantColorId) => void;
  }

  let {
    authState,
    authError,
    fakeMode,
    lobbySummary,
    joinPending,
    joinError,
    savedProfile,
    sessionActive,
    onLogout,
    onRetry,
    onLogin,
    onCodeLogin,
    onJoin,
  }: Props = $props();

  let nick = $state(untrack(() => savedProfile?.nick ?? ''));
  let selectedColor = $state<ParticipantColorId>(untrack(() => savedProfile?.color ?? 'p-1'));
  let dismissNarrow = $state(false);
  let viewportNarrow = $state(typeof window !== 'undefined' ? window.innerWidth < 900 : false);
  let nickInput = $state<HTMLInputElement | null>(null);

  let profileCode = $state('');
  const loginMode = $derived(
    authState === 'error' && authError !== 'replaced_tab' && !sessionActive,
  );
  const isMidMatch = $derived(lobbySummary !== null && lobbySummary.phase !== 'LOBBY');
  const disconnectedNames = $derived(lobbySummary?.disconnected ?? []);
  const trimNick = $derived(nick.trim());

  $effect(() => {
    if (authState === 'ready') {
      nickInput?.focus();
    }
  });

  $effect(() => {
    const onResize = (): void => {
      viewportNarrow = window.innerWidth < 900;
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  });

  const authErrorText = $derived.by(() => {
    switch (authError) {
      case 'no_token':
        return '';
      case 'invalid_profile_token':
        return 'Неверный код профиля.';
      case 'profile_store_unavailable':
        return 'Профили временно недоступны. Попробуйте позже.';
      case 'invalid_token':
        return RU.join.invalidLink;
      case 'replaced_tab':
        return RU.connection.replacedTab;
      case 'room_full':
        return RU.join.roomFull;
      default:
        return RU.join.serverUnreachable;
    }
  });

  function handleSubmit(event: Event): void {
    event.preventDefault();
    if (!trimNick || joinPending) return;
    onJoin(trimNick, selectedColor);
  }
</script>

<main class="join-page">
  <section class="join-card panel" aria-labelledby="join-title">
    <header class="brand-head">
      <h1 id="join-title" class="display-title brand">{RU.appName}</h1>
      {#if fakeMode}
        <span class="fake-tag">{RU.fakeModeBadge}</span>
      {/if}
    </header>

    {#if viewportNarrow && !dismissNarrow}
      <div class="narrow-box" role="note">
        <p>{RU.join.narrowWarning}</p>
        <button type="button" class="btn" onclick={() => (dismissNarrow = true)}>
          {RU.join.enterAnyway}
        </button>
      </div>
    {:else if authState === 'checking'}
      <InlineState variant="loading" message={RU.join.checkingLink} />
    {:else if loginMode}
      <h2>Войти по коду</h2>
      {#if savedProfile}<button class="btn" onclick={onLogout}>Выйти</button>{/if}
      {#if joinError}<p role="alert">{joinError.message}</p>{/if}
      <p>Введите сохранённый код профиля. Для нового профиля нужна ссылка приглашения.</p>
      {#if authErrorText}<p class="err-msg" role="alert">{authErrorText}</p>{/if}
      <form
        class="join-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (normalizeProfileToken(profileCode)) onLogin(profileCode);
        }}
      >
        <label class="field"
          ><span class="lbl">Код профиля</span><input
            class="field-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            bind:value={profileCode}
            required
          /></label
        >
        {#if profileCode && !normalizeProfileToken(profileCode)}<p class="err-msg">
            Введите 32 шестнадцатеричных символа кода.
          </p>{/if}
        <button class="btn btn-primary" disabled={!normalizeProfileToken(profileCode)}
          >Войти по коду</button
        >
      </form>
      {#if authError === 'unreachable' || authError === 'profile_store_unavailable' || authError === 'room_full'}<button
          class="btn"
          onclick={onRetry}>Попробовать снова</button
        >{/if}
    {:else if authState === 'error'}
      <InlineState
        variant="error"
        message={authErrorText}
        actionLabel={['unreachable', 'profile_store_unavailable', 'room_full'].includes(
          authError ?? '',
        )
          ? RU.join.retry
          : undefined}
        onAction={onRetry}
      />
    {:else}
      {#if lobbySummary}
        <p class="context-line">
          Людей: {lobbySummary.humans.length} · ИИ: {lobbySummary.aiCount} ·
          {formatRoundsRu(lobbySummary.totalRounds)}
        </p>
      {/if}

      {#if isMidMatch && lobbySummary}
        <p class="notice" role="status">
          {RU.join.spectatorNotice(lobbySummary.roundNumber, lobbySummary.totalRounds)}
        </p>
      {/if}

      {#if disconnectedNames.length > 0}
        <p class="notice" role="status">{RU.join.reconnectHint(disconnectedNames)}</p>
      {/if}

      <button class="btn" onclick={onCodeLogin}>Войти по коду</button>
      <form class="join-form" onsubmit={handleSubmit}>
        <label class="field">
          <span class="lbl">{RU.join.nameLabel}</span>
          <input
            bind:this={nickInput}
            type="text"
            class="field-input"
            maxlength={20}
            required
            placeholder="Например, Оля"
            bind:value={nick}
          />
          <span class="hint">{RU.join.nameHint}</span>
        </label>

        <fieldset class="color-group">
          <legend class="lbl">{RU.join.colorLabel}</legend>
          <div class="swatches" role="radiogroup" aria-label={RU.join.colorLabel}>
            {#each PARTICIPANT_COLORS as c (c.id)}
              <button
                type="button"
                class="swatch"
                class:selected={selectedColor === c.id}
                style="background-color: var({c.cssVar}); color: var({c.inkToken});"
                role="radio"
                aria-checked={selectedColor === c.id}
                aria-label={c.labelRu}
                onclick={() => (selectedColor = c.id)}
              >
                {#if selectedColor === c.id}✓{/if}
              </button>
            {/each}
          </div>
        </fieldset>

        {#if joinError}
          <p class="err-msg" role="alert">{joinError.message}</p>
        {/if}

        <button
          type="submit"
          class="btn btn-primary submit-btn"
          disabled={!trimNick || joinPending}
        >
          {#if joinPending}
            {RU.join.submitting}
          {:else if isMidMatch}
            {RU.join.submitSpectate}
          {:else}
            {RU.join.submitEnter}
          {/if}
        </button>
      </form>
    {/if}
  </section>
</main>

<style>
  .join-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-4);
  }

  .join-card {
    width: 100%;
    max-width: 440px;
    padding: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .brand-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
  }

  .brand {
    font-size: 2rem;
    color: var(--paint);
  }

  .fake-tag {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--paint);
    color: var(--paint);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .context-line,
  .hint {
    margin: 0;
    color: var(--paper-dim);
    font-size: 0.88rem;
  }

  .notice,
  .narrow-box {
    margin: 0;
    padding: var(--sp-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--paint);
    background-color: var(--asphalt-900);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .narrow-box p {
    margin: 0;
  }

  .join-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .lbl {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .color-group {
    border: 0;
    padding: 0;
    margin: 0;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.5rem;
    margin-top: 0.45rem;
  }

  .swatch {
    height: var(--control-h);
    border-radius: var(--radius-sm);
    border: 2px solid transparent;
    font-weight: 700;
    cursor: pointer;
  }

  .swatch.selected {
    border-color: var(--paper);
    outline: 2px solid var(--paint);
  }

  .swatch:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .err-msg {
    margin: 0;
    color: var(--signal);
    font-weight: 600;
  }

  .submit-btn {
    width: 100%;
    font-size: 1rem;
  }
</style>
