<script lang="ts">
  import type { AvatarAppearance } from '$shared/avatar';
  import { groups, items, slotNames } from '../lib/wardrobe/catalog';
  let { appearance }: { appearance: AvatarAppearance } = $props();
</script>

<h3>Образ персонажа</h3>
<dl>
  <div>
    <dt>Основа</dt>
    <dd>{appearance.base === 'robot' ? 'Робот' : 'Человек'}</dd>
  </div>
  {#each groups.flatMap((group) => group.slots) as slot (slot)}
    {@const selected = items(slot).find((item) => item.id === appearance[slot])}
    {#if selected && selected.id !== 'none'}
      <div>
        <dt>{slotNames[slot]}</dt>
        <dd>{selected.label}</dd>
      </div>
    {/if}
  {/each}
</dl>

<style>
  h3 {
    margin: 0 0 var(--sp-3);
    font-family: var(--font-display);
    font-size: 1rem;
  }
  dl {
    margin: 0;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-2) 0;
    border-bottom: 1px solid var(--line);
  }
  dt {
    color: var(--paper-dim);
  }
  dd {
    margin: 0;
    text-align: right;
  }
</style>
