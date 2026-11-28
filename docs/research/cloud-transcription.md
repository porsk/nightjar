# Cloud transcription providers

Checked on 2026-11-27. Goal: an opt-in cloud transcription provider for Nightjar (Hungarian and English, recordings up to 3 h, owner pays). Related: D-18 in `docs/decisions.md`.

Everything below comes from vendor docs and pricing pages unless noted. Prices are list prices in USD, pay as you go, pre-recorded audio. "Unverified" means I could not confirm it from a primary source.

## Result on owner clips

Run with `eval/cloud.ts` (branch `chore/eval-own-clips`) on the owner's own Hungarian clips, 2026-11-28. Both cloud
calls worked live, including deleting the audio and transcript afterwards.

| Engine | WER |
|---|---|
| Soniox `stt-async-v6` | 7.9% |
| Gladia `solaria-1` | 17.9% |
| Local Whisper large-v3 int8 | 17.9% |
| Local Whisper large-v3-turbo int8 | 25.7% |

Outcome: Soniox and Gladia become cloud engines in spec 010 (D-49 to D-58). The owner's Soniox account is US region.

## Verdict table

| Provider | Hungarian? | Price / hour | 10 min/day (5 h/mo) | 30 min/day (15 h/mo) | Max file | Retention default | Training default | EU option |
|---|---|---|---|---|---|---|---|---|
| **Soniox** (stt-async-v6) | Yes | $0.10 | $0.50 | $1.50 | 300 min (fixed) | 30 days, deletable any time | Not used | Yes, separate EU endpoint (by request) |
| **ElevenLabs Scribe v3** | Yes ("Excellent", <=5% WER tier) | $0.20 | $1.00 | $3.00 | 15 h / 5 GB | Retained by default; zero retention is opt-in per request | Unverified (see notes) | Yes, separate EU endpoint, access needed |
| **Gladia** (Solaria-1, France) | Yes, listed for Solaria-1 only (not Solaria-3). No WER found | EUR 0.27 (about $0.31) | EUR 1.35 | EUR 4.05 | 135 min, 1000 MB (**too short for 3 h**) | Up to 12 months (Self-serve), delete via API | **Used by default on Self-serve**, opt-out in profile | French host by default per security page, not guaranteed |
| **OpenAI gpt-transcribe** | Not stated in docs I read | $0.27 | $1.35 | $4.05 | 25 MB (must chunk) | Not stored for transcriptions endpoint | Not used (API) | Yes for new projects, transcription coverage unverified |
| OpenAI gpt-4o-transcribe | same | $0.36 | $1.80 | $5.40 | 25 MB | same | same | same |
| OpenAI gpt-4o-mini-transcribe | same | $0.18 | $0.90 | $2.70 | 25 MB | same | same | same |
| OpenAI whisper-1 | Yes (Whisper) | $0.36 | $1.80 | $5.40 | 25 MB | same | same | same |
| **Deepgram Nova-3** (multilingual) | Yes (`hu`) | $0.31 ($0.0052/min) | $1.56 | $4.68 | Unverified | Retained for model improvement by default; opt out per request | Used by default, `mip_opt_out=true` | Yes, `api.eu.deepgram.com` (GA Dec 2025) |
| **Speechmatics** Enhanced | Yes (`hu`) | $0.75 | $3.75 | $11.25 | Unverified | 7 days then auto delete | Opt-in per their addendum (unverified default) | Yes, regional endpoints |
| Speechmatics Standard | Yes | $0.45 | $2.25 | $6.75 | Unverified | 7 days | same | same |
| **AssemblyAI** Universal-2 | Yes, "Good" tier (10 to 25% WER) | $0.15 | $0.75 | $2.25 | Unverified | Audio deleted after 24 to 48 h, transcript after 30 days (or set TTL) | Some files used, PII redacted; opt out possible; EU servers excluded | Yes, EU servers |
| **Google Chirp 3** | Yes (`hu-HU`, Preview) | $0.96 standard ($0.016/min); dynamic batch $0.18 ($0.003/min) | $4.80 / $0.90 | $14.40 / $2.70 | Batch meant for 1 min to 1 h (20 min with word timestamps) | Unverified | Unverified | Yes, `eu` multi-region GA |
| **Azure Speech** (fast / batch) | Yes (hu-HU, from general knowledge, not re-verified) | Unverified (page showed no numbers) | ? | ? | 5 h and 500 MB (fast), 1 GB (batch) | Unverified | Unverified | Yes (pick an EU region) |
| ~~Mistral Voxtral~~ | **No**. The 13 batch languages exclude Hungarian | $0.18 ($0.003/min) | | | 3 h | | | Dropped |

Costs are tiny for all of them. Even the dearest option (Speechmatics Enhanced) is about 11 USD a month at 30 min/day. Price should not decide this. Hungarian accuracy and privacy should.

## Hungarian and English quality

There is no independent, recent, Hungarian-specific benchmark covering all of these. What exists is vendor-published, and vendors disagree with each other. Treat everything here as a hint and plan to test with the owner's own clips (this is what D-18 is for).

| Provider | Hungarian numbers found | Source and caveat |
|---|---|---|
| Soniox | 5.6% WER vs ElevenLabs 9.6% vs Deepgram 24.7% (2025 study, 60 languages, YouTube audio) | Soniox marketing page. Another Soniox page shows 1.25% / 1.71% / 3.16% for Soniox / Deepgram / ElevenLabs, so their own pages disagree. No methodology found. |
| ElevenLabs | FLEURS Hungarian: Scribe v1 5.1%, Gemini Flash 2 7.8%, Whisper Large v3 17.5%, Deepgram Nova 2 31.8%. Same page also claims 3.1% FLEURS and 5.5% Common Voice | ElevenLabs marketing page, Scribe v1 era. The 3.1% vs 5.1% on one page is unexplained. Scribe v3 claims 27% fewer errors than v2 on FLEURS averaged over 102 languages (v2 16.94%, v3 12.38%), no Hungarian figure. Docs put Hungarian in the "Excellent" tier (<=5% WER). |
| OpenAI | None found. Launch benchmark for gpt-transcribe was Common Voice over 22 languages (whisper-1 40.37% vs gpt-transcribe 19.27% average). Whisper Large v3 Hungarian FLEURS 17.5% (from the ElevenLabs page, not OpenAI) | Hungarian is not in the 22 as far as I could see, and the docs page never mentions Hungarian. Weakest evidence of the top candidates. |
| Deepgram | Nova 2 FLEURS Hungarian 31.8% (competitor page), 24.7% (Soniox page) | Competitor claims only. Nova-3 Hungarian not measured anywhere I found. Looks like the weakest on Hungarian. |
| AssemblyAI | "Good accuracy" tier, 10 to 25% WER | Their own docs. Hungarian only on Universal-2, not on the newer 3.x models. |
| Speechmatics | No WER. Soniox page claims 1.71% (see above, unreliable) | Their own page says "high accuracy" with no number. |
| Google Chirp 3 | None found | Hungarian is Preview. |
| Azure | None found | |

English: not a concern for any of them. Pipecat STT benchmark (streaming, English, November 2026) mean WER: Soniox 0.74%, AssemblyAI 0.89 to 1.12%, Azure 0.98%, Speechmatics 1.11 to 1.17%, Deepgram nova-3 1.32%, Google 1.93 to 2.46%, OpenAI gpt-4o-transcribe 3.10%, ElevenLabs scribe_v2_realtime 3.05%. It is streaming, English only, and semantic WER, so it says little about Hungarian async.

Reading the evidence: Soniox and ElevenLabs are the two with credible, stated Hungarian strength. Both are in the single digits on their own claims. OpenAI, Google and Azure are unproven for Hungarian. Deepgram and AssemblyAI look weaker.

## Privacy

| Provider | Default retention | Turn off retention | Training | EU residency | DPA and certs |
|---|---|---|---|---|---|
| Soniox | Async audio and transcripts auto-deleted after 30 days. Real-time not stored | Delete any time via Console or API (earlier than 30 days). Cannot set 0 days at upload that I found | Docs: not used to improve models | EU region with regional storage and processing, own domains like `api.eu.soniox.com`. Enabled by request. Region is set per org or project (docs disagree which) | SOC 2 Type 2, ISO 27001:2022, GDPR named. DPA not mentioned on the page I read, ask |
| ElevenLabs | Speech to text audio input retained by default | `enable_logging=false` per request (zero retention mode). One doc page labels it Enterprise only | No official statement found. A third-party blog (not verified) says training is on by default for Free and Growth, off for Enterprise | Separate EU residency API (`api.eu.residency.elevenlabs.io`), access must be granted first | Unverified, ask |
| OpenAI | `/v1/audio/transcriptions` listed with no abuse-monitoring retention and no application state | Zero Data Retention is available but needs OpenAI approval | Not used since 2023-03-01 unless you opt in | EU project residency exists (new projects only). Coverage of transcription endpoints not confirmed | DPA available (standard OpenAI business terms, not re-verified) |
| Deepgram | Requests join the Model Improvement Program and are retained by default | `mip_opt_out=true` per request, or account wide via support. Opted-out audio is kept only while processing | Yes by default, opt out as above | `api.eu.deepgram.com`, plus `mip_opt_out=true` for a full in-region guarantee. Whisper model not available on EU endpoint | SOC 2 Type 1 and 2. DPA not mentioned on the page |
| Speechmatics | Audio, transcript and config kept 7 days, then deleted | Delete via API sooner | Their Model Training Addendum reads as opt-in. Default not stated clearly | Endpoint chosen = region (EU, US, others) | ISO 27001, SOC 2 Type II, GDPR, HIPAA. Docs under NDA via Trust Center |
| AssemblyAI | Uploaded audio deleted 24 to 48 h, transcripts 30 days. TTL as short as 1 h | TTL or delete API. Streaming and sync STT can be zero retention if you opt out of training | Some files used (PII redacted) unless you opt out, use EU servers, or have a BAA | EU servers | DPA on legal pages |
| Google | Unverified | Unverified | Unverified (data logging is opt-in in my memory, not checked) | `eu` multi-region GA, `europe-west2/3` Preview | Standard Google Cloud DPA, not re-verified |
| Azure | Unverified | Unverified | Unverified | EU regions | Standard Microsoft DPA, not re-verified |

Privacy ranking for a personal journal: Soniox (no training, auto delete, EU region) and OpenAI (no retention, no training, ZDR on request) are the cleanest out of the box. ElevenLabs needs the per-request flag and possibly a plan that allows it. Deepgram needs the opt-out flag on every call.

## API fit

| Provider | Async input | Formats we care about | 3 h recording | Language hint | Punctuation | Node SDK | Free tier |
|---|---|---|---|---|---|---|---|
| Soniox | Upload to Files API then create transcription, or `audio_url` | Auto-detected: webm, m4a, ogg, mp3, wav, flac, aac, mp4 | Yes (300 min max) | `language_hints: ["hu","en"]`, "significantly improves accuracy" | Yes, built in | Node tab exists in docs, plain HTTPS is also fine | None found on pricing page |
| ElevenLabs | Upload file or cloud URL | AAC, OGG, MP3, OPUS, WAV, FLAC, M4A, WebM | Yes (15 h, 5 GB) | Language code param exists in the API from my knowledge, the docs page I read did not describe it. Auto-detect works. Scribe v3 has secondary languages for mixed audio | Yes | Official JS SDK (from my knowledge, not verified in this pass) | 4.5 h of batch on Free tier |
| OpenAI | Upload file | flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm | **No, 25 MB cap, must split** into chunks at silences | gpt-transcribe: `languages` array. Others: `language` | Yes | Official `openai` Node SDK | None for API |
| Deepgram | Upload bytes or URL | Wide, not verified for opus | Unverified | `language=hu` or multilingual model | `punctuate`, `smart_format` | Official SDK | $200 credit, no card, no expiry |
| Speechmatics | Upload job or URL | Wide, not verified | Unverified | `language: hu` | Yes | Official JS SDK (not verified) | $100 credit, no card |
| AssemblyAI | Upload or URL | Wide | Unverified | `language_code` | Yes | Official SDK | $50 credit |
| Google Chirp 3 | `BatchRecognize` from GCS | Needs GCS bucket | **No** in practice, batch is meant for up to 1 h (20 min with word timestamps) | Yes | Yes | Official client | Unverified |
| Azure | Fast transcription REST or batch from blob | Wide | Yes (5 h fast, 1 GB batch) | Locale list | Yes | REST, SDK | F0 free tier: no batch |

Rate limits: not a concern for a single-user journal. Soniox default is 100 pending transcriptions. Azure fast and batch share 600 requests/min. Others unverified, and they are all far above our use.

Our recordings: browser MediaRecorder gives webm/opus (Chrome, Firefox) or mp4/m4a (Safari). Soniox, ElevenLabs and OpenAI all accept both without a transcode step on our side.

## Other things that matter

- **OpenAI model churn.** `whisper-1`, `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` are deprecated, shutdown 2027-02-26, replaced by `gpt-transcribe` (and `gpt-live-transcribe`). If we pick OpenAI it must be `gpt-transcribe`. Also the 25 MB cap means we need chunking code, which is the opposite of "smallest change".
- **Google Chirp 3** Hungarian is Preview, needs GCS buckets, and batch is not meant for long audio. Drop for us.
- **Azure** is fine technically (5 h per file) but needs an Azure subscription, resource and region setup, which is heavy for a self-hosted app where the admin pastes an API key. Price page showed no numbers, so I cannot compare.
- **Deepgram** pricing is fine but Hungarian looks weak and privacy is opt-out per request.
- **AssemblyAI** Hungarian falls back to the older Universal-2, rated "Good" not "Excellent".
- **Speechmatics** is the dearest and has no published Hungarian figure. Good privacy defaults (7 day delete).
- **Vendor stability.** ElevenLabs and OpenAI are large and stable. Soniox is a smaller company (docs show frequent model renames, e.g. v5 to v6 within months). Keep the provider behind a thin interface so swapping is cheap. Soniox pricing pages cite "Updated June 2026", so prices move.
- **Soniox extras (included at no cost):** language identification, smart formatting. Word timestamps are not needed.
- **Conflicts in Soniox docs** to confirm with them: one page says async max is 60 minutes in a search snippet, but the docs pages I fetched directly say 300 minutes, fixed. 300 minutes covers our 3 h.

## Suggested shortlist (for the owner's decision)

1. **Soniox** as the default cloud provider: cheapest, strongest Hungarian claim, simple async API, fits 3 h files, 30 day auto delete, no training, EU region available.
2. **ElevenLabs Scribe v3** as the second option or as the quality yardstick: strong Hungarian claim, big vendor, but retention is on by default and zero retention may need a higher plan.
3. **OpenAI gpt-transcribe** only if the owner already has an OpenAI account: good privacy defaults, but 25 MB cap needs chunking and there is no Hungarian evidence.

All three accept webm and m4a, so no ffmpeg step is needed on the cloud path for Soniox and ElevenLabs.

## Open questions for the owner

1. Must data stay in the EU? If yes: Soniox EU (by request, extra step), ElevenLabs EU residency (access needed), OpenAI EU project (check transcription coverage), Deepgram EU endpoint.
2. Is a 30 day vendor-side copy acceptable (Soniox default), or should it be deleted right after transcription? Nightjar can call the delete API after each job. Soniox and Speechmatics and AssemblyAI support this.
3. Are you OK with one provider or do you want a choice in Settings (D-24 style)? Smallest change is one provider.
4. Run the bake-off before choosing: 5 to 10 of your own Hungarian clips through Soniox and ElevenLabs (and optionally OpenAI) is cheap (cents) and beats any vendor number. Needs accounts on each.
5. Which Soniox EU option is needed (org-level region seems fixed at creation, so create the account in EU from the start)?

## Gladia (checked 2026-11-27)

Added because the owner wants an EU provider. Short version: EU company, cheap, but no Hungarian quality evidence, a 135 min file cap, and Self-serve trains on your audio by default.

| Question | Answer | Source |
|---|---|---|
| Model for Hungarian async | **Solaria-1** (generalist, 100+ languages, async and live, code switching). Default if `model` is omitted | [pre-recorded docs](https://docs.gladia.io/chapters/pre-recorded-stt/getting-started) |
| Solaria-3 | More accurate, but only EN, FR, DE, ES, IT, one language per job, async only. **Hungarian: No** | [languages](https://docs.gladia.io/chapters/language/supported-languages) |
| Hungarian listed? | Yes for Solaria-1 (also code switch and translation). The page does not say async vs live, but Solaria-1 does both | [languages](https://docs.gladia.io/chapters/language/supported-languages) |
| Hungarian WER | **None found**, not from Gladia, not independent. Their own English set: Solaria-1 12.9%, Solaria-3 9.6%. Artificial Analysis AA-WER: Solaria-1 4.07%, Solaria-3 3.23%, but on English datasets | [Artificial Analysis](https://artificialanalysis.ai/speech-to-text/models/gladia-solaria), [Gladia benchmarks](https://gladia.io/competitors/benchmarks) |
| Price async | Solaria-1 EUR 0.27/h (EUR 0.21 at 10,000+ h/month). Solaria-3 EUR 0.16/h but no Hungarian. No subscription, no minimum top-up stated | [pricing](https://www.gladia.io/pricing) |
| Monthly cost (Solaria-1) | 10 min/day (5 h): EUR 1.35. 30 min/day (15 h): EUR 4.05 | calculated |
| Free credit | **EUR 50, one-time, valid one year**. About **185 h of async on Solaria-1** (their figure, 50 / 0.27). That is about 37 months at 5 h/month, or about 12 months at 15 h/month, so the one-year expiry is the limit. Top-up credits never expire. Startup Studio credits have separate terms (expire at programme end). Start date of the year not stated | [pricing](https://www.gladia.io/pricing), [pricing.md](https://www.gladia.io/pricing.md), [Startup Studio terms](https://www.gladia.io/start-up-studio-terms) |
| Older free tier | A third party says a recurring 10 free h/month tier was replaced by the EUR 50 credit in July 2026. Not confirmed by Gladia | [usagepricing.com](https://www.usagepricing.com/blueprint/activity/gladia-2026-07-22-free-tier-prepaid-wallet) |

### Gladia privacy

| Question | Answer | Source |
|---|---|---|
| Where processed | Security page: default is "a European provider based in France", other regions on request. No provider named, **no sub-processor list** found. Privacy notice mentions transfers outside the EU under SCCs or the Data Privacy Framework and does not say where audio lives | [security](https://www.gladia.io/security), [privacy notice](https://www.gladia.io/privacy-policy) |
| Retention | Up to **12 months by default**. Custom (1 month, 1 week, 1 day, zero) is **Enterprise only** | [security](https://www.gladia.io/security), [pricing.md](https://www.gladia.io/pricing.md) |
| Delete | `DELETE /v2/pre-recorded/{id}` removes the audio and transcript, returns 202. Nightjar could call it after every job | [delete endpoint](https://docs.gladia.io/api-reference/v2/pre-recorded/delete) |
| Training | **Self-serve: opted in by default**, free opt-out in the profile. Enterprise: opted out. The security page says free plan audio may be used, Pro and Enterprise not. The pricing page is inconsistent in wording. The privacy notice says training uses public Creative Commons datasets and is silent on customer audio | [pricing.md](https://www.gladia.io/pricing.md), [security](https://www.gladia.io/security) |
| DPA, certs | DPA page linked in footer (terms not read). GDPR and SOC 2 Type 1 and 2 claimed. ISO 27001 is "working towards" in text but a badge says compliant. HIPAA badge only | [security](https://www.gladia.io/security) |
| Company | Paris. $16M Series A in Oct 2024 led by XAnge, $20.3M total. **OVHcloud (French cloud group) announced exclusive talks on 2026-06-11, and a closing press release exists** (I did not read its date or terms). Likely stable and EU-owned, but terms and pricing may change | [TechCrunch](https://techcrunch.com/2024/10/15/gladia-believes-real-time-processing-is-the-next-frontier-of-audio-transcription-apis), [OVH closing](https://corporate.ovhcloud.com/en/newsroom/news/ovh-group-gladia-closing-acquisition-voice-ai/) |

### Gladia API fit

| Question | Answer | Source |
|---|---|---|
| Flow | `POST /v2/upload` (multipart), `POST /v2/pre-recorded` with `audio_url` and options, then poll `GET /v2/pre-recorded/:id`, or webhook, or `callback_url` | [docs](https://docs.gladia.io/chapters/pre-recorded-stt/getting-started) |
| Formats | Opus and M4A listed. **WebM is not listed** (Matroska is), so Chrome and Firefox recordings may need an ffmpeg remux, or a test | [formats](https://docs.gladia.io/chapters/limits-and-specifications/supported-formats) |
| Max file | **135 min and 1000 MB** (Enterprise 4 h 15 min). Docs suggest about 60 min chunks. Our 3 h recordings need splitting | [formats](https://docs.gladia.io/chapters/limits-and-specifications/supported-formats) |
| Language | `language_config.languages`. Solaria-1 takes several languages plus code switching, so `["hu","en"]` is possible. Real hu/en quality untested | [docs](https://docs.gladia.io/chapters/pre-recorded-stt/getting-started) |
| Punctuation | Not mentioned on the pages I read | |
| SDK | Official `@gladiaio/sdk` (upload, create, poll, `transcribe()` helper). Plain HTTPS also fine | [docs](https://docs.gladia.io/chapters/pre-recorded-stt/getting-started) |
| Limits | Self-serve: 25 concurrent async, 30 live | [pricing](https://www.gladia.io/pricing) |

### Gladia vs Soniox vs ElevenLabs

| | Gladia (Solaria-1) | Soniox | ElevenLabs Scribe v3 |
|---|---|---|---|
| Hungarian quality evidence | None (only listed) | Vendor claims, 5.6% WER (unreliable) | Vendor FLEURS 5.1% (v1), "Excellent" tier |
| Price / hour | EUR 0.27 | $0.10 | $0.20 |
| Max file | 135 min | 300 min | 15 h |
| Privacy default | Up to 12 months, trains on Self-serve unless opted out | 30 days, no training | Retained, zero retention opt-in |
| EU | French company, French host by default (OVHcloud-owned) | EU endpoint on request | EU residency endpoint, access needed |

My view: not the best default. No Hungarian accuracy evidence, the best model (Solaria-3) has no Hungarian, the 135 min cap breaks our 3 h case, WebM is not listed, and privacy defaults are worse than Soniox. It is a fair fit if EU ownership matters most: cheap, delete API, and the EUR 50 credit pays for roughly a year of heavy use. Sensible move: include it in the bake-off with the owner's own Hungarian clips (the credit makes that free). If it wins, set the training opt-out and call the delete endpoint after each job.

## SpeechTex

I could not find it. Searches for "SpeechTex" and "SpeechTex.hu" returned no page from a Hungarian company, only similar names (SpeechText.AI, SpeechTexter). So pricing, Hungarian accuracy claims and data location are all unverified. If the owner has a URL, check it for a public self-serve API. I would not count it as an option until then.

## Sources (all checked 2026-11-27)

- Soniox pricing: https://soniox.com/pricing
- Soniox languages: https://docs.soniox.com/stt/concepts/supported-languages
- Soniox async: https://docs.soniox.com/stt/async/async-transcription
- Soniox limits: https://docs.soniox.com/stt/async/limits-and-quotas
- Soniox security and privacy: https://docs.soniox.com/stt/security-and-privacy
- Soniox data residency: https://soniox.com/docs/data-residency
- Soniox vs Deepgram, Hungarian (vendor claim): https://soniox.com/compare/soniox-vs-deepgram/hungarian
- Pipecat STT benchmark via Soniox: https://soniox.com/benchmarks
- ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- ElevenLabs speech to text docs: https://elevenlabs.io/docs/overview/capabilities/speech-to-text
- ElevenLabs Hungarian page (vendor claim): https://elevenlabs.io/speech-to-text/hungarian
- ElevenLabs zero retention mode: https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode
- ElevenLabs data residency: https://elevenlabs.io/docs/overview/administration/data-residency
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI deprecations: https://developers.openai.com/api/docs/deprecations
- OpenAI speech to text guide: https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI your data: https://developers.openai.com/api/docs/guides/your-data
- OpenAI data residency in Europe: https://openai.com/index/introducing-data-residency-in-europe/
- Deepgram pricing: https://deepgram.com/pricing
- Deepgram languages: https://developers.deepgram.com/docs/models-languages-overview
- Deepgram trust and security: https://developers.deepgram.com/trust-security/
- Speechmatics pricing: https://www.speechmatics.com/pricing
- Speechmatics languages: https://docs.speechmatics.com/speech-to-text/languages
- Speechmatics security: https://docs.speechmatics.com/administration/security-and-compliance
- AssemblyAI pricing: https://www.assemblyai.com/pricing
- AssemblyAI languages: https://www.assemblyai.com/docs/pre-recorded-audio/supported-languages
- AssemblyAI retention: https://assemblyai.com/docs/data-retention-and-model-training
- Google Chirp 3: https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3
- Google pricing (could not read in full): https://cloud.google.com/speech-to-text/pricing
- Azure Speech limits: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits
- Azure Speech pricing (numbers not shown): https://azure.microsoft.com/en-us/pricing/details/speech/
- Mistral Voxtral Transcribe 2: https://mistral.ai/news/voxtral-transcribe-2

## Not verified

- Azure price per hour, Azure and Google retention and training terms, Azure Hungarian support (assumed).
- Google price for Chirp 3 specifically ($0.016/min is the v2 standard rate from a Google blog and OpenRouter, dynamic batch $0.003/min from a third party tracker).
- Max file size and duration for Deepgram, Speechmatics, AssemblyAI.
- ElevenLabs training default, ElevenLabs language hint parameter, DPA availability for Soniox, ElevenLabs, Deepgram.
- Gladia: any Hungarian WER, punctuation setting, WebM acceptance in practice, DPA terms, sub-processor list, exact EU hosting provider, when the EUR 50 credit year starts, OVH closing date and terms, whether the training opt-out is in the API. SpeechTex: everything (service not found). Gladia source links are inline in its section.
- Any Hungarian WER for gpt-transcribe, Chirp 3, Azure, Speechmatics, Nova-3, Scribe v3, Soniox from an independent source.
