<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import { dismissOnBackdrop } from '../lib/dialog';
  let { title, onClose, children }: { title: string; onClose: () => void; children: Snippet } =
    $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} use:dismissOnBackdrop aria-labelledby={id} onclose={onClose}>
  <header>
    <h2 {id}>{title}</h2>
    <button
      class="btn"
      type="button"
      aria-label="Закрыть"
      onclick={() => {
        dialog.close();
      }}><X size={19} aria-hidden="true" /></button
    >
  </header>
  <div class="body">{@render children()}</div>
</dialog>

<style>
  dialog {
    width: min(620px, calc(100vw - 24px));
    max-height: 92dvh;
    padding: 0;
    color: var(--paper);
    background: var(--asphalt-800);
    border: 1px solid var(--orbit-edge);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-panel);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: var(--orbit-scrim);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--line);
  }
  h2 {
    font: 700 clamp(1rem, 3vw, 1.35rem)/1.25 var(--font-display);
    margin: 0;
  }
  .body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-3);
  }
</style>
