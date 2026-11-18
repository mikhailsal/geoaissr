# Game audio

The header has two independent toggle buttons: **Звуковые эффекты** (sound effects)
and **Фоновая музыка** (background music). Both default to enabled. Their pressed state
indicates whether the channel is enabled; the tooltip describes the next action.
Preferences are saved in this browser under `geoaissr.audio.v1`. When browser
storage is unavailable, the buttons still work for the current tab.

Audio activates after a pointer or keyboard interaction. A restored game can
therefore remain silent until the first interaction. Hidden tabs, disconnected
sessions and logged-out players are silent. Returning to the game restores the
paused music and current timed warnings without replaying earlier results or answers.
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
| `swoosh.ogg`                      | A live transition between lobby, round, round results and match results | 0.91 s   | 0.50 |
| `swoosh-short.ogg`                | Host menu, map toggle, profile and AI explanation panels                | 0.07 s   | 0.70 |
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

The full swoosh is requested before the screen DOM updates. Loading and active
play share the round screen, so revealing the panorama after 3–2–1 uses only its
start cue. Initial snapshots, repeated snapshots and reconnect restoration do
not replay a screen transition. Local button clicks do not duplicate the swoosh
produced by the accepted phase change.

## Continuous background music

All seven current loops are included in the gameplay queue, at linear gain 0.18:

| Queue position | File                       | Duration | Character                            |
| -------------- | -------------------------- | -------- | ------------------------------------ |
| 1              | `round-loop-suspense.ogg`  | 43.54 s  | Drone, heartbeat and quiet ticking   |
| 2              | `round-loop-explorer.ogg`  | 52.24 s  | Playful bass and marimba figures     |
| 3              | `round-loop-voyage.ogg`    | 48.98 s  | Plucked bass and spacious strings    |
| 4              | `round-loop-radar.ogg`     | 43.54 s  | Sonar and a scanning rhythm          |
| 5              | `round-loop-horizon.ogg`   | 45.71 s  | Spacious pulse and beacon notes      |
| 6              | `round-loop-pulse.ogg`     | 43.54 s  | Driving electronic rhythm            |
| 7              | `round-loop-countdown.ogg` | 45.71 s  | Bass ticks and growing timer tension |

In the lobby, only the original `round-loop-suspense.ogg` repeats as a native
audio loop. Its drone, heartbeat and quiet ticks play at a reduced gain of 0.117
while players join and configure the match. The same background-music control
applies in both lobby and gameplay.

A match starts the queue with suspense during the first round's loading. Every
track plays in full, then the next starts; countdown is followed by suspense
again. The queue is independent of round numbers, deadlines, answers, round
results and preparation of the next round. A new round never restarts or skips
the currently playing track.

Successor starts and current-source stops are scheduled at the same exact
`AudioContext` timestamp. If the next file is unavailable, the current track
repeats complete loops while the next load is retried. A late load waits for the
next complete loop boundary instead of cutting the audible iteration.

Muting music, hiding the tab or losing the connection pauses the queue and saves
the audible track and its position. Resuming continues that position. Match
final stops the queue; returning to the lobby restores its single Suspense loop.
Each new match starts its own queue from suspense.

## Playback and assets

`audio-player.ts` fetches and decodes the OGG files through Web Audio only after
browser activation. With music enabled, the initial Suspense load gets priority: enabled effects
are preloaded when it settles or after one second, whichever comes first. The playlist loads its current and next tracks;
later tracks load as needed, rather than fetching all seven at activation. If a
successor loads slowly, the current track keeps looping as described above.
The playlist schedules decoded `AudioBuffer` sources on the native audio clock,
with sample-exact OGG loops as the fallback. `audio-director.ts`
selects live transitions and timed effects using the same synchronized server
clock as the visible timer; background progression follows its own audio clock.
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
optional-audio failures, all seven music preferences, sequential handoffs,
fallback loops and saved playheads across pauses.
`web/tests/audio.spec.ts` exercises the built client
with Chromium's real OGG decoder and audio graph; it observes native source
starts and stops without replacing playback. Headless graph checks verify
timing and routing, but do not judge the subjective speaker mix.
The seven-track wrap regression uses half-second excerpts copied from the real
decoded music buffers. Separate cases use the full recordings and verify the
first handoff at the original 43.54-second boundary.
