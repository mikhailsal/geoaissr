<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let { name, onClose, children }: { name: string; onClose: () => void; children: Snippet } =
    $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} aria-labelledby="bot-settings-title" onclose={onClose}>
  <div class="dialog-head">
    <h2 id="bot-settings-title">Настройки ИИ · {name}</h2>
    <button
      class="btn"
      type="button"
      onclick={() => {
        dialog.close();
      }}>Закрыть</button
    >
  </div>
  {@render children()}
</dialog>

<style>
  dialog {
    width: min(580px, calc(100vw - 24px));
    max-height: calc(100dvh - 32px);
    border: 1px solid var(--line);
    background: var(--asphalt-800);
    color: var(--paper);
    padding: 0;
    border-radius: var(--radius-md);
    overscroll-behavior: contain;
  }
  dialog::backdrop {
    background: var(--orbit-scrim);
  }
  .dialog-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    padding: var(--sp-3);
    background: var(--asphalt-800);
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }
</style>
