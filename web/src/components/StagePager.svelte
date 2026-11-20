<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  let {
    current,
    pages,
    onChange,
  }: { current: number; pages: number; onChange: (page: number) => void } = $props();
</script>

<nav class="paging" aria-label="Страницы сцены">
  <button
    class="page-btn"
    aria-label="Предыдущие участники"
    disabled={current === 0}
    onclick={() => {
      onChange(current - 1);
    }}><ChevronLeft /></button
  >
  <span>{current + 1} / {pages}</span>
  <button
    class="page-btn"
    aria-label="Следующие участники"
    disabled={current + 1 === pages}
    onclick={() => {
      onChange(current + 1);
    }}><ChevronRight /></button
  >
</nav>

<style>
  .paging {
    border: 1px solid var(--orbit-edge);
    border-radius: var(--radius-sm);
    color: var(--paper);
    background: var(--orbit-plate);
    display: flex;
    width: fit-content;
    align-items: center;
    gap: 2px;
    font-size: 0.85rem;
  }
  .page-btn {
    display: grid;
    place-content: center;
    width: 44px;
    border: 0;
    background: var(--orbit-plate);
    color: var(--paper);
    cursor: pointer;
    border-radius: var(--radius-md);
  }
  .page-btn:hover:enabled {
    background: var(--orbit-hover);
  }
  .page-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @media (max-width: 899px) {
    .paging {
      grid-area: paging;
    }
  }
  @media (orientation: landscape) and (max-height: 480px) and (max-width: 899px) {
    .paging {
      gap: 0;
      max-width: 100%;
      font-size: 0.75rem;
      white-space: nowrap;
    }
    .page-btn {
      flex-shrink: 0;
    }
  }
</style>
