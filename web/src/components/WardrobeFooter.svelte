<script lang="ts">
  /**
   * The footer of the character modal. The look is a draft: «Сохранить образ» or «Отмена».
   * The AI settings apply on every change, so their tab says so and ends with «Готово».
   */
  interface Props {
    tab: 'appearance' | 'profile' | 'bot';
    readOnly: boolean;
    pending: boolean;
    error: string | null;
    onClose: () => void;
    onSave: () => void;
  }

  let { tab, readOnly, pending, error, onClose, onSave }: Props = $props();
  const autosaved = $derived(tab === 'bot' && !readOnly);
  const closeLabel = $derived(
    tab === 'appearance' && !readOnly ? 'Отмена' : autosaved ? 'Готово' : 'Закрыть',
  );
</script>

<footer>
  {#if tab === 'appearance' && error}<span class="error" role="alert">{error}</span>{/if}
  {#if autosaved}<span class="autosave">Изменения сохраняются сразу</span>{/if}
  <button type="button" class="btn" class:btn-primary={autosaved} onclick={onClose}
    >{closeLabel}</button
  >
  {#if tab === 'appearance'}<button
      type="button"
      class="btn btn-primary"
      disabled={readOnly || pending}
      onclick={onSave}>{pending ? 'Сохранение…' : 'Сохранить образ'}</button
    >
  {/if}
</footer>

<style>
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-top: 1px solid var(--line);
  }
  .error {
    color: var(--signal);
    margin-right: auto;
  }
  .autosave {
    margin-right: auto;
    font-size: 0.78rem;
    color: var(--paper-dim);
  }
  /* A phone on its side: the same thin bars as the header of the modal. */
  @media (width > 384px) and (orientation: landscape) and (max-height: 430px) {
    footer {
      padding-block: var(--sp-1);
    }
  }
</style>
