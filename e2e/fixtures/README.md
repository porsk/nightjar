# Audio fixtures

Short speech clips for the fake microphone in the e2e tests (16 kHz, mono, 16-bit WAV).

| File | Language | Text | FLEURS clip |
|---|---|---|---|
| `hu-sample.wav` | Hungarian | Chandra Shekhar Solanki rendőrfelügyelő szerint a vádlottak fedett arccal jelentek meg a bíróságon. | `9129760615066324066`, `hu_hu` test split |
| `en-sample.wav` | English | Swirl the two dry powders together and then, with clean wet hands, squeeze them into a ball. | `1944915261206096046`, `en_us` test split |

Source: [FLEURS](https://huggingface.co/datasets/google/fleurs) by Google, licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). The only changes are the conversion from 32-bit float to
16-bit PCM and a peak normalization to 0.5. The e2e tests rely on that level. Never put private recordings in this folder.
