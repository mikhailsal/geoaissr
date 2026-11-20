<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import { dismissOnBackdrop } from '../lib/dialog';
  import ProfileEditor from './ProfileEditor.svelte';

  let { onClose, ...profile }: ComponentProps<typeof ProfileEditor> & { onClose: () => void } =
    $props();
  let dialog: HTMLDialogElement;
  let editor = $state<{ focusName(): void }>();
  onMount(() => {
    dialog.showModal();
    editor?.focusName();
  });
</script>

<dialog
  bind:this={dialog}
  use:dismissOnBackdrop
  aria-labelledby="profile-title"
  onclose={onClose}
  onkeydown={(event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dialog.close();
  }}
>
  <h2 id="profile-title">Профиль</h2>
  <ProfileEditor
    {...profile}
    bind:this={editor}
    onClose={() => {
      dialog.close();
    }}
  />
</dialog>

<style>
  dialog {
    max-width: min(440px, calc(100vw - 32px));
    width: 100%;
    padding: var(--sp-4);
    background: var(--asphalt-800);
    color: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }
  dialog::backdrop {
    background: var(--asphalt-900);
    opacity: 0.8;
  }
  h2 {
    margin: 0 0 var(--sp-2);
    font-size: 1.25rem;
  }
</style>
