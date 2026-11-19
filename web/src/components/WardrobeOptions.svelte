<script lang="ts">
  import { Check, CircleOff } from '@lucide/svelte';
  import type { AvatarAppearance } from '$shared/avatar';
  import type { AvatarSlot } from '$shared/avatar-catalog';
  import { colorControl, equip, items, slotNames } from '../lib/wardrobe/catalog';

  interface Props {
    field: AvatarSlot;
    disabled?: boolean;
    look: AvatarAppearance;
    onChange: (look: AvatarAppearance) => void;
  }
  let { field: slot, look, disabled = false, onChange }: Props = $props();
  const color = $derived(colorControl(slot, look));
  const actualColor = $derived(
    color && (look[color.key] === 'match' ? look.hairColor : look[color.key]),
  );
  const choices = $derived(items(slot));
</script>

<div class="tiles" role="group" aria-label={slotNames[slot]}>
  {#each choices as item (item.id)}
    <button
      type="button"
      {disabled}
      class="tile"
      aria-pressed={look[slot] === item.id}
      onclick={() => {
        onChange(equip(look, slot, item.id));
      }}
    >
      {#if item.image}
        <span aria-hidden="true" class="thumbnail" style={item.image}></span>
      {:else if slot === 'skin'}
        <span class="skin" style:background-color={item.id}></span>
      {:else}
        <span class="empty"><CircleOff size={20} aria-hidden="true" /></span>
      {/if}
      <span>{item.label}</span>
      {#if look[slot] === item.id}<Check class="mark" size={16} aria-hidden="true" />{/if}
    </button>
  {/each}
</div>
{#if color && actualColor}
  <fieldset>
    <legend>Цвет</legend>
    <div class="colors">
      {#each color.palette as swatch (swatch.id)}
        <button
          type="button"
          {disabled}
          class="swatch"
          aria-label={swatch.label}
          title={swatch.label}
          aria-pressed={look[color.key] === swatch.id}
          onclick={() => {
            onChange({ ...look, [color.key]: swatch.id });
          }}
        >
          <span style:background-color={swatch.id}></span>
        </button>
      {/each}
      <label class="custom">
        <input
          type="color"
          {disabled}
          value={actualColor}
          aria-label="Свой цвет"
          onchange={(e) => {
            onChange({ ...look, [color.key]: e.currentTarget.value });
          }}
        />
        Свой цвет
      </label>
    </div>
    {#if color.linked}
      <label class="link"
        ><input
          type="checkbox"
          {disabled}
          checked={look[color.key] === 'match'}
          onchange={(e) => {
            onChange({
              ...look,
              [color.key]: e.currentTarget.checked ? 'match' : look.hairColor,
            });
          }}
        /> Как у волос</label
      >
    {/if}
  </fieldset>
{/if}

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(96px, 100%), 1fr));
    gap: var(--sp-2);
  }
  .tile {
    position: relative;
    display: grid;
    background: var(--asphalt-700);
    color: var(--paper);
    align-content: start;
    gap: var(--sp-1);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-xs);
    padding: var(--sp-1) var(--sp-1) var(--sp-2);
  }
  .tile[aria-pressed='true'] {
    border-color: var(--paper);
  }
  .thumbnail,
  .empty {
    width: 100%;
    aspect-ratio: 194 / 134;
    background-repeat: no-repeat;
  }
  .empty {
    display: grid;
    place-items: center;
    color: var(--paper-dim);
  }
  .skin {
    display: block;
    width: 54%;
    aspect-ratio: 1;
    margin: var(--sp-2) auto;
    border-radius: 50%;
  }
  .tile :global(.mark) {
    position: absolute;
    top: var(--sp-1);
    right: var(--sp-1);
    color: var(--paper);
    background: var(--asphalt-900);
    border-radius: 50%;
  }
  fieldset {
    border: 0;
    border-top: 1px solid var(--line);
    margin: var(--sp-4) 0 0;
    padding: var(--sp-2) 0;
  }
  legend {
    font-weight: 700;
    padding-right: var(--sp-2);
  }
  .colors {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
  }
  .swatch {
    display: grid;
    place-items: center;
    width: var(--control-h);
    height: var(--control-h);
    border: 1px solid transparent;
    background: none;
    border-radius: var(--radius-sm);
  }
  .swatch[aria-pressed='true'] {
    border-color: var(--paper);
  }
  .swatch span {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--paper-dim);
  }
  .custom,
  .link {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-h);
    gap: var(--sp-2);
    font-size: var(--text-xs);
  }
  .custom input {
    width: 36px;
    height: 32px;
    padding: 0;
    background: none;
    border: 0;
  }
</style>
