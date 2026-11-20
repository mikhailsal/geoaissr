<script lang="ts">
  import { X } from '@lucide/svelte';

  interface Props {
    /** null when neither the full image nor the thumbnail loaded. */
    src: string | null;
    onClose: () => void;
    onError: () => void;
  }

  let { src, onClose, onError }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  });
</script>

<dialog
  class="zoomed-preview"
  aria-label="Снимок бота"
  bind:this={dialog}
  onclose={onClose}
  onkeydown={(event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dialog?.close();
  }}
  onclick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog?.close();
  }}
>
  <header>
    <span>Снимок бота</span>
    <button type="button" class="btn" aria-label="Закрыть снимок" onclick={() => dialog?.close()}>
      <X size={20} aria-hidden="true" />
    </button>
  </header>
  {#if src}
    <img {src} alt="Увеличенный снимок бота" onerror={onError} />
  {:else}
    <p class="unavailable">Кадр недоступен</p>
  {/if}
</dialog>

<style>
  .zoomed-preview {
    position: fixed;
    width: max-content;
    max-width: calc(100vw - 32px);
    max-height: calc(100dvh - 32px);
    padding: var(--sp-3);
    background: var(--asphalt-900);
    color: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-panel);
  }
  .zoomed-preview::backdrop {
    background: var(--asphalt-900);
    opacity: 0.8;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    margin-bottom: var(--sp-2);
  }
  .btn {
    min-width: var(--control-h);
    padding: 0;
  }
  .unavailable {
    margin: 0;
    padding: var(--sp-6) var(--sp-4);
    color: var(--paper-dim);
    text-align: center;
  }
  img {
    width: auto;
    max-width: 100%;
    max-height: calc(100dvh - 132px);
    height: auto;
    display: block;
    margin: 0 auto;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
  }
</style>
