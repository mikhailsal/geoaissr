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

| File                              | Event                                                                   | Duration | Gain |
| --------------------------------- | ----------------------------------------------------------------------- | -------- | ---- |
| `loading-round.ogg`               | A new round starts loading; the complete drum phrase precedes counting  | 6.77 s   | 0.28 |
| `soft-countdown.ogg`              | Three one-second counts, the go tone at +3 s, then its natural tail     | 6.50 s   | 0.60 |
| `effect-new-round.ogg`            | A live round becomes active                                             | 1.18 s   | 0.35 |
| `place-guess-land.ogg`            | You place or move your marker                                           | 0.24 s   | 0.70 |
| `effect-guess-locked.ogg`         | The server accepts your submitted answer                                | 0.55 s   | 0.40 |
| `new-effect-opponent-guessed.ogg` | Another human confirms or an AI finishes its answer                     | 2.87 s   | 0.25 |
| `effect-timer-countdown.ogg`      | Your final 15 seconds, the hit/whistle at zero, then its natural tail   | 18.00 s  | 0.40 |
| `round-end.ogg`                   | Round results arrive; its drum/rumble may finish during the next screen | 6.93 s   | 0.32 |
| `game_end.ogg`                    | Match results arrive after at least one completed round                 | 0.40 s   | 0.40 |
| `swoosh.ogg`                      | A profile or AI explanation panel opens or closes                       | 0.91 s   | 0.50 |
| `swoosh-short.ogg`                | Host menu, map toggle and results navigation                            | 0.07 s   | 0.70 |
| `effect-count-down-tick.ogg`      | The host changes the round duration                                     | 1.04 s   | 0.50 |

The server reserves at least 6.8 seconds from round loading for the complete
loading phrase, then schedules the usual three-second countdown once panoramas
are ready. A slower panorama load adds no further musical wait. The displayed
3–2–1 and `soft-countdown` share that scheduled timestamp. The go tone does not
delay gameplay; its tail can overlap the first moments of the active round.

The warning is omitted for spectators and players who have already answered. If
the server shortens the deadline, for example while waiting for the remaining
AIs, its playback seeks to the corresponding remaining second. Repeated room
snapshots do not announce the same answer twice. Multiple opponent answers in
one snapshot produce one cue.

The timer recording is longer than its 15 counted seconds: the final hit is at
+15.048 seconds, followed by its decay. Reaching zero and entering results let
that source finish naturally; they do not restart it. Answering or ending a
round before expiry cancels its now-inapplicable personal warning. Short event
tails also finish across normal screen transitions. Muting, leaving the game,
disconnecting or hiding the tab still stops playback immediately.

## Continuous background music

All seven current loops are included, at linear gain 0.18:

| Round in cycle | File                       | Duration | Character                            |
| -------------- | -------------------------- | -------- | ------------------------------------ |
| 1              | `round-loop-suspense.ogg`  | 43.54 s  | Drone, heartbeat and quiet ticking   |
| 2              | `round-loop-explorer.ogg`  | 52.24 s  | Playful bass and marimba figures     |
| 3              | `round-loop-voyage.ogg`    | 48.98 s  | Plucked bass and spacious strings    |
| 4              | `round-loop-radar.ogg`     | 43.54 s  | Sonar and a scanning rhythm          |
| 5              | `round-loop-horizon.ogg`   | 45.71 s  | Spacious pulse and beacon notes      |
| 6              | `round-loop-pulse.ogg`     | 43.54 s  | Driving electronic rhythm            |
| 7              | `round-loop-countdown.ogg` | 45.71 s  | Bass ticks and growing timer tension |

The order repeats from round eight and restarts at each new match. The first
track starts during the first round's loading. A track loops continuously after
your answer, after displayed zero, on round results, and during preparation of
the next round. When that next round becomes active, its new variant takes over.
The current source remains audible until the next variant has decoded and
started, including while a failed load is retried. Music stops at match final or
lobby, when its control is disabled, and at the browser lifecycle boundaries
described above.

## Playback and assets

`audio-player.ts` loads and decodes the OGG files through Web Audio after browser
activation. Music repeats as a decoded `AudioBuffer`, using the source pack's
sample-exact OGG seam. `audio-director.ts` selects live transitions and timed
tracks using the same synchronized server clock as the visible timer.
Outstanding loads lose permission to start when their source is stopped or
their channel is muted. `GameAudio.svelte` owns browser visibility and cleanup.

The 19 OGG files comprise 12 event sounds and seven music loops. Archived drafts,
duplicate MP3 exports and reference recordings are not included.

The generated audio is dedicated to the public domain under **CC0 1.0**. The
source project's license is preserved at `web/public/audio/LICENSE`. Its
`reference-original/` recordings are outside that dedication and are not part
of this application.

## Verification

`web/src/lib/audio-director.test.ts` checks event selection, deduplication,
reconnect baselines, countdown offsets, natural tails and deadline changes.
`web/src/lib/audio-player.test.ts` checks asynchronous cancellation, muting and
optional-audio failures, all seven music preferences and delayed track handoffs.
`web/tests/audio.spec.ts` exercises the built client
with Chromium's real OGG decoder and audio graph; it observes native source
starts and stops without replacing playback. Headless graph checks verify
timing and routing, but do not judge the subjective speaker mix.
