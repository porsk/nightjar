# Speech recognition eval

Compares free, local speech-to-text engines on Hungarian and English. Runs CPU only inside a
`node:26-trixie-slim` container (4 threads, 4 CPUs) with ffmpeg for audio conversion.

Engines: Parakeet TDT 0.6B v3 int8, Whisper large-v3-turbo int8, and a Hungarian Whisper turbo
fine-tune (sarpba) exported to sherpa-onnx format. All run through `sherpa-onnx-node`.

## Run

One-time export of the fine-tune (Python, in its own container):

```
docker compose --profile export run --rm export
```

Then the eval itself (downloads models and FLEURS clips into `.cache/` on first run):

```
docker compose run --rm --build eval
```

The report lands in `reports/public-<date>.md`. Per-clip transcripts are in `.cache/results/public/`.

## Own clips

Put files in `clips/own/`:

- `hu-morning-walk.wav` (or `.m4a` / `.webm`)
- `hu-morning-walk.txt` with the reference text

The name must start with `hu-` or `en-`. Then run:

```
docker compose run --rm --build eval own
```

Report: `reports/own-<date>.md`. Set `ENGINES=parakeet-v3,whisper-turbo` to run a subset.

## Notes

- WER and CER: lowercase, punctuation removed, whitespace collapsed, accents kept.
- Clips longer than 25 s are split with Silero VAD.
- RTF is decode time divided by audio length (model load excluded).
