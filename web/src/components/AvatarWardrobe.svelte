<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { dismissOnBackdrop } from '../lib/dialog';
  import CharacterTabs from './CharacterTabs.svelte';
  import { Check, Dices, RotateCcw, X } from '@lucide/svelte';
  import type { AvatarAppearance } from '$shared/avatar';
  import type { AvatarSlot } from '$shared/avatar-catalog';
  import {
    applyPreset,
    groups,
    presets,
    shuffle,
    thumbnail,
    slotNames,
  } from '../lib/wardrobe/catalog';
  import TurnableAvatar from './TurnableAvatar.svelte';
  import WardrobeFooter from './WardrobeFooter.svelte';
  import WardrobeOptions from './WardrobeOptions.svelte';

  interface Props {
    name: string;
    readOnly?: boolean;
    profile?: Snippet;
    botSettings?: Snippet;
    initialTab?: 'appearance' | 'profile' | 'bot';
    appearance: AvatarAppearance;
    onClose: () => void;
    onSave: (appearance: AvatarAppearance) => void;
    pending?: boolean;
    error?: string | null;
  }
  let {
    name,
    appearance,
    readOnly = false,
    profile,
    botSettings,
    initialTab = 'appearance',
    onClose,
    onSave,
    pending = false,
    error = null,
  }: Props = $props();
  let tab = $state(untrack(() => initialTab));
  let dialog: HTMLDialogElement;
  let draft = $state(untrack(() => ({ ...appearance })));
  const look = $derived(readOnly ? appearance : draft);
  let group = $state('Образ');
  let slot = $state<AvatarSlot>('outfit');
  let content = $state<HTMLDivElement>();
  const slots = $derived(groups.find((g) => g.name === group)?.slots ?? []);
  const selectedPreset = $derived(
    presets.find((p) => {
      const preset = applyPreset(look, p);
      return (Object.keys(preset) as (keyof AvatarAppearance)[]).every(
        (key) => preset[key] === look[key],
      );
    })?.id,
  );
  function closeDialog() {
    dialog.close();
  }
  function category(next: (typeof groups)[number]) {
    group = next.name;
    if (next.slots[0]) slot = next.slots[0];
    if (content) content.scrollTop = 0;
  }
  onMount(() => {
    dialog.showModal();
  });
</script>

<dialog
  bind:this={dialog}
  use:dismissOnBackdrop
  aria-labelledby="wardrobe-heading"
  onclose={onClose}
>
  <header>
    <h2 id="wardrobe-heading">
      <span class:inactive={tab !== 'appearance'}>Гардероб: {name}</span>
      {#if profile}<span class:inactive={tab !== 'profile'}>Профиль</span>{/if}
      {#if botSettings}<span class:inactive={tab !== 'bot'}>Настройки ИИ · {name}</span>{/if}
    </h2>
    {#if profile || botSettings}<CharacterTabs
        bind:tab
        showProfile={!!profile}
        showBot={!!botSettings}
      />{/if}
    <button type="button" class="btn icon" aria-label="Закрыть гардероб" onclick={closeDialog}
      ><X size={20} aria-hidden="true" /></button
    >
  </header>
  <div class="studio">
    <div class="preview">
      <div class="stage">
        <TurnableAvatar appearance={look} {name} preview />
      </div>
      <div class="preview-tools" class:concealed={tab !== 'appearance'}>
        <button
          type="button"
          class="btn"
          disabled={readOnly}
          onclick={() => (draft = shuffle(draft))}
          ><Dices size={18} aria-hidden="true" /> Случайный образ</button
        >
        <button
          type="button"
          class="btn icon"
          aria-label="Вернуть сохранённый образ"
          title="Вернуть сохранённый образ"
          disabled={readOnly}
          onclick={() => (draft = { ...appearance })}
          ><RotateCcw size={18} aria-hidden="true" /></button
        >
      </div>
    </div>
    {#if profile}<div class="settings" hidden={tab !== 'profile'}>{@render profile()}</div>{/if}
    {#if botSettings}<div class="settings" hidden={tab !== 'bot'}>{@render botSettings()}</div>{/if}
    <div class="inspector" hidden={tab !== 'appearance'}>
      <div class="sections" role="group" aria-label="Разделы гардероба">
        {#each groups as categoryGroup (categoryGroup.name)}
          <button
            type="button"
            aria-pressed={categoryGroup.name === group}
            onclick={() => {
              category(categoryGroup);
            }}>{categoryGroup.name}</button
          >
        {/each}
      </div>
      <div class="content" bind:this={content}>
        {#if slots.length}
          <div class="subnav" role="group" aria-label="Настройки раздела">
            {#each slots as field (field)}
              <button type="button" aria-pressed={field === slot} onclick={() => (slot = field)}
                >{slotNames[field]}</button
              >
            {/each}
          </div>
          <WardrobeOptions
            field={slot}
            {look}
            disabled={readOnly}
            onChange={(next: AvatarAppearance) => {
              draft = next;
            }}
          />
        {:else}
          <fieldset class="bases">
            <legend>Основа персонажа</legend>
            <button
              type="button"
              disabled={readOnly}
              aria-pressed={look.base === 'human'}
              onclick={() => (draft = { ...draft, base: 'human' })}>Человек</button
            >
            <button
              type="button"
              disabled={readOnly}
              aria-pressed={look.base === 'robot'}
              onclick={() => (draft = { ...draft, base: 'robot' })}>Робот</button
            >
          </fieldset>
          <h3>Готовые образы</h3>
          <div class="presets">
            {#each presets as preset, index (preset.id)}
              <button
                class="preset"
                type="button"
                disabled={readOnly}
                aria-pressed={selectedPreset === preset.id}
                onclick={() => (draft = applyPreset(draft, preset))}
              >
                <span
                  aria-hidden="true"
                  class="thumbnail"
                  style={thumbnail('look', index, presets.length)}
                ></span>
                <span>{preset.label}</span>
                {#if selectedPreset === preset.id}<Check
                    size={16}
                    class="mark"
                    aria-hidden="true"
                  />{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
  <WardrobeFooter
    {tab}
    {readOnly}
    {pending}
    {error}
    onClose={closeDialog}
    onSave={() => {
      onSave({ ...draft });
    }}
  />
</dialog>

<style>
  [hidden] {
    display: none !important;
  }
  .settings {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--sp-3);
  }
  dialog {
    color: var(--paper);
    background: var(--asphalt-800);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    width: min(1000px, 94vw);
    max-height: 92dvh;
    padding: 0;
    box-shadow: var(--shadow-panel);
  }
  dialog::backdrop {
    background: var(--arc-stroke);
  }
  header,
  .preview-tools {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  header {
    padding: var(--sp-3) var(--sp-4);
  }
  header {
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    display: grid;
    font-family: var(--font-display);
    font-size: clamp(1rem, 2vw, 1.4rem);
    margin: 0;
    overflow-wrap: anywhere;
  }
  /* Reserve the tallest wrapped title so switching tabs keeps the preview the same size. */
  h2 span {
    grid-area: 1 / 1;
  }
  .icon {
    padding: 0;
    width: var(--control-h);
    flex-shrink: 0;
    justify-content: center;
  }
  .studio {
    display: grid;
    grid-template-columns: minmax(200px, 0.8fr) minmax(0, 1.2fr);
    height: clamp(240px, 64dvh, 610px);
  }
  .preview {
    background: var(--orbit-night) url('/orbit-stage/lunar-drift.webp') 50% 54% / cover;
    display: flex;
    min-height: 0;
    flex-direction: column;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .stage :global(canvas) {
    object-fit: contain;
  }
  .preview-tools {
    justify-content: center;
    flex-wrap: wrap;
    padding: var(--sp-2);
    background: var(--orbit-scrim);
  }
  h2 .inactive,
  .preview-tools.concealed {
    visibility: hidden;
  }
  .inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    border-left: 1px solid var(--line);
  }
  .content {
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp-3);
    overscroll-behavior: contain;
  }
  .sections,
  .subnav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }
  .sections {
    flex-shrink: 0;
    border-bottom: 1px solid var(--line);
    padding: var(--sp-2);
  }
  .subnav {
    margin-bottom: var(--sp-3);
  }
  .sections button,
  .subnav button,
  .bases button {
    min-height: var(--control-h);
    border: 1px solid transparent;
    padding: 0 var(--sp-2);
    color: var(--paper-dim);
    background: transparent;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: var(--text-xs);
  }
  .sections [aria-pressed='true'],
  .bases [aria-pressed='true'],
  .subnav [aria-pressed='true'] {
    background: var(--asphalt-700);
    border-color: var(--line);
    color: var(--paper);
  }
  .bases {
    padding: 0;
    border: 0;
    margin: 0 0 var(--sp-3);
  }
  legend,
  h3 {
    color: var(--paper);
    font-size: 1rem;
    font-weight: 700;
  }
  h3 {
    margin: 0 0 var(--sp-2);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(115px, 100%), 1fr));
    gap: var(--sp-2);
  }
  .preset {
    position: relative;
    align-content: start;
    display: grid;
    min-width: 0;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-1) var(--sp-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--asphalt-700);
    color: var(--paper);
    font-size: var(--text-xs);
  }
  .preset[aria-pressed='true'] {
    border-color: var(--paper);
  }
  .preset .thumbnail {
    width: 100%;
    aspect-ratio: 180/205;
    background-repeat: no-repeat;
  }
  .preset :global(.mark) {
    position: absolute;
    top: var(--sp-1);
    right: var(--sp-1);
  }
  @media (max-width: 680px) and (orientation: portrait),
    (max-width: 680px) and (min-height: 431px),
    (max-width: 384px) {
    dialog {
      width: calc(100vw - var(--sp-4));
      max-height: 96dvh;
    }
    .studio {
      display: flex;
      flex-direction: column;
      height: min(72dvh, 690px);
    }
    .preview {
      position: relative;
      height: clamp(126px, 22dvh, 180px);
      flex-shrink: 0;
      flex-direction: row;
    }
    .preview-tools {
      position: absolute;
      right: 0;
      bottom: 0;
      background: transparent;
      display: grid;
      max-width: 36%;
      justify-items: end;
    }
    .preview-tools .btn {
      padding: var(--sp-1);
      font-size: var(--text-xs);
    }
    .inspector {
      flex: 1;
      border-left: 0;
    }
    .sections {
      overflow-x: auto;
      flex-wrap: nowrap;
    }
    .sections button {
      flex-shrink: 0;
    }
    .presets {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 384px) and (orientation: landscape) {
    header {
      flex-wrap: wrap;
      padding: var(--sp-1) var(--sp-2);
    }
    .studio {
      height: auto;
    }
  }
  @media (width > 384px) and (orientation: landscape) and (max-height: 430px) {
    dialog[open] {
      display: grid;
      /* Keep two control heights for the model above its toolbar when the dialog scrolls. */
      grid-template-rows: auto minmax(calc(3 * var(--control-h) + 2 * var(--sp-1)), 1fr) auto;
      height: 96dvh;
      max-height: 96dvh;
    }
    header,
    .preview-tools,
    .sections {
      padding-block: var(--sp-1);
    }
    .studio {
      grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
      min-height: 0;
      height: auto;
    }
    .inspector {
      display: block;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .content {
      overflow: visible;
    }
    .preview-tools,
    .sections {
      flex-wrap: nowrap;
      overflow-x: auto;
    }
    .preview-tools {
      justify-content: safe center;
    }
    .preview-tools .btn {
      padding-inline: var(--sp-1);
      font-size: var(--text-xs);
    }
    .sections button {
      flex-shrink: 0;
    }
    .presets {
      grid-template-columns: repeat(auto-fill, minmax(min(80px, 100%), 1fr));
    }
    .preset .thumbnail {
      width: min(100%, 62px);
      justify-self: center;
    }
  }
</style>
