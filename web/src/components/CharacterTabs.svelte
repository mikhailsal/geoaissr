<script lang="ts">
  let {
    tab = $bindable(),
    showProfile,
    showBot,
  }: { tab: 'appearance' | 'profile' | 'bot'; showProfile: boolean; showBot: boolean } = $props();
</script>

<nav aria-label="Разделы персонажа">
  <button type="button" aria-pressed={tab === 'appearance'} onclick={() => (tab = 'appearance')}
    >Гардероб</button
  >
  {#if showProfile}<button
      type="button"
      aria-pressed={tab === 'profile'}
      onclick={() => (tab = 'profile')}>Профиль</button
    >{/if}
  {#if showBot}<button type="button" aria-pressed={tab === 'bot'} onclick={() => (tab = 'bot')}
      >Настройки ИИ</button
    >{/if}
</nav>

<style>
  nav {
    display: flex;
    gap: var(--sp-1);
    margin-left: auto;
    align-items: center;
  }
  nav button {
    padding: 0 var(--sp-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    color: var(--paper-dim);
    background: var(--asphalt-800);
    font: inherit;
    font-size: var(--text-xs);
  }
  nav [aria-pressed='true'] {
    color: var(--paper);
    background: var(--orbit-plate);
    border-color: var(--orbit-aqua);
  }
</style>
