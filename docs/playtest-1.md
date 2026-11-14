# Playtest #1 — Run checklist

Fill in this template during the first live game with friends (3–4 participants + at least 1 AI bot) through `cloudflared` or `--public-url`.

- **Date and version:** YYYY-MM-DD, version `0.1.0`
- **Launch mode:** `bun run start` (tunnel / `--public-url` / `--no-tunnel`)
- **Participants:**
  - Host:
  - Guests (devices/browsers):
  - AI slots (harness / model / preset):

## Flow check

1. [ ] `bun run doctor` passed before the game (Maps JS, Street View, `cloudflared`, CLI bots)
2. [ ] Guests opened the `#t=...` link without manual edits and joined from different devices
3. [ ] The AI bot managed to answer within the round / waiting window; the «почему?» ("why?") card and thumbnails are readable
4. [ ] The timer, marker placement (`Enter`, `M`), the card reading pause and «Ещё раз» ("Once more") worked without failures
5. [ ] The quota counter in the lobby matches expectations (`Static`, `Pano`, `Карты` — "Maps")

## Observations (where players stumbled / lag / UI)

- ...

## Fixes after the playtest

- ...
