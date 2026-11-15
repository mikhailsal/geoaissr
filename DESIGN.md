# DESIGN.md — geoaissr visual language

The image: **asphalt and road markings**. The panorama and the map fill the whole screen; the interface lies on top of them in dense dark panels with a crisp `1px solid var(--line)` border. The scenario: an evening, friends in a voice chat, each at their own monitor.

## Principles

1. **No glass, glow, gradients or decorative icons.** Text never sits directly on the panorama or the map — on a dark panel (`--asphalt-800` or `--asphalt-900`). The idle desktop round minimap is translucent; it becomes opaque on hover, focus, or expansion. Results maps and mobile open maps remain opaque. Emoji in the interface are forbidden.
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
- **Interactive elements:** minimum height of buttons and input fields is `44px`.

## Motion

Curve: `cubic-bezier(0.16, 1, 0.3, 1)`, no bounce.

- `120ms` — press, hover
- `240ms` — panel expansion, state change
- `400ms` — table row reordering
- `800ms` — results map fly-over (`flyTo`)
- With `prefers-reduced-motion: reduce`, motion and animations are turned off, leaving an instant change of states.

## Avatars, markers and states

- **Human:** a round avatar with the first letter of the nickname.
- **AI:** a square avatar with a `6px` corner radius and a chip icon next to the letter.
- **Recent wins:** a meaningful trophy icon and a 14px count beside participant avatars, with an accessible name describing the six-hour window. Profile editing sits beside the viewer's identity; final-result administration stays below the standings.
- **Map markers:** compact circular participant buttons with a dark outline (light when selected); the target is a circular yellow star button. Fake maps use compact circular participants and a star target.
- **Icons:** only `@lucide/svelte`, and only meaningful ones.
- **Shared state components:** `StatusBanner.svelte` (connection and warnings for the host) and `InlineState.svelte` (loading, empty, error with an action button).

## AI result cards

Reasoning appears in a fixed reading order: facts, rejected alternatives, conclusion and coordinates. A draft badge identifies checkpoint fallback. A legacy explanation fills the conclusion slot when no valid conclusion exists, including alongside partial structured reasoning. Absent reasoning does not imply that coordinates were missing.

The inspection timeline groups initial observations above numbered paid steps. Each row pairs a clickable image with its action, camera or move parameters and hypothesis. Zoom is always derived from field of view, including a `1.0×` normal view. Long text wraps within the card on narrow screens.

Token and estimated-cost details use one compact metric button. Its tooltip works with hover, keyboard focus and tap; Escape closes the tooltip before the surrounding card, and clicking outside dismisses it. The cost is labelled as an OpenRouter estimate and approximate model matches are explicit.

Live accounting updates preserve the selected card's focus, open tooltip and image preview. Selecting a different bot or round resets those inspection controls.
