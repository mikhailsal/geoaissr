# DESIGN.md — geoaissr visual language

The image: **asphalt and road markings**. The panorama and the map fill the whole screen; the interface lies on top of them in dense dark panels with a crisp `1px solid var(--line)` border. The scenario: an evening, friends in a voice chat, each at their own monitor.

## Principles

1. **No glass or decorative icons.** Glow and gradients are reserved for the Orbit lobby stage, where illuminated podiums mark each character’s place. Text never sits directly on the panorama or the map — on a dark panel (`--asphalt-800` or `--asphalt-900`). The idle desktop round minimap is translucent; it becomes opaque on hover, focus, or expansion. Results maps and mobile open maps remain opaque. Emoji in the interface are forbidden.
2. **Colors only from `web/src/styles/tokens.css`.** In `.svelte` files the literals `#rrggbb`, `#rgb`, `rgb(...)`, `rgba(...)` are forbidden (checked by the `scripts/check-colors.ts` script in `bun run check`).
3. **Light map, dark interface.** The answer map (Google Maps JS API) is always in the standard light scheme with point-of-interest icons hidden and English labels (`language=en`). The panels do not clash with daytime panoramas.
4. **One yellow accent (`--paint`).** Used only for the screen's primary action, the timer ring and the focus ring (`2px solid var(--paint)` with a `2px` offset).

## Typography

The fonts are bundled in the repository (`@fontsource-variable/unbounded`, `@fontsource-variable/onest`, OFL, no requests to external servers):

- **Display (`--font-display`):** `'Unbounded Variable', sans-serif` — the `geoaissr` name, timer, scores, screen headings.
- **UI (`--font-ui`):** `'Onest Variable', sans-serif` — everything else.
- **Numerals:** `font-variant-numeric: tabular-nums` everywhere.
- **Size scale:** `14px` (captions and labels), `16px` (body text, the minimum for body), `20px`, `28px`, `40px`, `64px`.

## Color palette (`web/src/styles/tokens.css`)

| Token           | Value     | Purpose                                                        |
| --------------- | --------- | -------------------------------------------------------------- |
| `--asphalt-900` | `#14171B` | Screen background, countdown shutter, text on top of `--paint` |
| `--asphalt-800` | `#1B1E23` | Dense interface panel                                          |
| `--asphalt-700` | `#2A2E35` | Hover, secondary surface                                       |
| `--line`        | `#3A3F47` | Panel borders and dividers (`1px solid`)                       |
| `--paper`       | `#F4F1EA` | Primary text                                                   |
| `--paper-dim`   | `#B9B4A8` | Secondary text and captions                                    |
| `--paint`       | `#FFD23F` | Primary accent, focus, main button, timer                      |
| `--signal`      | `#FF6369` | Errors, the last-10-seconds countdown                          |
| `--ok`          | `#3DBB7A` | Success, confirmed answer, connection healthy                  |

### Participant palette (`--p-1` … `--p-12`)

The yellow accent is not part of the participant palette. The color of the letters on top of an avatar (light `--paper` or dark `--asphalt-900`) is chosen automatically for a contrast of >= 4.5:1.

- `--p-1: #E8590C` (orange)
- `--p-2: #C2255C` (crimson)
- `--p-3: #9C36B5` (lilac)
- `--p-4: #7048E8` (violet)
- `--p-5: #339AF0` (blue)
- `--p-6: #1098AD` (turquoise)
- `--p-7: #0CA678` (emerald)
- `--p-8: #74B816` (lime)
- `--p-9: #8D5524` (brown)
- `--p-10: #868E96` (gray)
- `--p-11: #F06595` (pink)
- `--p-12: #22B8CF` (light blue)

## Geometry, spacing, shadows

- **Spacing scale:** `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`.
- **Corner radii:** `4px` for fields and buttons (`--radius-sm`), `8px` for panels (`--radius-md`), `6px` for the square AI avatar, `50%` for the round human avatar.
- **Panel shadow:** `0 2px 0 rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35)`.
- **Interactive elements:** minimum height of buttons and input fields is `44px`, except compact map marker buttons (`22–28px` participants and `24px` targets).

## Motion

Curve: `cubic-bezier(0.16, 1, 0.3, 1)`, no bounce.

- `120ms` — press, hover
- `240ms` — panel expansion, state change
- `400ms` — table row reordering
- `800ms` — results map fly-over (`flyTo`)
- With `prefers-reduced-motion: reduce`, motion and animations are turned off, leaving an instant change of states.

## Avatars, markers and states

- The lobby stage and wardrobe display the participant’s dressed Orbit character. Select the nameplate to inspect the character.
- Compact human avatars show the first letter of the nickname inside a circle.
- Compact AI avatars show the initial and a chip icon inside a square with a `6px` corner radius.
- **Recent wins:** a meaningful trophy icon and a 14px count beside participant avatars, with an accessible name describing the six-hour window. Profile editing sits beside the viewer's identity; final-result administration stays below the standings.
- **Map markers:** compact circular participant buttons with a dark outline (light when selected); the target is a circular yellow star button. Fake maps use compact circular participants and a star target.
- **Icons:** only `@lucide/svelte`, and only meaningful ones.
- **Shared state components:** `StatusBanner.svelte` (connection and warnings for the host) and `InlineState.svelte` (loading, empty, error with an action button).

## AI result cards

The card reads top to bottom: header, bot's story, step-by-step disclosure, coordinates, accounting (always last).

The story block has a small caption «Рассказ бота» and the bot's first-person summary at 16 px. The «Черновик» badge sits beside it when the scored pin came from a checkpoint. Without a summary the card says «Итог не записан» and still lists the steps. A legacy result without a journal hides the disclosure, shows its conclusion as the story when present and keeps the old snapshot timeline below it.

The disclosure «Ход за ходом (N шагов)» is a native button (at least 44 px tall, chevron icon, `aria-expanded`, `aria-controls`) and starts collapsed. N counts every step, including «Первый взгляд». Steps mount only when it is open and load thumbnails only; the full frame loads in the preview dialog. Its state survives live accounting updates and resets when the bot or round changes.

Each step row is separated by a 1 px `--line` divider (no nested shadows, no per-entry animation) and shows, in order: title, frames, «Зачем:», «Вывод:», shifts and the pin line. «Первый взгляд» shows its four frames in a wrapping 2×2 grid. Other steps are titled from the action and camera ("Зум 2.0× · азимут 90°", "Шаг 1 · азимут 0°"). Frames are image buttons named «Кадр шага N: …» with a reserved square box while loading and «Кадр недоступен» on error. Below 480 px of card width everything is one column; above it a single frame sits in a 128 px left column.

State copy: a missing finding reads «вывод не записан»; a finding cut off by the round end (or still pending on the last step) reads «раунд закончился раньше вывода». Shifts are text labels with their reason, never colour alone: «Отпало» (`--signal`), «Менее вероятно» (`--paper-dim`), «Более вероятно» (`--ok`). The pin line reads «первая точка», «точка сдвинулась на N км» (tabular numerals), «точка не сдвинулась» or «новая точка не записана». All model text is plain text with `overflow-wrap: anywhere`.

One shared native modal dialog previews a frame. Escape closes it first and restores focus to the frame button; the card's own Escape order is unchanged. The «почему?» button is at least 44 px tall.

Token and estimated-cost details use one compact metric button. Its tooltip works with hover, keyboard focus and tap; Escape closes the tooltip before the surrounding card, and clicking outside dismisses it. Reference API prices show three decimal places and the label “API-цена для справки”; approximate model matches are explicit.

Live accounting updates preserve the selected card's focus, open tooltip and image preview. Selecting a different bot or round resets those inspection controls.

Monthly quota readings use thin usage meters with icons and percentages, transparent backgrounds and no button borders. Their color communicates quota status; they have no selected state. Hover, keyboard focus and tap reveal usage and forecast details.
