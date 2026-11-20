# Changelog

Notable changes to this locally run application are recorded here. Releases are identified by Git tags.

## [0.3.1] - 2026-11-21

### Added

- See why each bot answered the way it did. On the results screen, «почему?» opens a card with the bot's summary. Below it, a collapsed step-by-step journal shows, for every paid look or move, what the bot expected to see, what it found, how the clues shifted its thinking, and where its guess moved. Each step has its frames, which open in a full-size preview that shows the thumbnail at once and switches to the full frame when it loads.
- Measure one bot configuration on a fixed photo set with `bun run eval:bots`. It runs real rounds against 28 licensed street-level spots in `docs/evals/dataset` and writes `summary.json` and `rounds.jsonl`. The summary reports finish rate with a confidence interval, time to the final guess, distance error, rejected tool calls and the share of steps with a finding. `--help` lists every flag. Unknown flags, unknown spots and datasets that break a manifest rule exit with code 2 and one readable line. A harness that cannot start, a CLI that fails before its first tool call and a frame that does not decode are reported as infra errors rather than measured rounds. Only guesses made within the time budget count. A run never overwrites an earlier one. Reusing an `--out` folder or a `--label` exits with code 2. The summary records the selected spot ids and a fingerprint of the manifest and its photos, so two runs can be compared. Rules and results format: `docs/evals/README.md`.

### Changed

- Bots now write their reasoning as they play. Every `look` and `move` carries the hypothesis it tests, the finding from the previous frame and a current guess, and `final_guess` carries a summary and the last finding. An incomplete call gets one correction per step (`GEO_BOT_JOURNAL_FIELD_MISSING`) and is never charged as a paid turn.
- **Upgrade note:** the `draft_guess` and `submit_guess` bot tools are removed. The current guess now rides on `look` and `move`, and `final_guess` ends the round. Saved custom prompts or external MCP clients that call the old tools must switch to these fields.
- When every human has answered and the round end moves earlier, bots get the new deadline and wrap up before it.
- When the bot bridge cannot reach the game server, the bot gets a short coded message (`GEO_BOT_BRIDGE_UNREACHABLE`) instead of the raw exception text and local address. After a failed `look` or `move`, which may already be charged, the message tells the bot not to repeat it and to send `final_guess`.

### Fixed

- Keep the «почему?» button on screen on narrow phones: below 420 px it moves under the bot's name.
- Show «Кадр недоступен» in the preview when a frame and its thumbnail both fail to load, instead of closing the preview without a word.

## [0.3.0] - 2026-11-20

### Added

- Dress human players and bots with the Orbit Studio wardrobe. The lobby shows up to six animated characters per page. Open a character to inspect their outfit, or edit your own appearance, color and profile details. Hosts can also change bot appearance and AI settings in the same window.
- Wave, laugh and send other gestures to the room. Click an avatar to spin it, click again to accelerate, or drag to set its angle. Players on another page can follow a gesture notification to its performer.

### Changed

- Put roster and game settings in dialogs that close with Escape or a click outside. The stage waits for the first avatar frames and offers a keyboard-accessible way to enter if rendering stalls.
- Keep the guest's current session connected when their code is entered on the owner page. Confirm a bot wardrobe save after the host's settings reach disk, and clear stored angles between lineups and games.

### Fixed

- Keep the robot preview at a consistent size when switching between wardrobe and AI settings on small screens, with a scrollable layout for short windows. Keep the keyboard focus ring visible inside off-page gesture notifications.

## [0.2.3] - 2026-11-19

### Fixed

- Keep full bot snapshots ready in memory while the details card is open, so opening or reopening a preview avoids another image load. Show the loaded thumbnail until the full image is ready.

## [0.2.2] - 2026-11-19

### Added

- Hear event sounds for round loading, countdowns, map markers, accepted answers, opponents and results, with quiet seamless music during active rounds.
- Adjust effects and music independently through header volume panels with sliders, minus/plus buttons and mute. Save both levels and mute choices in the permanent user profile, restore them by code across tunnel hostnames, and apply volume changes without restarting music. Audio pauses in hidden or disconnected tabs and resumes without repeating past events.

### Changed

- Play all seven original background tracks in a continuous sequence, keeping their full endings and preserving the queue through round changes, answers, results and preparation.
- Repeat the calmer original Suspense track in the lobby at a reduced volume and use one background-music control for both lobby and gameplay.
- Default music volume to 60% while preserving explicitly saved levels and existing mute choices.

### Fixed

- Keep audio preferences with the authenticated profile across reconnects and changed tunnel addresses; reset both channels from the button beside mute.
- Retain pending audio edits when switching profiles and prevent a replaced tab from overwriting a newer save when another tab logs out.
- Let the loading phrase finish before the synchronized three-second countdown begins.
- Preserve the final timer hit and whistle after zero, and let event tails finish across normal screen transitions.
- Keep the previous background track audible until the next variant is ready to play.
- Reduce audio loading contention on a fresh lobby visit by prioritizing Suspense before effects preloading and loading playlist tracks as needed.
- Play the full swoosh at screen transitions and reserve the short swoosh for menus and panels.

## [0.2.1] - 2026-11-16

### Added

- Retain redacted bot usage counters, normalized totals, reference price estimates, and game-tool outcomes in daily application logs.
- Record bounded AGY tool and file-read attempts before bot workspace cleanup.
- Document the observed AGY vision-bridge image offload and its verification limits.

### Changed

- Display enlarged bot snapshots in an accessible dialog that stays within the viewport.
- Show quota usage as meters and reference API prices with three decimal places.

### Fixed

- Prefetch full bot snapshots and keep the loaded thumbnail visible while an image loads or fails.
- Reset human panorama zoom at the start of each round while preserving camera changes within the same round.
- Use reported AGY totals to count cached input once and leave ambiguous usage unavailable.
- Require facts, a conclusion, and an explicit rejected-alternatives list for game finals while preserving drafts and legacy tool compatibility.
- Keep bot deadline instructions consistent with the remaining round budget.

## [0.2.0] - 2026-11-16

### Added

- Restore a profile from the homepage using a permanent personal code after an address change, in another browser, or after a server restart.
- Resume an existing room seat, submitted guess, recent wins, and host authority when signing in with the same code.
- View and copy the personal code, or log out, during every game phase.

### Changed

- Allow players and AI opponents to share names and colors while keeping their identities and win counts separate.

### Fixed

- Show the installed release version in CLI diagnostics.
- Keep logged-out profiles signed out when delayed browser events arrive, while preserving a newer profile's saved credentials.
- Redact personal codes from crash diagnostics and serialized logs.
