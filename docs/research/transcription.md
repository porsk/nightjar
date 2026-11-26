# Research: offline Hungarian + English transcription

Gathered 2026-11-24. Verify numbers before relying on them; WER figures come from different test sets.

## Candidate models

### NVIDIA Parakeet TDT 0.6B v3
- 25 European languages incl. Hungarian (`hu`) and English, automatic language detection.
- License CC-BY-4.0 (commercial use allowed, attribution required).
- Word- and segment-level timestamps.
- Reported WER, FLEURS hu: **15.72%** (greedy, no LM, punctuation/case removed). FLEURS average across languages: 11.97%.
- Small (0.6B), int8 ONNX export available → fast on CPU.
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3

### OpenAI Whisper large-v3 / large-v3-turbo + Hungarian fine-tunes
- 99 languages, MIT. Slower on CPU than Parakeet; known to hallucinate on silence (use VAD).
- Hungarian fine-tunes (self-reported, not comparable):
  - sarpba/whisper-hu-large-v3-turbo-finetuned - WER 7.48% on its eval set, MIT - https://huggingface.co/sarpba/whisper-hu-large-v3-turbo-finetuned
  - Trendency/whisper-large-v3-hu - mean WER 11.26 on Common Voice deltas - https://huggingface.co/Trendency/whisper-large-v3-hu
  - benmajor27/whisper-large-v3-hu_full - WER 8.86 on CV17 - https://huggingface.co/benmajor27/whisper-large-v3-hu_full
  - Maxdorger LoRA (large-v3 and turbo, CTranslate2 builds) - targets accents, names, silence hallucinations - https://github.com/Maxdorger/whisper-hungarian-lora

## Running from Node
- **sherpa-onnx** - `sherpa-onnx-node` (native addon) and `sherpa-onnx` (WASM) on npm, Node ≥ 18.
  Supports Parakeet TDT v3 (int8 model `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`), Whisper, Silero VAD.
  Docs: https://csukuangfj.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html
- Whisper fine-tunes need a one-time export to ONNX (Python script from sherpa-onnx) to run there.
- Alternatives: whisper.cpp Node bindings; external OpenAI-compatible server (speaches / faster-whisper) for GPU hosts.

## Plan
Build `eval/`: ~20 own clips (HU + EN, quiet and noisy, short and long) with reference transcripts;
script computes WER/CER, speed, RAM and cost per option. Start with public HU/EN test clips, then the owner's clips.
Local free options first (Parakeet v3, Whisper turbo, HU fine-tunes). Paid cloud APIs only as a quality reference if
local results are poor. Owner decides from the report (O-5).

## Prior art (voice journals / self-hosted journals)
- Journiv - self-hosted Day One-like journal (license reportedly PolyForm Noncommercial - don't copy code) - https://github.com/journiv/journiv-app
- WhisperJournal - on-device RN voice journal (whisper.cpp), no server - https://github.com/kaisoapbox/WhisperJournal
- Scriberr, Speakr, Homescribe - self-hosted transcription tools, not journals
- Memos (MIT) - self-hosted notes/microblog
