# Research: speech recognition options beyond what we tested

Gathered 2026-11-26. Short on purpose. Numbers come from different test sets and many are vendor claims. "Not found" means I looked and did not find a Hungarian figure, not that the model is bad.

## 1. Is 20% WER good?

Published FLEURS Hungarian WER, same benchmark we used (full test set, not our 12 sentences):

| System | FLEURS hu WER | Source |
|---|---|---|
| Canary-1B-v2 | 12.9% | Canary paper, Table 11 [1] |
| Whisper large-v3 (full) | 14.1% | Canary paper, Table 11 [1] |
| Parakeet TDT 0.6B v3 | 15.7% | Canary paper [1], model card [2] |
| Whisper large-v3 fine-tuned (BuzzASR) | 14.7% (CER 3.7%) | model card [3] |
| Whisper large-v3 | 17.5% | ElevenLabs page, vendor claim [4] |
| Whisper large-v3 | 16.3% | Speechmatics page, vendor claim [5] |
| Qwen3-ASR 1.7B / 0.6B | 34.2% / 59.5% | Qwen3-ASR report [6] |
| Qwen3-ASR-Flash (cloud API) | 21.8% | Qwen3-ASR report [6] |
| ElevenLabs Scribe v1 | 5.1% (page also says 3.1%) | vendor claim [4] |
| Speechmatics Enhanced | 6.7% | vendor claim [5] |
| Gemini Flash 2 | 7.8% | vendor claim [4] |
| Deepgram Nova 2 | 31.8% | vendor claim [4] |

Takeaways:
- Open local models sit at about 13 to 16% on FLEURS Hungarian. Our turbo at 20.5% is a bit worse than published large-v3, which fits: turbo is a smaller decoder, and our sample is only 12 sentences, so +/- several points of noise.
- Best commercial claims are 5 to 8%, but they are self-reported and nobody independent confirms them.
- Hungarian is among the harder FLEURS languages for every model (English is 4 to 5%, Spanish 3%) [1].
- Why WER is harsh here: Hungarian is agglutinative, so one wrong suffix ("házban" vs "házból") or a split/merged compound makes the whole word wrong. Our CER is 6.5%, which is the fairer view: most characters are right, the words are just long and inflected. I found no published human-transcriber WER for Hungarian, so I can't say what humans score. Treat 3 to 5% as a plausible human disagreement floor only as a guess.
- Honest answer: 20% is average for local open models today. Not bad, not great. About 13% is the realistic local best on this benchmark.

### Is our normalization inflating the numbers?

What `eval/run.ts` does: reference is FLEURS raw transcription (digits, casing and punctuation kept), then both sides get lowercased, apostrophes removed, all punctuation and symbols turned into spaces.

- Digits: not converted either way. FLEURS raw uses digits and Whisper mostly outputs digits too, so this mostly cancels. Risk: when a model writes a number as words, or the reverse, it costs several word errors. Likely small, I'd guess under 1 point.
- Hyphens become spaces, so "kelet-európai" is two words in the reference. If a model writes it as one word, that is 2 errors. Compounds and hyphenated names are common in FLEURS. Guess: 1 to 2 points.
- Symbols like % and + are dropped from both sides, so they do not hurt.
- Published numbers (Parakeet, Canary) use the same idea (strip punctuation and case) so we are comparable [2]. They use the Open ASR Leaderboard style normalizer, which may differ in details [1].
- Overall: normalization is probably worth 1 to 3 points, not 5+. The bigger source of difference is the tiny sample (12 distinct HU sentences). I did not run anything to measure this. A cheap check: re-score existing hypotheses with hyphens kept as one token and numbers spelled out, and compare.

## 2. Open, local options

| Option | License | Size | CPU | Node / sherpa-onnx | HU WER (source) |
|---|---|---|---|---|---|
| Whisper large-v3 (full) | MIT | 1.55B | slow, about 2x turbo decode, still OK for batch | sherpa-onnx has Whisper exports; whisper.cpp | 14.1% FLEURS [1] |
| Whisper large-v3 turbo (ours) | MIT | 0.8B | OK (RTF 0.38 on 4 threads) | yes, tested | 20.5% ours, 30 clips |
| BuzzASR/hungarian (large-v3 fine-tune) | MIT | about 1.5B, F16 safetensors | like large-v3 | needs own ONNX export, none listed [3] | 14.7% FLEURS, 10.5% CV25 [3] |
| sarpba/whisper-hu-large-v3-turbo-finetuned | MIT | 0.8B | OK | we exported it, works | 7.5% on an unnamed set [7], 18.2% ours; hurts English |
| Trendency/whisper-large-v3-hu, benmajor27/whisper-large-v3-hu_full | not checked | 1.5B | like large-v3 | export needed | 11.3% / 8.9% on Common Voice (self-reported, from our earlier notes) |
| NVIDIA Canary-1B-v2 | CC-BY-4.0 | 1B | probably OK, slower than Parakeet | sherpa-onnx lists a Canary family but I could not confirm v2 [8]; NeMo / Transformers only on its card [9] | 12.9% FLEURS [1] |
| Parakeet TDT 0.6B v3 (tested) | CC-BY-4.0 | 0.6B | fast | yes | 15.7% published, 31.3% ours |
| Meta Omnilingual ASR | Apache-2.0 [10] | CTC 300M to 7B, LLM variants 1.6B+ | 300M CTC is small | sherpa-onnx has a 300M CTC int8 export [11] | not found (Hungarian is in the 1600 language list) |
| Qwen3-ASR 1.7B / 0.6B | Apache-2.0 [6] | 2B / 0.8B | possible | sherpa-onnx has Qwen3-ASR support [12] | 34.2% / 59.5% FLEURS [6], bad |
| Mistral Voxtral Mini / Realtime | Apache-2.0 | 3B / 4B | heavy | none found | Hungarian not supported by Mistral's language lists [13] |
| Microsoft Phi-4-multimodal | MIT | 5.6B | heavy | none found | no Hungarian ASR in Canary table [1] |
| Google Gemma 3n audio | Gemma terms (not OSI) | 2B+ eff. | possible | none found | not found, not checked in depth |

Notes:
- Canary-1B-v2 is the best published open Hungarian number but the weakest on runtime: license is fine, Node path is unclear. Needs a check of whether sherpa-onnx publishes an int8 Canary v2 export.
- Fine-tune WERs are self-reported on their own splits, so don't compare them to FLEURS. The BuzzASR card is the only one that reports FLEURS directly: 14.7% WER, which is not better than stock large-v3 at 14.1% [1], and its CER (3.7%) is not better than zero-shot CER (3.57%). So that fine-tune is not a clear win on FLEURS.
- The sarpba card warns that its CTranslate2 quantized build truncates output [7]. We used our own ONNX export, which worked.
- Qwen, Voxtral, Phi, Gemma: skip for Hungarian.

## 3. Cloud APIs (possible opt-in)

| API | HU WER claim | Price per hour | Notes |
|---|---|---|---|
| ElevenLabs Scribe | 5.1% FLEURS (vendor) [4] | $0.40 [4] | |
| Speechmatics Enhanced | 6.7% FLEURS (vendor) [5] | about $0.40 to 0.56, standard about $0.24 (per Soniox page, so second hand) [14] | |
| Soniox | 1.25% on its own YouTube set (vendor, not FLEURS) [14] | about $0.10 async [14] | numbers not comparable to FLEURS |
| OpenAI gpt-4o-transcribe | no HU figure found; Soniox claims 3.24% on its own set [14] | about $0.36 ($0.006/min) [15] | |
| Google Chirp 3 | not found | about $0.96 standard ($0.016/min) [16] | Hungarian support not verified |
| Gemini Flash 2 | 7.8% FLEURS (vendor, ElevenLabs page) [4] | not checked | |
| Deepgram Nova 2 | 31.8% (vendor, ElevenLabs page) [4] | not checked | poor |
| Azure, AssemblyAI, Gladia | not found | not found | not verified, ask before relying |

All cloud numbers are vendor-run. Privacy cost: audio leaves the server, which conflicts with the "offline preferred" goal, so it can only be a clearly marked opt-in.

## 4. Cheap ways to improve what we have

Ranked by effort versus likely gain. None of these are measured yet, they are ideas for the next eval round.

| Idea | Effort | Expected effect |
|---|---|---|
| Use full Whisper large-v3 instead of turbo | low (export exists) | published 14.1% vs our 20.5% for turbo; likely the biggest easy win, costs about 2x time |
| Beam search (beam 5) instead of greedy for Whisper | low | usually a small gain, slower; check sherpa-onnx Whisper supports it in the Node API |
| Initial prompt with names and common words (Whisper `prompt`) | low | helps rare names and spelling; may not be exposed in sherpa-onnx Whisper |
| Language forced per entry (already done) | none | already in use |
| VAD tuning and chunking at pauses | low | cuts hallucinations and cut-off words; helps long entries more than FLEURS clips |
| Pick one model per language (turbo/large for HU, Parakeet or stock for EN) | low | avoids the fine-tune's English damage |
| Opt-in LLM post-correction of the transcript | medium | fixes suffixes and compounds using context; needs AI opt-in, adds a risk of changing meaning |
| Per-speaker adaptation or fine-tuning on the owner's clips | high | most likely real gain on one voice, but needs data and a training setup; list as a suggestion only |
| Fix eval normalization (hyphens, numbers) and use more clips | low | makes numbers trustworthy, no model change |

## Suggested second eval round

1. Whisper large-v3 (full, sherpa-onnx export) with beam search, on a bigger HU sample and the owner's own clips.
2. Canary-1B-v2, if a CPU runtime exists (check sherpa-onnx or ONNX export).
3. One cloud reference (ElevenLabs Scribe or Soniox) on the same clips, to see how much headroom really exists, scored with the same normalizer.

## Sources

1. Canary-1B-v2 and Parakeet-TDT-0.6B-v3 paper, Table 11 (hu column): https://arxiv.org/pdf/2509.14128
2. https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
3. https://huggingface.co/BuzzASR/hungarian
4. https://elevenlabs.io/speech-to-text/hungarian
5. https://www.speechmatics.com/speech-to-text/hungarian (seen via search result, page fetch failed)
6. Qwen3-ASR technical report: https://arxiv.org/html/2601.21337
7. https://huggingface.co/sarpba/whisper-hu-large-v3-turbo-finetuned
8. https://www.mintlify.com/XDcobra/react-native-sherpa-onnx/models/stt/other-models (third party)
9. https://huggingface.co/nvidia/canary-1b-v2
10. https://github.com/facebookresearch/omnilingual-asr and https://arxiv.org/pdf/2511.09690
11. https://csukuangfj.github.io/sherpa/onnx/omnilingual-asr/models.html
12. https://pub.dev/packages/sherpa_onnx/changelog (Qwen3-ASR entries)
13. https://mistral.ai/news/voxtral-transcribe-2 and https://huggingface.co/mistralai/voxtral-mini-4b-realtime-2602
14. https://soniox.com/compare-stt/soniox-vs-speechmatics/hungarian and https://soniox.com/compare-stt/soniox-vs-openai/hungarian
15. https://developers.openai.com/api/docs/models/gpt-4o-transcribe
16. https://cloud.google.com/speech-to-text/pricing and https://openrouter.ai/google/chirp-3
17. Hungarian conversational ASR (BEA-Large), not read in detail: https://arxiv.org/pdf/2511.13529
