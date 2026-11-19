<script lang="ts">
  import { Check, Copy, MoreVertical } from '@lucide/svelte';
  import type { GamePhase } from '$shared/protocol';
  import { RU } from '../i18n/ru';
  import SoundControls from './SoundControls.svelte';
  import { audioPlayer } from '../lib/audio-settings.svelte';

  interface Props {
    fakeMode: boolean;
    viewerIsHost: boolean;
    phase: GamePhase;
    inviteUrl: string | null;
    roundNumber: number;
    totalRounds: number;
    onEndMatch: () => void;
    onOpenProfile?: (event: MouseEvent) => void;
  }

  let {
    fakeMode,
    viewerIsHost,
    phase,
    inviteUrl,
    roundNumber,
    totalRounds,
    onEndMatch,
    onOpenProfile,
  }: Props = $props();

  let copied = $state(false);
  let menuOpen = $state(false);
  let confirmEnd = $state(false);
  let inviteButton = $state<HTMLButtonElement>();
  let inviteDialog = $state<HTMLDialogElement>();
  let inviteField = $state<HTMLInputElement>();

  const canEndEarly = $derived(viewerIsHost && phase !== 'LOBBY' && phase !== 'FINAL');
  const playedBeforeEnd = $derived(
    phase === 'ROUND_RESULTS' ? roundNumber : Math.max(0, roundNumber - 1),
  );

  async function copyInvite(): Promise<void> {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      copied = true;
      window.setTimeout(() => {
        copied = false;
      }, 2_000);
    } catch {
      copied = false;
      inviteDialog?.showModal();
      inviteField?.select();
    }
    menuOpen = false;
  }

  function handleWindowKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Escape' && menuOpen) {
      menuOpen = false;
      confirmEnd = false;
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class="host-menu-bar">
  <SoundControls />
  {#if onOpenProfile}<button type="button" class="btn" onclick={onOpenProfile}>Профиль</button>{/if}
  {#if fakeMode}
    <span class="fake-pill">{RU.fakeModeBadge}</span>
  {/if}

  {#if inviteUrl}
    <button
      type="button"
      class="btn copy-btn"
      bind:this={inviteButton}
      onclick={() => void copyInvite()}
    >
      {#if copied}
        <Check size={16} />
        <span>{RU.lobby.copiedInvite}</span>
      {:else}
        <Copy size={16} />
        <span>{RU.lobby.copyInvite}</span>
      {/if}
    </button>
    <dialog
      class="panel invite-dialog"
      bind:this={inviteDialog}
      aria-labelledby="invite-title"
      aria-describedby="invite-help"
      onkeydown={(event) => {
        event.stopPropagation();
      }}
      onclose={() => {
        inviteButton?.focus();
      }}
    >
      <h2 id="invite-title">Приглашение в игру</h2>
      <p id="invite-help">
        Не удалось скопировать приглашение. Скопируйте ссылку вручную и отправьте её гостям.
      </p>
      <label>
        Ссылка для гостей
        <input
          class="field-input"
          bind:this={inviteField}
          readonly
          value={inviteUrl}
          onclick={(event) => {
            event.currentTarget.select();
          }}
        />
      </label>
      <button
        type="button"
        class="btn"
        onclick={() => {
          inviteDialog?.close();
        }}>Закрыть</button
      >
    </dialog>
  {/if}

  {#if viewerIsHost && canEndEarly}
    <div class="dropdown-wrap">
      <button
        type="button"
        class="btn menu-trigger"
        aria-label="Меню хоста"
        aria-expanded={menuOpen}
        onclick={() => {
          audioPlayer.cue('click');
          menuOpen = !menuOpen;
          confirmEnd = false;
        }}
      >
        <MoreVertical size={18} />
      </button>

      {#if menuOpen}
        <div class="menu-popover panel" role="menu">
          {#if canEndEarly}
            {#if !confirmEnd}
              <button
                type="button"
                class="menu-item danger-item"
                role="menuitem"
                onclick={() => {
                  confirmEnd = true;
                }}
              >
                {RU.lobby.endMatchMenu}
              </button>
            {:else}
              <div class="confirm-box">
                <p class="confirm-text">
                  {RU.lobby.endMatchConfirm(playedBeforeEnd, totalRounds)}
                </p>
                <div class="confirm-actions">
                  <button
                    type="button"
                    class="btn btn-danger"
                    onclick={() => {
                      menuOpen = false;
                      confirmEnd = false;
                      onEndMatch();
                    }}
                  >
                    {RU.lobby.confirmEndBtn}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    onclick={() => {
                      confirmEnd = false;
                    }}
                  >
                    {RU.lobby.cancelBtn}
                  </button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .host-menu-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    position: relative;
    flex-wrap: wrap;
  }

  .fake-pill {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 0.65rem;
    border-radius: 999px;
    border: 1px solid var(--paint);
    color: var(--paint);
    background-color: var(--asphalt-900);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .copy-btn {
    padding: 0 0.85rem;
  }

  .invite-dialog {
    width: min(26rem, calc(100% - 2rem));
    padding: var(--sp-4);
    color: var(--paper);
  }

  .invite-dialog::backdrop {
    background-color: var(--asphalt-900);
    opacity: 0.8;
  }

  .invite-dialog h2 {
    font-size: 1.25rem;
    margin: 0;
  }

  .invite-dialog label {
    display: grid;
    gap: var(--sp-1);
    margin-bottom: var(--sp-3);
  }

  .menu-trigger {
    min-width: var(--control-h);
    padding: 0;
  }

  .dropdown-wrap {
    position: relative;
  }

  .menu-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    min-width: 240px;
    padding: var(--sp-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 60;
  }

  .menu-item {
    width: 100%;
    text-align: left;
    padding: 0 var(--sp-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--paper);
  }

  .menu-item:hover {
    background-color: var(--asphalt-700);
  }

  .danger-item {
    color: var(--signal);
  }

  .confirm-box {
    padding: var(--sp-2);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .confirm-text {
    margin: 0;
    font-size: 0.9rem;
  }

  .confirm-actions {
    display: flex;
    gap: var(--sp-2);
  }
</style>
