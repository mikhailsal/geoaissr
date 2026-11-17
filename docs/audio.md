# Game audio

The header has two independent toggle buttons: **Звуковые эффекты** (sound effects)
and **Музыка раунда** (round music). Both default to enabled. Their pressed state
indicates whether the channel is enabled; the tooltip describes the next action.
Preferences are saved in this browser under `geoaissr.audio.v1`. When browser
storage is unavailable, the buttons still work for the current tab.

Audio activates after a pointer or keyboard interaction. A restored game can
therefore remain silent until the first interaction. Hidden tabs, disconnected
sessions and logged-out players are silent. Returning to the game restores the
current music and timed warnings without replaying earlier results or answers.
Sound failures never block joining, placing a marker or submitting an answer.

## Event mapping

The files in `web/public/audio/` are copied unchanged from the owner's
`sound-llm` project. Event names below are exact OGG basenames. Linear gain is
applied independently to each source.

| File                              | Event                                                                      | Gain |
| --------------------------------- | -------------------------------------------------------------------------- | ---- |
| `loading-round.ogg`               | A new round starts loading; stops before the countdown                     | 0.28 |
| `soft-countdown.ogg`              | Server-timed three-second countdown, including the go tone                 | 0.60 |
| `effect-new-round.ogg`            | A live round becomes active                                                | 0.35 |
| `round-loop-suspense.ogg`         | Quiet, seamless music during the active round, including after your answer | 0.18 |
| `place-guess-land.ogg`            | You place or move your marker                                              | 0.70 |
| `effect-guess-locked.ogg`         | The server accepts your submitted answer                                   | 0.40 |
| `new-effect-opponent-guessed.ogg` | Another human confirms or an AI finishes its answer                        | 0.25 |
| `effect-timer-countdown.ogg`      | Your final 15 seconds before answering                                     | 0.40 |
| `round-end.ogg`                   | Round results arrive                                                       | 0.32 |
| `game_end.ogg`                    | Match results arrive after at least one completed round                    | 0.40 |
| `swoosh.ogg`                      | A profile or AI explanation panel opens or closes                          | 0.50 |
| `swoosh-short.ogg`                | Host menu, map toggle and results navigation                               | 0.70 |
| `effect-count-down-tick.ogg`      | The host changes the round duration                                        | 0.50 |

The warning is omitted for spectators and players who have already answered. If
the server shortens the deadline, for example while waiting for the remaining
AIs, its playback seeks to the corresponding remaining second. Repeated room
snapshots do not announce the same answer twice. Multiple opponent answers in
one snapshot produce one cue.

## Playback and assets

`audio-player.ts` loads and decodes the OGG files through Web Audio after browser
activation. Music repeats as a decoded `AudioBuffer`, using the source pack's
sample-exact OGG seam. `audio-director.ts` selects live transitions and timed
tracks using the same synchronized server clock as the visible timer.
Outstanding loads lose permission to start when their source is stopped or
their channel is muted. `GameAudio.svelte` owns browser visibility and cleanup.

Only one of the seven alternative round loops is included: `suspense`, the
source pack's closest match to a quiet geography guessing timer. The other six
variants, archived drafts, duplicate MP3 exports and reference recordings are
not included.

The generated audio is dedicated to the public domain under **CC0 1.0**. The
source project's license is preserved at `web/public/audio/LICENSE`. Its
`reference-original/` recordings are outside that dedication and are not part
of this application.

## Verification

`web/src/lib/audio-director.test.ts` checks event selection, deduplication,
reconnect baselines, countdown offsets and deadline changes.
`web/src/lib/audio-player.test.ts` checks asynchronous cancellation, muting and
optional-audio failures. `web/tests/audio.spec.ts` exercises the built client
with Chromium's real OGG decoder and audio graph; it observes native source
starts and stops without replacing playback. Headless graph checks verify
timing and routing, but do not judge the subjective speaker mix.
