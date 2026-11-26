<script lang="ts">
  /**
   * The region of a match: a button that opens a list with a search field above it. There are
   * about two hundred countries, so the list narrows as the host types; typing on the closed
   * button opens it with that letter. Countries the chosen map cannot play are not listed.
   */
  import { ChevronDown } from '@lucide/svelte';
  import { tick } from 'svelte';
  import type { MapId } from '$shared/maps';
  import type { RegionId } from '$shared/region-ids';
  import { getRegionLabelRu } from '$shared/regions';
  import { RU } from '../i18n/ru';
  import { filterRegionOptions, listRegionOptions, type RegionOption } from '../lib/region-options';

  interface Props {
    map: MapId;
    region: RegionId;
    disabled: boolean;
    labelledBy: string;
    onPick: (region: RegionId) => void;
  }

  let { map, region, disabled, labelledBy, onPick }: Props = $props();

  const id = $props.id();
  let open = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  let root = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let search = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLUListElement | null>(null);

  const options = $derived(listRegionOptions(map, region));
  const shown = $derived(filterRegionOptions(options, query));
  const firstCountryIndex = $derived(shown.findIndex((option) => option.kind === 'country'));
  const activeOption = $derived(shown[activeIndex]);

  function optionId(option: RegionOption): string {
    return `${id}-${option.region}`;
  }

  function firstPickable(from: number, step: 1 | -1): number {
    for (let i = from; i >= 0 && i < shown.length; i += step) {
      if (shown[i]?.available) return i;
    }
    return -1;
  }

  async function openList(seed = ''): Promise<void> {
    if (disabled) return;
    query = seed;
    open = true;
    const chosen = seed === '' ? shown.findIndex((option) => option.region === region) : -1;
    activeIndex = chosen >= 0 ? chosen : Math.max(0, firstPickable(0, 1));
    await tick();
    search?.focus();
    scrollActiveIntoView();
  }

  function closeList(returnFocus: boolean): void {
    open = false;
    query = '';
    if (returnFocus) trigger?.focus();
  }

  function pick(option: RegionOption): void {
    if (!option.available) return;
    closeList(true);
    if (option.region !== region) onPick(option.region);
  }

  function scrollActiveIntoView(): void {
    list?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  async function moveActive(step: 1 | -1): Promise<void> {
    const next = firstPickable(activeIndex + step, step);
    if (next < 0) return;
    activeIndex = next;
    await tick();
    scrollActiveIntoView();
  }

  function handleTriggerKey(event: KeyboardEvent): void {
    if (open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      void openList();
    } else if (event.key.length === 1 && event.key.trim() !== '') {
      // A letter typed on the closed button starts the search with it.
      event.preventDefault();
      void openList(event.key);
    }
  }

  function handleSearchKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      void moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) pick(activeOption);
    } else if (event.key === 'Escape') {
      // Close the list only: the settings dialog around it stays open.
      event.preventDefault();
      event.stopPropagation();
      closeList(true);
    } else if (event.key === 'Tab') {
      closeList(false);
    }
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (open && root && event.target instanceof Node && !root.contains(event.target)) {
      closeList(false);
    }
  }
</script>

<svelte:document onpointerdown={handleDocumentPointerDown} />

<div class="region-picker" bind:this={root}>
  <button
    type="button"
    class="field-select trigger"
    data-testid="region-select"
    data-value={region}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-labelledby={`${labelledBy} ${id}-value`}
    {disabled}
    bind:this={trigger}
    onclick={() => {
      if (open) closeList(false);
      else void openList();
    }}
    onkeydown={handleTriggerKey}
  >
    <span class="value" id={`${id}-value`}>{getRegionLabelRu(region)}</span>
    <ChevronDown size={16} aria-hidden="true" />
  </button>

  {#if open}
    <div class="panel">
      <input
        type="text"
        class="field-input"
        data-testid="region-search"
        role="combobox"
        aria-label={RU.lobby.regionSearchLabel}
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
        autocomplete="off"
        spellcheck="false"
        placeholder={RU.lobby.regionSearchPlaceholder}
        bind:this={search}
        bind:value={query}
        oninput={() => {
          activeIndex = Math.max(0, firstPickable(0, 1));
          if (list) list.scrollTop = 0;
        }}
        onkeydown={handleSearchKey}
      />
      <ul
        class="options"
        role="listbox"
        id={`${id}-list`}
        data-testid="region-options"
        aria-labelledby={labelledBy}
        bind:this={list}
      >
        {#each shown as option, index (option.region)}
          {#if index === firstCountryIndex && query.trim() === ''}
            <li class="group" role="presentation">{RU.lobby.regionCountriesGroup}</li>
          {/if}
          <!-- The search field keeps the focus and handles the keys; a row only takes a click. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            class="option"
            class:active={index === activeIndex}
            class:chosen={option.region === region}
            role="option"
            id={optionId(option)}
            data-value={option.region}
            data-active={index === activeIndex}
            aria-selected={option.region === region}
            aria-disabled={!option.available}
            onpointerdown={(event) => {
              // Keep the focus in the search field, so the list does not close before the click.
              event.preventDefault();
            }}
            onclick={() => {
              pick(option);
            }}
          >
            {option.label}{option.available ? '' : ` (${RU.lobby.regionEmptyOnMap})`}
          </li>
        {/each}
        {#if shown.length === 0}
          <li class="empty" role="presentation">{RU.lobby.regionNothingFound}</li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

<style>
  .region-picker {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    text-align: left;
    cursor: pointer;
  }

  .trigger:disabled {
    cursor: default;
  }

  .value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* In the flow of the form: a floating list would be cut by the scrolling dialog body. */
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .options {
    margin: 0;
    padding: 0.25rem 0;
    list-style: none;
    max-height: min(40dvh, 320px);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background-color: var(--asphalt-900);
  }

  .option {
    padding: 0.45rem var(--sp-3);
    cursor: pointer;
  }

  .option.active {
    background-color: var(--asphalt-700);
  }

  .option.chosen {
    color: var(--paint);
    font-weight: 700;
  }

  .option[aria-disabled='true'] {
    color: var(--paper-dim);
    cursor: default;
  }

  .group,
  .empty {
    padding: 0.45rem var(--sp-3) 0.2rem;
    font-size: 0.8rem;
    color: var(--paper-dim);
  }

  .group {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
