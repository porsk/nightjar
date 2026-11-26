## Findings

Hand-written, not regenerated. Numbers are the "new" scoring from the table above.

- Hungarian: BuzzASR fine-tune is best (12.4% WER, 3.5% CER), then stock large-v3 (13.6%), turbo (15.5%), Canary-1B-v2 (16.3%), Parakeet v3 (30.9%). Buzz vs large-v3 is only 1.2 points on 150 sentences, so treat them as close.
- English: large-v3 (4.3%), Canary (5.5%) and turbo (5.2%) are close, Parakeet v3 is behind (6.8%). All are good enough.
- Speed on 4 threads: large-v3 is slow (RTF 1.4 to 2.3, so a 10 minute entry takes 15 to 25 minutes, about 5.5 GB RAM). Turbo is RTF 0.35 to 0.39 (2.5 GB). Canary is 0.25 (1.9 GB). Parakeet is 0.13 (1.5 GB).
- Turbo costs about 2 points of Hungarian WER against large-v3 for 6x the speed and half the RAM. Canary is as fast as Parakeet, but its Hungarian CER (7.0%) is worse than all Whisper models: it makes more whole-word invention errors.
- Parakeet v3 Hungarian is bad here (30.9% WER). It auto-detects language and often writes Hungarian words with Finnish-like letters ("katalän", "tära"). The round 1 conclusion holds.
- Fairer scoring moves numbers by 0.2 to 1.5 points for most engines, and by 4.7 points for Canary in Hungarian (21.0% to 16.3%) because it writes numbers as words where the reference has digits. Engine order does not change except Canary moving from clearly worst Whisper-class to just behind turbo.
- Round 1 turbo scored 20.5% on 12 distinct sentences. On 150 distinct sentences it is 15.5%, so round 1 was too pessimistic.
- Beam search: not available. sherpa-onnx 2.0.3 only has a greedy decoder for Whisper, so the beam vs greedy comparison was skipped.
- BuzzASR is MIT. Its card says it was trained on FLEURS and Common Voice, so FLEURS is a friendly test for it. Expect the real-world gain over stock large-v3 to be smaller than here. Our own recordings will tell.
- BuzzASR is Hungarian only. It was not run on English. A bilingual setup needs a second model for English (turbo or large-v3).

## Caveats

- FLEURS is read, clean speech of Wikipedia-style sentences, not a journal spoken to a phone. Real recordings will have more errors. The own-clips mode exists for that.
- 150 sentences per language is enough to separate Parakeet from the rest and large Whisper from turbo, not enough to separate Buzz from large-v3.
- Canary-1B-v2 runs from a community int8 export (`YaroslavGor/sherpa-onnx-nemo-canary-1b-v2-int`, no model card, no downloads, repo license says apache-2.0, NVIDIA's own license is CC-BY-4.0). It worked through sherpa-onnx 2.0.3 with no changes, but we do not control that repo. Self-exporting would be needed for production.
- RTF and RAM are from one container run per engine and language on a laptop CPU (i7-12700H, 4 threads). A small home server will differ. Peak RAM is max RSS of the worker process.
- Scoring takes the best of four spelling variants per clip (see README), which is slightly generous to all engines. It was the same for every engine.
- Reference texts are FLEURS raw transcriptions. A few have their own oddities (unusual names), which cost every engine alike.
