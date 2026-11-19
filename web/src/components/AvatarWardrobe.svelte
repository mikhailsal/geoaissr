<script lang="ts">
  import { onMount, untrack } from 'svelte';
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
  import OrbitAvatar from './OrbitAvatar.svelte';
  import WardrobeOptions from './WardrobeOptions.svelte';

  interface Props {
    name: string;
    appearance: AvatarAppearance;
    onClose: () => void;
    onSave: (appearance: AvatarAppearance) => void;
    pending?: boolean;
    error?: string | null;
  }
  let { name, appearance, onClose, onSave, pending = false, error = null }: Props = $props();
  let dialog: HTMLDialogElement;
  let draft = $state(untrack(() => ({ ...appearance })));
  let group = $state('Образ');
  let slot = $state<AvatarSlot>('outfit');
  let content: HTMLDivElement;
  const slots = $derived(groups.find((g) => g.name === group)?.slots ?? []);
  const selectedPreset = $derived(
    presets.find((p) => {
      const look = applyPreset(draft, p);
      return (Object.keys(look) as (keyof AvatarAppearance)[]).every(
        (key) => look[key] === draft[key],
      );
    })?.id,
  );
  function category(next: (typeof groups)[number]) {
    group = next.name;
    if (next.slots[0]) slot = next.slots[0];
    content.scrollTop = 0;
  }
  onMount(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} aria-labelledby="wardrobe-heading" onclose={onClose}>
  <header>
    <h2 id="wardrobe-heading">Гардероб: {name}</h2>
    <button
      type="button"
      class="btn icon"
      aria-label="Закрыть гардероб"
      onclick={() => {
        dialog.close();
      }}><X size={20} aria-hidden="true" /></button
    >
  </header>
  <div class="studio">
    <div class="preview">
      <div class="stage"><OrbitAvatar appearance={draft} label={'Предпросмотр: ' + name} /></div>
      <div class="preview-tools">
        <button type="button" class="btn" onclick={() => (draft = shuffle(draft))}
          ><Dices size={18} aria-hidden="true" /> Случайный образ</button
        >
        <button
          type="button"
          class="btn icon"
          aria-label="Вернуть сохранённый образ"
          title="Вернуть сохранённый образ"
          onclick={() => (draft = { ...appearance })}
          ><RotateCcw size={18} aria-hidden="true" /></button
        >
      </div>
    </div>
    <div class="inspector">
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
            look={draft}
            onChange={(next: AvatarAppearance) => {
              draft = next;
            }}
          />
        {:else}
          <fieldset class="bases">
            <legend>Основа персонажа</legend>
            <button
              type="button"
              aria-pressed={draft.base === 'human'}
              onclick={() => (draft = { ...draft, base: 'human' })}>Человек</button
            >
            <button
              type="button"
              aria-pressed={draft.base === 'robot'}
              onclick={() => (draft = { ...draft, base: 'robot' })}>Робот</button
            >
          </fieldset>
          <h3>Готовые образы</h3>
          <div class="presets">
            {#each presets as preset, index (preset.id)}
              <button
                class="preset"
                type="button"
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
  <footer>
    {#if error}<span role="alert">{error}</span>{/if}
    <button
      type="button"
      class="btn"
      onclick={() => {
        dialog.close();
      }}>Отмена</button
    >
    <button
      type="button"
      class="btn btn-primary"
      disabled={pending}
      onclick={() => {
        onSave({ ...draft });
      }}>{pending ? 'Сохранение…' : 'Сохранить образ'}</button
    >
  </footer>
</dialog>

<style>
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
  footer,
  .preview-tools {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  header,
  footer {
    padding: var(--sp-3) var(--sp-4);
  }
  header {
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    font-family: var(--font-display);
    font-size: clamp(1rem, 2vw, 1.4rem);
    margin: 0;
    overflow-wrap: anywhere;
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
  .preview-tools {
    justify-content: center;
    flex-wrap: wrap;
    padding: var(--sp-2);
    background: var(--orbit-scrim);
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
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--line);
  }
  footer span {
    color: var(--signal);
    margin-right: auto;
  }
  @media (max-width: 680px) {
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
      min-height: 126px;
      height: clamp(126px, 22dvh, 180px);
      flex-shrink: 0;
      flex-direction: row;
    }
    .preview-tools {
      background: transparent;
      align-self: flex-end;
      display: grid;
      max-width: 40%;
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
  @media (max-height: 430px) {
    .studio {
      min-height: 210px;
    }
  }
</style>
