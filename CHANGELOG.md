# Changelog

Notable changes to this locally run application are recorded here. Releases are identified by Git tags.

## [0.3.3] - 2026-11-24

### Added

- Let a bot play as a Detective. Set «Стиль игры» to «Детектив» in the bot's settings, and the bot runs as two processes that talk only through the server. The eyes see the frames, describe them, copy signs letter for letter and can drive along the road. The brain never gets an image. It reads the eyes' scene report, asks for descriptions, text or a drive, and places the pin. The server refuses a request phrased as a question or one that names a country, a city or a people, hides place names the eyes write in their own words, and tells the brain how far from the start a frame was taken. A Detective runs on `claude`, `codex` and `agy` and needs a round of 90 seconds or more. Otherwise the slot plays Intuit in that round, and the lobby says why.
- Run the eyes of a Detective on another harness and model than the brain. «Глаза детектива» in the slot settings offers «как у мозга» or any available harness with its models. The brain and the eyes each have their own effort («Усилия мозга», «Усилия глаз»); the eyes default to low. «Проверить зрение» tests the eyes at their effort. A check passed before the eyes moved to another harness no longer counts, and the lobby does not start a match while the eyes' harness of an enabled Detective is missing. The participants list names the eyes' model, the token badge names the model of each process, and the price adds up each process at its own model. The price stays unknown until both processes have reported their tokens. On `agy` the eyes read their frames from files, the brain may not open any file, and a round whose brain guard left no record is marked «Изоляция зрения не подтверждена» on the result card.
- The lobby and the player list mark a Detective bot. Its result card shows the eyes' scene report, every request with its answers and frames, the control check, the bot's confidence and the clue that decided the guess. A line on the card says the brain saw no frames. The token badge splits usage between the brain and the eyes.
- Check a real Detective round with `bun run test:harness --detective` (one round per available harness) or `--only <brain harness> --eyes <eyes harness>` for a mixed pair. It plays on fake images and prints the report, the answers, the final guess and the tokens of each process.
- Edit the bots' start prompts without touching code. They are text files in `server/bots/prompts/`: `intuit.txt`, `detective-brain.txt` and `detective-eyes.txt`. A file is read at every bot launch, so an edit applies from the next round. An unknown variable or an unclosed tag stops that bot's launch, and the host's diagnostics name the file and the problem. Syntax and variables: `server/bots/prompts/README.md`. Apart from the driving-side hint below, the Intuit prompt reads the same as before.

### Changed

- The AI settings tab of the character window says «Изменения сохраняются сразу» and closes with «Готово», because each change there is saved at once. Before, it offered only «Закрыть», while the wardrobe tab of the same window had «Сохранить образ».
- Bots judge the driving side only by other cars and road signs. A car whose back is seen drives away from the camera, one whose front is seen drives towards it, and the half of the road each uses gives the side. The camera's own lane no longer counts, because the frames face north, east, south and west and the direction the camera car drove is unknown. This applies to Intuit, to the Detective's eyes and to what the brain asks them.

### Fixed

- A bot whose final guess is recorded counts as finished («завершил ход») when the round or its time budget ends while its process is still exiting. Before, it was shown as timed out.

## [0.3.2] - 2026-11-22

### Added

- Bots can drive far along the road in one turn. `move` takes an optional `distance_m` from 20 to 2000 metres. The server walks the road from panorama to panorama and stops where the distance is covered, the road ends or the search runs out of lookups or time. A long move costs one paid turn, the same as a short step. Its reply names the distance really covered and why the walk stopped, and the step journal and the results timeline show that distance.

### Changed

- Bots are told that their score is the distance between their point and the start panorama. The round prompt names the driving side and the position of the sun as clues to check first, says the list of clues is open and invites the bot to invent its own checks, and explains when a long move is worth a turn. The answer still describes the start, so the prompt tells the bot to account for the distance it drove.
- A short `move` no longer steps backward at a dead end. A move with no road panorama ahead is refused and costs nothing.
- A round that ends while a bot is still driving leaves the bot where it was and requests no frame, so the billed image request is not made.

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
