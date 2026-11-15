# Bot quality evaluation (`bun run eval:bots`)

This directory stores paired comparisons of prompts and AI models without using saved Google snapshots (a requirement of Google Maps Platform license 3.2.3(a)).

## Preparing the dataset (10+ own locations)

Create a directory with your own street photos (4 frames N/E/S/W each, with known coordinates) and a `manifest.json` file:

```json
[
  {
    "id": "spot-01",
    "countryNameRu": "Россия",
    "lat": 55.7558,
    "lng": 37.6173,
    "imagePaths": ["./01-n.jpg", "./01-e.jpg", "./01-s.jpg", "./01-w.jpg"]
  }
]
```

## Running

- Dry run (no CLI calls, to check the median and IQR calculation):
  ```bash
  bun run eval:bots --dry
  ```
- Paired live run (3 repeats of each location with 0 moves):
  ```bash
  bun run eval:bots --harness claude --dataset ./my-spots --repeats 3
  ```

The result is saved to `docs/evals/latest-<harness>.json` with the median error in km and the interquartile range (IQR) for the baseline and candidate prompt versions.
