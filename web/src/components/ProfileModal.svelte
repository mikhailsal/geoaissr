<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { PARTICIPANT_COLORS, type ParticipantColorId } from '$shared/colors';
  interface Props {
    name: string;
    color: ParticipantColorId;
    usedColors: ParticipantColorId[];
    pending: boolean;
    error: string | null;
    onSave: (nick: string, color: ParticipantColorId) => void;
    onClose: () => void;
  }
  let { name, color, usedColors, pending, error, onSave, onClose }: Props = $props();
  let nick = $state(untrack(() => name));
  let selected = $state(untrack(() => color));
  let dialog: HTMLDialogElement;
  let nameInput: HTMLInputElement;
  onMount(() => {
    dialog.showModal();
    nameInput.focus();
  });
</script>

<dialog bind:this={dialog} aria-labelledby="profile-title" onclose={onClose}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      onSave(nick.trim(), selected);
    }}
  >
    <h2 id="profile-title">Редактирование профиля</h2>
    <label
      >Имя<input
        class="field-input"
        bind:value={nick}
        bind:this={nameInput}
        maxlength="20"
        required
      /></label
    >
    <fieldset>
      <legend>Цвет</legend>
      <div class="swatches" role="radiogroup" aria-label="Цвет">
        {#each PARTICIPANT_COLORS as c (c.id)}
          <button
            type="button"
            role="radio"
            aria-label={c.labelRu}
            aria-checked={selected === c.id}
            class:selected={selected === c.id}
            style="background-color: var({c.cssVar}); color: var({c.inkToken});"
            disabled={usedColors.includes(c.id)}
            onclick={() => (selected = c.id)}>{selected === c.id ? '✓' : ''}</button
          >
        {/each}
      </div>
    </fieldset>
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="actions">
      <button
        type="button"
        class="btn"
        onclick={() => {
          dialog.close();
        }}>Закрыть</button
      >
      <button class="btn btn-primary" disabled={pending || !nick.trim()}>Сохранить</button>
    </div>
  </form>
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
  form,
  label {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  h2 {
    margin: 0 0 var(--sp-2);
    font-size: 1.25rem;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: var(--sp-2) 0;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: var(--sp-2);
  }
  .swatches button {
    height: var(--control-h);
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
  }
  .swatches button.selected {
    border-color: var(--paper);
    outline: 2px solid var(--paint);
  }
  .swatches button:disabled {
    opacity: 0.25;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
  }
  p {
    color: var(--signal);
  }
</style>
