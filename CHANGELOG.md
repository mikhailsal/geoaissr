# Changelog

Notable changes to this locally run application are recorded here. Releases are identified by Git tags.

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
