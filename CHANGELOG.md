# Changelog

Notable changes to this locally run application are recorded here. Releases are identified by Git tags.

## [0.2.2] - 2026-11-17

### Added

- Hear event sounds for round loading, countdowns, map markers, accepted answers, opponents and results, with quiet seamless music during active rounds.
- Toggle sound effects and round music independently from the header and retain those choices in the browser. Audio pauses in hidden or disconnected tabs and resumes without repeating past events.

### Changed

- Rotate all seven original background loops by round, keeping music playing through answers, timer zero, round results and the next round's preparation.

### Fixed

- Let the loading phrase finish before the synchronized three-second countdown begins.
- Preserve the final timer hit and whistle after zero, and let event tails finish across normal screen transitions.
- Keep the previous background track audible until the next variant is ready to play.
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
