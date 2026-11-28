# Speech recognition eval

Compares free, local speech-to-text engines on Hungarian and English. Runs CPU only inside a
`node:26-trixie-slim` container (4 threads, 4 CPUs) with ffmpeg for audio conversion. Python is used only
in the export container, never at eval or runtime.

Engines (all int8, all through `sherpa-onnx-node`):

| Id | Engine | Source |
|---|---|---|
| `parakeet-v3` | Parakeet TDT 0.6B v3 | sherpa-onnx release |
| `whisper-turbo` | Whisper large-v3-turbo | sherpa-onnx release |
| `whisper-large-v3` | Whisper large-v3 | sherpa-onnx release |
| `whisper-buzz-hu` | BuzzASR Hungarian (large-v3 fine-tune, MIT), Hungarian only | our own export |
| `canary-1b-v2` | NVIDIA Canary-1B-v2 | community int8 export (`YaroslavGor/sherpa-onnx-nemo-canary-1b-v2-int`), downloaded by hand into `.cache/models/canary-1b-v2` |

Whisper beam search is not available: sherpa-onnx 2.0.3 only has a greedy decoder for Whisper.

## Run

One-time export of the BuzzASR fine-tune (Python, in its own container; `sarpba-hu-turbo` is the round 1 model):

```
docker compose --profile export run --rm export buzz-hu-large-v3
```

Then the eval itself (downloads models and FLEURS clips into `.cache/` on first run):

```
docker compose run --rm --build eval
```

- Sample: FLEURS test split, 150 distinct sentences per language, evenly spread over the split, one speaker each (`CLIPS=n` to change).
- Per engine and language results are cached in `.cache/results/public-round2/`. A re-run only decodes what is missing. `FORCE=1` decodes again.
- `ENGINES=parakeet-v3,whisper-turbo` runs a subset.
- `docker compose run --rm eval report` rebuilds the report from cached results without decoding (use it after changing the scoring).
- Report: `reports/public-round2-<date>.md`. It is regenerated on every run. Hand-written findings and caveats live in
  `reports/public-round2-notes.md`, which the script never writes. It is pasted into the report under the table.

## Own clips

Put files in a language folder, `clips/own/hu/` or `clips/own/en/` (`.wav`, `.m4a` or `.webm`), each with a `.txt`
reference next to it. Any file name works (the app's recording UUIDs are fine):

- `clips/own/hu/morning-walk.webm`
- `clips/own/hu/morning-walk.txt`

Then run `docker compose run --rm --build eval own`. Clips, cached results and `reports/own-*` are gitignored: they are private.
Report: `reports/own-<date>.md`, numbers only (no transcripts). Transcripts are in `.cache/results/own/`.

Whisper engines run with the production decoder settings (`max_tokens_per_second` 25, clips up to 25 s decoded whole, longer ones split
by Silero VAD) and are run once per pipeline variant (`VARIANTS=P0,P2` to pick some). Other engines run P0 only.

| Variant | What changes |
|---|---|
| P0 | production |
| P1a / P1b | VAD on every clip, pieces up to 10 s / 15 s |
| P2 | P0 plus loop guard: a piece whose output loops (same word group or 3+ characters three times in a row, or gzip ratio above 2.4) is decoded again in two halves split at the quietest point; a half that still loops has the repeat cut |
| P3 | VAD on every clip, threshold 0.35 |
| P4 / P5 | P1b / P3 plus loop guard |

## Scoring (`score.ts`)

Both the old (round 1) and the new scoring are reported.

- Old: lowercase, apostrophes removed, punctuation and symbols become spaces, whitespace collapsed.
- New adds: Unicode NFC, `õ`/`û` mapped to `ő`/`ű`, invisible characters and non-breaking spaces removed, digit group
  separators removed (`1 250`, `2,000`), `%` and digits spelled out in the clip's language (Hungarian and English
  number-to-words, years like 1985 read as "nineteen eighty five" in English), more quote and dash characters.
- Hyphens and numbers have no single right answer, so each clip is scored under four variants (hyphens split or joined,
  numbers as written or spelled out). The same variant is applied to reference and hypothesis, and the clip keeps the
  variant with the fewest errors. This never punishes a model for a spelling choice, but it can slightly favour
  inconsistent output.
- Accents are kept: a missing accent is a wrong word.
- WER and CER are errors summed over all clips divided by reference length.
- Clips longer than 25 s are split with Silero VAD. Whisper decodes with `max_tokens_per_second` 25, like the app (cached public results from before this setting are not re-run).
- RTF is decode time divided by audio length (model load excluded). Peak RAM is the worker process max RSS.

## Adding a cloud engine later (for example Soniox)

Cloud engines do not fit the `Engine.config` / `sherpa.OfflineRecognizer` path. Plug one in at `worker()` in
`run.ts`, which is the only place that turns a wav file into text:

1. Add an engine entry with a `cloud: true` flag (and no `modelDir`).
2. In `worker()`, when the engine is a cloud engine, skip model loading and replace `decode()` with an HTTP call
   that uploads the clip's wav and returns the text. Read the API key from an env var passed through `compose.yaml`.
3. Return the same `RunResult` shape. Everything downstream (scoring, caching, report) works unchanged.
   Load time is 0, peak RAM and download size do not apply, and cost per audio hour goes in the notes.
