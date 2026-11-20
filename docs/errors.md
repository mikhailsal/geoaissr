# geoaissr error codes

Every command-line error is printed to `stderr` with a code from `server/errors.ts`, a cause, context without secrets and the exact command to fix it. Exit codes: `1` (invalid invocation), `2` (environment/configuration), `3` (external dependency), `70` (unexpected failure).

## GEO_INVALID_ARGS

Invalid arguments or incompatible flags (for example, `--public-url` together with `--no-tunnel`, or an invalid `--port`). Fix the flags and run again. `bun run eval:bots` also uses this code for unknown, duplicate or malformed flags and unknown `--spot` ids, and exits with `2` (see [docs/evals/README.md](./evals/README.md)).

## GEO_ENV_KEY_MISSING

`GOOGLE_MAPS_BROWSER_KEY` or `GOOGLE_MAPS_SERVER_KEY` is missing from `.env` or the environment variables. Copy `.env.example` to `.env` and fill in the keys following the README section "How to get Google Maps Platform keys".

## GEO_PORT_BUSY

The chosen HTTP port (`5174` by default) is already in use. Free the port or pass `--port <number>`.

## GEO_CLOUDFLARED_MISSING

The `cloudflared` executable was not found in `PATH`. Install `cloudflared` or run the server locally with `bun run start --no-tunnel`.

## GEO_ALREADY_RUNNING

Another server instance is already active in `<GEOAISSR_DATA_DIR>/run/server.lock`. Stop it or specify a different data directory via `GEOAISSR_DATA_DIR`.

## GEO_SETTINGS_UNREADABLE

The `settings.json` file failed JSON parsing or schema validation. The old file was saved with a `.bad` extension, and the server started with default values.

## GEO_SETTINGS_NEWER

The `settings.json` file has a format version newer than the supported one. The file is not overwritten; update the application.

## GEO_QUOTA_UNREADABLE

The `quota.json` file is corrupted and was renamed to `.bad` (or the counter update could not be written). The host must confirm the counter reset in the lobby before starting a match with bots.

## GEO_QUOTA_NEWER

The `quota.json` file has a newer format version. To avoid accidentally zeroing the usage counter, `start` refuses to run until the application is updated.

## GEO_TUNNEL_NOT_READY

The public `cloudflared` name (or the address from `--public-url`) did not resolve through public DoH and did not answer HTTP 200 on `/healthz` within 60 s. Restart `bun run start`.

## GEO_GOOGLE_KEY_DENIED

Google returned `REQUEST_DENIED` when checking the server key. Check that Street View Static API is enabled, that billing is connected, and the key restrictions in Cloud Console.

## GEO_GOOGLE_QUOTA

Google returned `OVER_QUERY_LIMIT`, 403 or 429. Check the daily quotas and billing in Cloud Console.

## GEO_HARNESS_NOT_LOGGED_IN

No allowed AI harness (`codex`, `claude`, `agy`) is installed or signed in. Sign in to the CLI you need and run `bun run doctor`.

## GEO_HARNESS_HIDDEN

The harness selected in the slot failed the S1 spike check or was not found on the machine. Choose an available harness in the lobby.

## GEO_QUOTA_CEILING

Current usage plus the worst case of the new match exceeds the configured monthly quota ceiling. Reduce the rounds, the number of bots or the move limit in the lobby.

## GEO_BOT_JOURNAL_FIELD_MISSING

Not a command-line error: it is the code at the end of the one-time correction that the bot-tool queue returns to a bot.

- **What:** a `look` or `move` arrived without `finding` (required after `observe`) or `current_guess`, or a `final_guess` arrived without `summary` or `finding`.
- **Why:** the step journal needs the reason before the action and the finding after it; the finding for the previous frame rides on the next call.
- **What the bot should do:** repeat the same call with the missing field. The correction is returned once per pending step with `isError: true` and lists every missing field; no frame is requested and no paid turn is charged (a partial `final_guess` is saved as a checkpoint). The next call for the same step is accepted even if it changes the camera arguments: the step is marked "вывод не записан" (a missing `current_guess` keeps the previous checkpoint and the step shows «новая точка не записана»).
- **What the host sees:** nothing during play. On the result card the step shows «вывод не записан». A round that ended before the finding shows «раунд закончился раньше вывода».
- **Logging:** every correction is one `bot_journal_correction` line in `<GEOAISSR_DATA_DIR>/logs/` with `harness`, `tool`, `missing` and `code`, so the correction rate per harness can be counted. Prompt text, environment values and file paths are never logged.

## GEO_BOT_BRIDGE_UNREACHABLE

Not a command-line error: it is the code at the end of the tool result that the MCP bridge (`bot-tools/main.ts`) returns to a bot when its HTTP call to the game server fails (server stopped, connection reset, a reply that is not JSON).

- **What the bot sees:** «Нет связи с сервером игры. Повторите вызов один раз; если ошибка повторится — вызовите final_guess.» with `isError: true`. The raw exception text is not passed to the model.
- **Why:** the bridge runs inside the bot's CLI process and reaches the server over `127.0.0.1`; the server may have stopped the round or be restarting.
- **What the host should do:** nothing for a single occurrence. If every bot hits it every round, restart `bun run start` and check `bun run doctor`.

## GEO_CRASH

Unexpected exception on the server. The full stack trace (without keys and tokens) is written to `<GEOAISSR_DATA_DIR>/logs/crash-<timestamp>.log`. Restart `bun run start`.

## GEO_EVAL_HARNESS_FAILED

`bun run eval:bots` could not start the bot CLI (missing executable, process failed to start, setup failure) in at least one round. Such rounds are recorded as infra errors in `rounds.jsonl` and are not counted as measured timeouts; the command exits `1`. Run `bun run doctor`, fix the harness, and run the evaluation again.
