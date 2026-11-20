# Changelog

Notable changes to this locally run application are recorded here. Releases are identified by Git tags.

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
