<script lang="ts">
  import { RU } from '../i18n/ru';

  interface Props {
    connectionState: 'connecting' | 'connected' | 'reconnecting' | 'offline_failed';
    reconnectAttempt: number;
    backOnline: boolean;
    hostConnected: boolean;
    hostHasJoined: boolean;
    tunnelChanged: boolean;
    onRetryConnect?: () => void;
  }

  let {
    connectionState,
    reconnectAttempt,
    backOnline,
    hostConnected,
    hostHasJoined,
    tunnelChanged,
    onRetryConnect,
  }: Props = $props();

  const banner = $derived.by(() => {
    if (connectionState === 'offline_failed') {
      return {
        tone: 'danger' as const,
        text: RU.connection.reconnectFailed,
        retry: true,
      };
    }
    if (connectionState === 'reconnecting') {
      return {
        tone: 'danger' as const,
        text: RU.connection.reconnecting(reconnectAttempt),
        retry: false,
      };
    }
    if (backOnline) {
      return {
        tone: 'ok' as const,
        text: RU.connection.backOnline,
        retry: false,
      };
    }
    if (!hostConnected) {
      return {
        tone: 'warn' as const,
        text: hostHasJoined
          ? RU.connection.hostOffline
          : 'Хост ещё не вошёл в игру. Ждём его подключения.',
        retry: false,
      };
    }
    if (tunnelChanged) {
      return {
        tone: 'warn' as const,
        text: RU.connection.tunnelChanged,
        retry: false,
      };
    }
    return null;
  });
</script>

{#if banner}
  <div
    class="status-banner tone-{banner.tone}"
    role={banner.tone === 'danger' ? 'alert' : 'status'}
  >
    <span class="text">{banner.text}</span>
    {#if banner.retry && onRetryConnect}
      <button type="button" class="btn retry-btn" onclick={onRetryConnect}>
        {RU.join.retry}
      </button>
    {/if}
  </div>
{/if}

<style>
  .status-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: 0.5rem 0.9rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background-color: var(--asphalt-800);
    color: var(--paper);
    font-size: 0.9rem;
  }

  .tone-danger {
    border-color: var(--signal);
  }

  .tone-ok {
    border-color: var(--ok);
  }

  .tone-warn {
    border-color: var(--paint);
  }

  .text {
    line-height: 1.3;
  }

  .retry-btn {
    min-height: 36px;
    padding: 0 0.75rem;
  }
</style>
