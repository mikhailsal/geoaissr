<script lang="ts">
  interface Props {
    variant?: 'loading' | 'error' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }

  let { variant = 'info', message, actionLabel, onAction }: Props = $props();
</script>

<div class="inline-state variant-{variant}" role={variant === 'error' ? 'alert' : 'status'}>
  {#if variant === 'loading'}
    <span class="spinner" aria-hidden="true"></span>
  {/if}
  <p class="msg">{message}</p>
  {#if actionLabel && onAction}
    <button type="button" class="btn" onclick={onAction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .inline-state {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background-color: var(--asphalt-800);
  }

  .variant-error {
    border-color: var(--signal);
  }

  .msg {
    margin: 0;
    flex: 1;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid var(--line);
    border-top-color: var(--paint);
    animation: spin 0.9s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
