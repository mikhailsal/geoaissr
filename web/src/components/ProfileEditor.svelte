<script lang="ts">
  import { formatProfileToken } from '../lib/profile';
  import { untrack } from 'svelte';
  import type { ParticipantColorId } from '$shared/colors';
  import ParticipantColorPicker from './ParticipantColorPicker.svelte';
  interface PrivateControls {
    publicOnly?: false;
    profileToken?: string;
    editable?: boolean;
    onLogout: () => void;
    pending: boolean;
    error: string | null;
    onSave: (nick: string, color: ParticipantColorId) => void;
    onClose?: () => void;
  }
  type PublicControls = { publicOnly: true } & {
    [Key in Exclude<keyof PrivateControls, 'publicOnly'>]?: never;
  };
  type Props = { name: string; color: ParticipantColorId } & (PrivateControls | PublicControls);
  let {
    publicOnly = false,
    name,
    color,
    profileToken,
    editable = true,
    onLogout,
    pending,
    error,
    onSave,
    onClose,
  }: Props = $props();
  let nick = $state(untrack(() => name));
  let selected = $state(untrack(() => color));
  let copyMessage = $state('');
  let nameInput = $state<HTMLInputElement>();
  export function focusName(): void {
    nameInput?.focus();
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault();
    if (!publicOnly && editable && !pending && nick.trim()) onSave?.(nick.trim(), selected);
  }}
>
  {#if !publicOnly && profileToken}
    <label
      >Код профиля<input
        class="field-input"
        readonly
        value={formatProfileToken(profileToken)}
        onclick={(event) => {
          event.currentTarget.select();
        }}
      /></label
    >
    <button
      type="button"
      class="btn"
      onclick={async () => {
        try {
          await navigator.clipboard.writeText(formatProfileToken(profileToken));
          copyMessage = 'Код скопирован.';
        } catch {
          copyMessage = 'Не удалось скопировать. Выделите код и скопируйте вручную.';
        }
      }}>Скопировать код</button
    >
    {#if copyMessage}<p role="status">{copyMessage}</p>{/if}
  {/if}
  {#if editable}
    <label
      >Имя<input
        class="field-input"
        value={publicOnly ? name : nick}
        disabled={publicOnly}
        oninput={(event) => (nick = event.currentTarget.value)}
        bind:this={nameInput}
        maxlength="20"
        required
      /></label
    >
    <ParticipantColorPicker
      legend="Цвет"
      selected={publicOnly ? color : selected}
      disabled={publicOnly}
      onSelect={(next: ParticipantColorId) => (selected = next)}
    />
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="actions">
    {#if onClose}<button type="button" class="btn" onclick={onClose}>Закрыть</button>{/if}
    {#if editable}<button class="btn btn-primary" disabled={publicOnly || pending || !nick.trim()}
        >Сохранить</button
      >{/if}
    {#if !publicOnly}<button type="button" class="btn" onclick={onLogout}>Выйти</button>{/if}
  </div>
</form>

<style>
  form,
  label {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  p[role='alert'] {
    color: var(--signal);
  }
</style>
