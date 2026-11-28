# 010 Cloud transcription providers

Status: approved
Milestone: after 0.2.1

## Why
On the owner's own Hungarian clips Soniox makes about 3x fewer errors than the best local model (WER: Soniox 7.9%,
Gladia 17.9%, local large-v3 17.9%, turbo 25.7%; `docs/research/cloud-transcription.md`). The admin can pick a cloud
provider as the one transcription engine of the installation, with the API key kept safe and the audio deleted at the
provider after each job (D-49 to D-60).

## Scope
In (mockups: `design/alkony/010-cloud-transcription.html`, screenshots in `design/alkony/screenshots/010/`):
- **Engines.** Local models (spec 009) and cloud providers are both "engines". One engine is active for the whole
  installation (instance-wide, admin only). Every recording is transcribed by the engine that is active when its job
  starts; switching never interrupts a running job (spec 009 rules).
- **Two providers:** Soniox (`stt-async-v6`) and Gladia (`solaria-1`). Each is one module that declares its id, label,
  secret fields (an API key), capabilities (max audio length, accepted formats, languages) and price per hour. A registry
  lists them. The job pipeline knows nothing about a specific provider.
- **Settings > Rendszergazda:** the model list becomes one engine list with two groups, "Helyi" (chip icon) and
  "Felhő" (cloud icon). Cloud rows: API key entry (write-only: empty, saved and masked, replace, remove), "Kulcs
  ellenőrzése" (test the key, no audio sent), "Váltás erre" once a key is saved, and an estimate of this month's use
  ("Ebben a hónapban: 3,2 óra · kb. 0,32 USD (becslés)").
- **Key at rest:** encrypted with AES-256-GCM under the instance secret: `NIGHTJAR_SECRET_KEY` when it is set, else a
  key file the server makes on first start in the data folder (D-59). Never returned by the API, never logged, never in
  error messages.
- **Icons:** cloud vs local icon in the engine list and on the transcript label (cloud icon + "Soniox", chip icon +
  "Turbo"). That label is the only place outside Settings that shows where an entry was processed.
- **No privacy notes outside Settings (D-60):** the existing note "A hang a saját szervereden marad." goes away from the
  desktop sidebar and the record screen, and its i18n key is removed. Settings keeps its notes (the switch hint and
  the Felhő group hint).
- **Privacy:** after every attempt the audio and the transcript are deleted at the provider. A failed delete is logged
  without content and retried by a job. Every transcript keeps the id of the engine that wrote it.
- **Long recordings:** a recording longer than the provider's max length is split with ffmpeg (stream copy, cut in a
  pause) into parts under the limit; the parts are transcribed one after the other and the texts joined.
- **Formats:** a stored format the provider does not accept is remuxed with stream copy (webm/opus to ogg/opus for
  Gladia).
- **Failures:** the recording goes to `failed` with a short reason code the card explains in plain words; "Újrapróbálás"
  and "Átírás újra" work as before. No automatic fallback to a local model.

Out (not now): cloud providers for the AI features (S-26), any "where is it transcribed" note on the record or upload
screen (owner: privacy notes only in Settings), cost per recording (owner: not on the recording screen), a provider
region choice (owner: not needed, the owner's Soniox account is US region), more than one active engine, per-user or
per-recording engine choice, rotating the instance secret.

This spec replaces the "Multiple transcription engines: one sherpa-onnx model" and "Encrypted secrets in DB before M3"
lines of `architecture.md` §12 when it is built. The instance secret it adds is the one the M3 AI key will use too
(D-24).

## Flows

```
Settings, transcription on, engine list
  Felhő row "Nincs API-kulcs" --API-kulcs megadása--> form [key] --Kulcs ellenőrzése--> ok | invalid key | can't reach
                                                              --Mentés--> "Kulcs mentve" (masked)
  "Kulcs mentve" --Váltás erre--> active ("Használatban")          (running job finishes on its old engine)
                 --Csere--> form --Mentés--> replaced  /  --Mégse--> unchanged
                 --Eltávolítás--> confirm --> "Nincs API-kulcs"     (not offered on the active engine)

Job with a cloud engine
  pending -> transcribing -> [split if longer than max] -> [remux if format not accepted]
          -> per part: upload -> start -> poll -> text           -> join -> save transcript -> done
          \-> any error: failed (reason code) after retries, or at once for a bad key / no credit / rejected audio
  after every attempt (done or failed): delete each vendor copy; a failed delete goes to the cleanup job
```

### Engine rows

| Row | Shows | Actions |
|---|---|---|
| Local model | as spec 009, with a chip icon before the name | as spec 009 |
| Cloud, no key | cloud icon, name, description with price, state "Nincs API-kulcs" | "API-kulcs megadása" (opens the form). "Váltás erre" is not shown |
| Cloud, form open | password field "API-kulcs" (`autocomplete="off"`, `spellcheck="false"`), test result line | "Mentés" (primary), "Kulcs ellenőrzése" (line), "Mégse" (text, closes the form; not shown for an unreadable key) |
| Cloud, key saved | state "Kulcs mentve", key line "API-kulcs •••••••• " with "Csere" and "Eltávolítás", usage line | "Váltás erre" (primary), "Kulcs ellenőrzése" (line) |
| Cloud, in use | accent chip "Használatban", accent border, key line with "Csere" only, usage line | "Kulcs ellenőrzése" (line) |
| Cloud, key unreadable | alert "A mentett kulcs nem olvasható. Add meg újra." | form opens with "Mentés" and "Kulcs ellenőrzése" |

- The masked dots are fixed (8), not the key length. Nothing of the key (no last 4 characters) leaves the server.
- "Kulcs ellenőrzése" on an open form tests the typed key without saving it; on a saved row it tests the saved key.
  Result lines: "A kulcs működik." (check icon), "A szolgáltató nem fogadta el a kulcsot." (alert), "Nem sikerült elérni a
  szolgáltatót. Próbáld újra később." (alert). The result clears when the field changes.
- The Felhő group has one hint line under its heading: "A hangot átírásra elküldjük a szolgáltatónak, utána töröljük
  nála."
- The switch hint and the ready line under the transcription switch name the active engine: local as today; cloud
  "A felvételek szöveggé alakítása felhőszolgáltatással ({{engine}})." and "Az új felvételeket a felhőben írjuk át
  ({{engine}})."; with the active provider's key unreadable (`needs_key`) the ready line is "Add meg újra az
  API-kulcsot. Addig az új felvételek várnak." (alert icon).
- Usage line on every cloud row that has a key saved or any use this month: "Ebben a hónapban: {{hours}} óra · kb.
  {{cost}} (becslés)". Hours with one decimal (`Intl.NumberFormat`, "3,2" / "3.2"), cost in the provider's currency
  (`Intl.NumberFormat` currency style, "0,32 USD" in `hu`, "$0.32" in `en`).

## Provider interface

`apps/server/src/modules/transcription/cloud/`: `provider.ts` (types and the HTTP helper), `soniox.ts`, `gladia.ts`,
`registry.ts`, `cloud-transcriber.ts`, `split.ts`, `secrets.ts`, `cleanup.ts`.

```ts
export type AudioExtension = 'webm' | 'ogg' | 'm4a' | 'aac' | 'mp3' | 'wav' | 'flac' // what sniff.ts stores
export type FailureCode =
  | 'api_key_invalid' | 'quota_exceeded' | 'provider_unavailable' | 'timeout' | 'audio_rejected'

/** Thrown by provider code. Only the code and the HTTP status (when there is one) travel, never a response body. */
export class ProviderError extends Error {
  constructor(readonly code: FailureCode, readonly httpStatus?: number) { super(code) }
}

export interface SecretField { id: 'apiKey'; kind: 'secret' } // a list, so a provider with more fields fits later

export interface ProviderCall {
  secrets: Record<string, string> // decrypted, only in memory for the call
  fetch: typeof fetch
  signal: AbortSignal
}

/** Ids the vendor gave us for one uploaded part. Opaque to the pipeline, stored so it can be deleted later. */
export type VendorCopy = Record<string, string> // Soniox { fileId, transcriptionId? }, Gladia { audioUrl, jobId? }

export type PollResult =
  | { state: 'running' }
  | { state: 'done'; text: string; language?: Language } // detected language, when the vendor gives one

export interface CloudProvider {
  id: string                                // 'soniox', unique across local models and providers
  label: string                             // brand name, not translated: 'Soniox'
  secrets: readonly SecretField[]           // [{ id: 'apiKey', kind: 'secret' }]
  capabilities: {
    maxAudioMs: number | null               // longer recordings are split; null = no limit under our 3 h
    formats: readonly AudioExtension[]      // containers the vendor accepts as they are
    languages: readonly Language[]          // must include 'hu' and 'en'
  }
  pricePerHour: { amount: number; currency: 'USD' | 'EUR' } // list price, for the description and the estimate
  /** One cheap authenticated call that sends no audio. */
  checkKey(call: ProviderCall): Promise<'ok' | 'invalid_key' | 'unreachable'>
  upload(call: ProviderCall, file: { path: string; extension: AudioExtension }): Promise<VendorCopy>
  start(call: ProviderCall, copy: VendorCopy, language: EntryLanguage): Promise<VendorCopy> // adds the job id
  poll(call: ProviderCall, copy: VendorCopy): Promise<PollResult>
  /** Deletes everything the copy names. "Not found" counts as deleted. Throws ProviderError otherwise. */
  remove(call: ProviderCall, copy: VendorCopy): Promise<void>
}
```

- `registry.ts` exports `cloudProviders: CloudProvider[]` (Soniox, then Gladia) built by `createSonioxProvider({ baseUrl })`
  and `createGladiaProvider({ baseUrl })` with the real base URLs as defaults. `start()` takes an optional
  `providers` list next to `models`, so tests point them at the fixture server. Adding a provider = one module, one
  registry line, two catalogue entries.
- HTTP helper (`provider.ts`): every call has its own timeout (upload 15 min, others 30 s) joined with the job's signal.
  Status mapping: 401/403 `api_key_invalid`; 402 `quota_exceeded`; 408, 429, 5xx, network errors and call timeouts
  `provider_unavailable`; other 4xx on upload or start `audio_rejected`; a vendor job in its error state
  `audio_rejected`. Uploads stream from disk (`fs.openAsBlob`), never read whole into memory, and use the fixed file
  name `audio.<ext>`.
- `pricePerHour` and the vendor model names are constants in the module; changing them is a code change.

### The two providers

Checked live with `eval/cloud.ts` (branch `chore/eval-own-clips`) against both APIs, including the deletes.

| | Soniox | Gladia |
|---|---|---|
| Base URL | `https://api.soniox.com/v1` | `https://api.gladia.io/v2` |
| Auth header | `Authorization: Bearer <key>` | `x-gladia-key: <key>` |
| Upload | `POST /files` multipart `file` → `{ id }` → copy `{ fileId }` | `POST /upload` multipart `audio` → `{ audio_url }` → copy `{ audioUrl }` |
| Start | `POST /transcriptions` `{ model: 'stt-async-v6', file_id, language_hints }` (+ `enable_language_identification: true` for auto) → `{ id }` | `POST /pre-recorded` `{ audio_url, model: 'solaria-1', language_config: { languages } }` → `{ id }` |
| Language `hu` / `en` | `language_hints: ['hu']` / `['en']` | `languages: ['hu']` / `['en']` |
| Language `auto` | `language_hints: ['hu', 'en']`, detection on | `languages: ['hu', 'en']` |
| Poll | `GET /transcriptions/:id` `status` `queued`/`processing`/`completed`/`error`; then `GET /transcriptions/:id/transcript` → `text`, `tokens[].language` | `GET /pre-recorded/:id` `status` `queued`/`processing`/`done`/`error`; `result.transcription.full_transcript`, `.languages[0]` |
| Detected language (auto) | the language with the most token characters | `languages[0]` |
| Delete | `DELETE /transcriptions/:id` and `DELETE /files/:id`, 204 (404 = gone) | `DELETE /pre-recorded/:id`, 202 (404 = gone): removes audio and result |
| Check key | `GET /files?limit=1` | `GET /pre-recorded?limit=1` |
| `maxAudioMs` | `null` (300 min, above our 3 h) | `135 * 60_000` |
| `formats` | webm, ogg, m4a, aac, mp3, wav, flac | ogg, m4a, aac, mp3, wav, flac (no webm) |
| Price | 0.10 USD / hour | 0.27 EUR / hour |

A detected language that is not `hu` maps to `en` (same rule as the local engine). The two check-key endpoints are the
only vendor calls not yet run live: the build confirms them once against the real APIs with the owner's keys (outside
CI) and swaps in another cheap authenticated read if one does not answer as expected.

Gladia limit: the uploaded file can only be deleted through a job. If `start` fails after `upload`, the copy
`{ audioUrl }` has nothing to delete with; it is logged (`reason: 'no_delete_api'`) and dropped, and Gladia's own
retention applies (research: up to 12 months on self-serve).

## Server behaviour

### Engines and the job

- `instance_settings.active_model` is renamed `active_engine` and holds a local model id or a provider id. An unknown id
  falls back to the default local model (as spec 009).
- `Transcriber` gets the input it needs, so the job stays provider-agnostic:

```ts
export interface AudioFile { path: string; extension: AudioExtension; durationMs: number; recordingId: string; userId: string }
export interface Transcriber {
  readonly modelId: string          // engine id, stored on the transcript
  readonly input: 'wav' | 'original' // local: the job makes the 16 kHz WAV first; cloud: the stored file as is
  transcribe(audio: AudioFile, language: EntryLanguage, signal: AbortSignal): Promise<TranscriptResult>
  dispose(): Promise<void>
}
export type TranscriberFactory = (engineId: string) => Transcriber // local model or cloud provider
```

- The job reads the active engine at its start (as spec 009). A loaded local transcriber for another engine is
  disposed first, so switching to cloud frees the model memory at the next job. A cloud transcriber holds no model; it
  reads and decrypts the key at the start of each `transcribe` call, so a replaced key is used by the next job.
- Cloud transcriber, per job:
  1. Remove leftovers of an earlier attempt of the same recording (rows in `cloud_copies`, see Cleanup).
  2. Pick parts: one part, or the split below. Pick the container: the stored one when the provider accepts it, else
     the stream-copy target from `copyTargets = { webm: 'ogg' }` (a registry test proves every stored format is covered
     for every provider). Remuxing and splitting run in one ffmpeg call into `tmp/`, removed in `finally`.
  3. Per part, in order: `upload`, insert a `cloud_copies` row with the copy, `start`, update the row, `poll` every 3 s
     until done or the part deadline (`max(10 min, part length)`) passes (`timeout`).
  4. Join part texts with one space, trim. The language is the asked one, or for `auto` the detected language of the
     first part.
  5. In `finally`: delete every copy of this attempt (`remove`, one try each). A deleted copy's row is removed. If any
     row is left, queue one `cloud-cleanup` job.
- Failures: `api_key_invalid`, `quota_exceeded` and `audio_rejected` are permanent. The job sets the recording to
  `failed` with that code at once and ends without throwing, so pg-boss does not retry. `provider_unavailable`,
  `timeout` and any other error throw and follow the existing retries (2); after the last one the recording is `failed`
  with the code (`provider_unavailable` / `timeout`, or `null` for a local or unknown error, which the card shows with
  today's text). Nothing ever falls back to another engine.
- `recordings.failure` is set together with `failed` and cleared whenever the recording goes back to `pending`
  (retry, transcribe again, backlog, setting transcription on).
- Job expiry (`jobs.ts`): `max(30 min, 5 x audio length)` for every job (was `max(10 min, …)`), so a short cloud job
  never expires while it waits in the vendor's queue. The active engine at enqueue time is not known for sure, so one
  rule for both.
- `transcripts.transcribed_at` is set to now on every insert and every upsert the job writes (not on hand edits).

### Split

`split.ts`, used only when `durationMs > maxAudioMs`:
- `n = ceil(duration / (0.9 x max))`; target cut `i` is at `i x duration / n`.
- One ffmpeg `silencedetect=noise=-35dB:d=0.4` pass over the file. Each cut goes to the middle of the silence closest
  to its target within `min(60 s, 0.05 x max)`; with none in reach it stays on the target. Every part stays under the
  max (the 0.9 factor leaves room for the window).
- `ffmpeg -protocol_whitelist file -f <format> -i <file> -vn -c:a copy -f segment -segment_times t1,t2,…
  -reset_timestamps 1 -segment_format <container> tmp/<id>-%03d.<ext>`. Stream copy cuts on packet boundaries (20 ms for
  opus), no re-encode.
- Recordings are at most 3 h, so Gladia needs at most 2 parts today.

### Cleanup

- `cloud_copies` holds one row per vendor copy that may still exist. Rows hold vendor ids only, never content.
- Queue `cloud-cleanup` (pg-boss, `retryLimit: 3`, `retryDelay: 60`, `retryBackoff: true`, singleton per minute):
  deletes every row older than 1 minute whose recording is not `transcribing` (or is gone), with that provider's saved
  key. Success removes the row. A failure logs `{ provider, reason }` at `warn` ("provider cleanup failed"); after the
  last retry it logs "provider cleanup gave up" and the row stays for the next run.
- Worker start queues one `cloud-cleanup` job, so copies left by a stopped server are deleted.
- A provider without a readable key cannot delete: reason `api_key_missing`, the row stays. Removing a key is still
  allowed (the admin may have revoked it at the vendor).

### Key storage

The instance secret is 32 random bytes written as 64 hex characters (`openssl rand -hex 32`). Where it comes from
(D-59), decided once at start, before the web and worker start:

| Source | When | Rules |
|---|---|---|
| `NIGHTJAR_SECRET_KEY` env var | set (also when empty: then the start fails) | validated in `config.ts`: exactly 64 hex characters, else the start stops naming the variable, never its value. The key file is then neither read nor created |
| `<data>/secret.key` file | env var not set | read if it exists (64 hex characters, one trailing newline allowed); created with mode `0600` if missing. Any other content stops the start with a clear log line (no key content) |

- The log says which source is used (`instance secret from env` / `from file` / `created file`), never the value.
- Moving from the file to the env var: copy the file's content into `NIGHTJAR_SECRET_KEY`. With a different value the
  saved provider keys show as unreadable and must be entered again (nothing else is lost).
- `secrets.ts`: AES-256-GCM, key = HKDF-SHA256(instance secret, info `nightjar provider secrets v1`), random 12-byte IV per
  write, additional data = provider id (a row copied to another provider does not decrypt). Stored as
  `v1.<iv>.<tag>.<ciphertext>` (base64url) in `provider_secrets.ciphertext`; the plaintext is the JSON object of the
  provider's secret fields.
- A row that does not decrypt (secret changed, data tampered) counts as no key, with `keyError: 'unreadable'`. Nothing
  is deleted automatically; saving a new key replaces the row.
- The decrypted key lives only inside one provider call. Pino redaction adds `apiKey`, `*.apiKey`, `secrets`,
  `*.secrets`; provider errors never carry bodies or headers; Fastify request logs have no bodies (as today).
- Docs: `self-hosting.md` and `backup.md` describe both sources (added with this spec, marked for the release that
  ships it). Back up `secret.key` (it is in the data folder, so the existing backup has it) or keep the env value safe;
  a database restored without its secret keeps everything but the provider keys, which must be entered again.

### Status and engine switching

- `status()`: `activeEngine` replaces `activeModel`; `providers` and `usage` are added (below). For a cloud active
  engine: `state` is `ready` with a readable key, else `needs_key`; `totalBytes` and `downloadedBytes` are 0.
- `availability()`: `ready` when on and the active engine is usable (local model on disk, or cloud key readable), else
  `not_ready` / `off`; it also returns the active engine `{ id, kind }`.
- Turning transcription on with a cloud engine active downloads nothing; with a readable key it queues the waiting
  recordings (as `onReady` does for a model). Saving a key for the active engine also queues them.
- `use` for a provider: needs a readable key (409 `api_key_missing`), then sets `active_engine` at once, logs
  `engine switched` with the id, publishes `model.updated`.
- Usage: one query, `sum(recordings.duration_ms)` of transcripts with `model = <provider id>` and `transcribed_at` since
  the start of this month in the time zone of the admin who asks, grouped by model. Estimated cost =
  hours x `pricePerHour.amount`, rounded to 2 decimals. Only in `GET` and route responses, not in events.

## API

All admin routes answer 401 without a session, 403 for a non-admin, 404 `unknown_provider` for an id that is not in the
registry, and return the full transcription status unless noted.

| Route | Who | Body | What |
|---|---|---|---|
| `GET /api/v1/admin/transcription` | admin | | status, now with `activeEngine`, `providers`, `usage` |
| `PUT /api/v1/admin/transcription/providers/:id/secrets` | admin | `{ apiKey }` (strict, built from the provider's fields, each a trimmed string of 1 to 512 characters) | encrypts and saves, replacing any saved key. 400 `invalid_request` otherwise |
| `DELETE /api/v1/admin/transcription/providers/:id/secrets` | admin | | removes the saved key. 409 `engine_in_use` for the active engine. No key: nothing happens |
| `POST /api/v1/admin/transcription/providers/:id/test` | admin | `{}` (saved key) or `{ apiKey }` (typed key, not saved) | `{ result: 'ok' \| 'invalid_key' \| 'unreachable' }`; 409 `api_key_missing` for `{}` with no readable key. 10 s limit |
| `POST /api/v1/admin/transcription/providers/:id/use` | admin | | makes the provider active. 409 `api_key_missing` without a readable key |
| `POST /api/v1/admin/transcription/models/:id/use` | admin | | unchanged (spec 009), now also switches away from a provider |
| `GET /api/v1/transcription` | signed-in user | | `{ state, engine: { id, kind } }` |

Shared schemas (`packages/shared/src/recordings.ts`):

```ts
export const engineKindSchema = z.enum(['local', 'cloud'])
export const failureCodeSchema = z.enum([
  'api_key_invalid', 'quota_exceeded', 'provider_unavailable', 'timeout', 'audio_rejected',
])

export const providerStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  configured: z.boolean(),                          // a readable key is saved
  keyError: z.enum(['unreadable']).nullable(),
  pricePerHour: z.object({ amount: z.number().nonnegative(), currency: z.enum(['USD', 'EUR']) }),
})

export const engineUsageSchema = z.object({
  engine: z.string(),
  audioMs: z.number().int().nonnegative(),          // this month, admin's time zone
  estimatedCost: z.number().nonnegative(),          // in the provider's currency
})

// transcriptionStateSchema gets 'needs_key'
// transcriptionStatusSchema: activeModel -> activeEngine, plus
providers: z.array(providerStatusSchema),           // registry order
usage: z.array(engineUsageSchema),                  // one per provider

// model.updated event: activeModel -> activeEngine, plus providers (no usage)
export const providerSecretsSchema = z.strictObject({ apiKey: z.string().trim().min(1).max(512) })
export const keyTestResultSchema = z.object({ result: z.enum(['ok', 'invalid_key', 'unreachable']) })
export const transcriptionAvailabilitySchema = z.object({
  state: z.enum(['off', 'not_ready', 'ready']),
  engine: z.object({ id: z.string(), kind: engineKindSchema }),
})
// recordingSchema gets
failure: failureCodeSchema.nullable(),
```

The secrets schema in the route is built from the provider's `secrets` list; `providerSecretsSchema` is the shape for
today's single field.

## Web behaviour

- `TranscriptionSettings`: the list title becomes "Átírási motor". Two groups, each a `role="group"` with a heading
  (icon + "Helyi" / "Felhő"); the cloud group hint sits under its heading. Local rows are the 009 rows with a chip icon
  before the name; cloud rows as in the table above, name with a cloud icon. Exactly one row shows "Használatban".
- Key form: one `TextField` per declared secret field (label "API-kulcs"), `type="password"`. "Mentés" sends the PUT
  and clears the field on success; a 400 shows "Add meg az API-kulcsot." under the field. Remove opens the existing
  `Dialog` (`alertdialog`) "Eltávolítod a {{name}} API-kulcsát?" / "A kulcs törlődik a szerverről. Később újra megadhatod."
  with "Eltávolítás" (danger) and "Mégse".
- Test result is a `role="status"` line for ok and a `role="alert"` for the two errors, linked to the field with
  `aria-describedby`. While the test runs the button shows "Ellenőrzés…" and is disabled.
- Recording card meta row: local transcript = chip icon + model name, hidden prefix "Modell:"; cloud = cloud icon +
  provider name, hidden prefix "Felhőszolgáltatás:"; unknown id: nothing (as 009). The name comes from the catalogue
  (`models.<id>.name` / `providers.<id>.name`).
- Failed card: the reason line replaces `transcript.failedText` / `transcript.againFailedText` for a known
  `failure` code, followed by "A felvétel megvan." (no transcript) or "A korábbi átirat megmaradt." (old transcript
  kept). "Újrapróbálás" as today.
- Desktop sidebar and record screen: the privacy note ("A hang a saját szervereden marad.", `common.privacyNote`) is
  removed, with its key in both catalogues and its unused styles. Nothing replaces it. The setup wizard's transcription
  step keeps its lead text (it describes the local choice being made there, like a setting).
- "Átírás újra" disabled hint for a cloud engine that is `not_ready`: "Nincs használható API-kulcs."

## Data model

Migration `0011_cloud_transcription` (after spec 009's `0008` to `0010`; the branch is rebased onto main once 009 is
merged):

| Table | Change |
|---|---|
| `instance_settings` | rename `active_model` to `active_engine` (values unchanged) |
| `provider_secrets` (new, instance-wide, no `user_id`, like `instance_settings`) | `provider_id text primary key`, `ciphertext text not null`, `created_at`, `updated_at` |
| `cloud_copies` (new) | `id uuid pk`, `provider_id text not null`, `user_id uuid null` (FK users, `on delete set null`), `recording_id uuid null` (FK recordings, `on delete set null`, so a deleted recording's copies are still cleaned up), `vendor_ref jsonb not null`, `created_at` |
| `recordings` | `failure text` (null, or one of the failure codes) |
| `transcripts` | `transcribed_at timestamptz not null default now()`, backfilled with `created_at`; index `(model, transcribed_at)` |

Docs to update when this is built: `architecture.md` (§3 Transcriber, §4 data model, §6, §10 outbound traffic, §12),
`product.md` (settings and entry flows), `self-hosting.md` (outbound traffic when a cloud engine is active; drop the
"marked for the release" note on the instance secret section), `backup.md` (same).

## Acceptance criteria

Registry
- **AC-1** Given the registry, then Soniox and Gladia declare exactly the values in "The two providers" (label, secret field `apiKey`, max length, formats, languages, price); engine ids are unique across local models and providers; every provider supports `hu` and `en`; every stored format (`webm`, `ogg`, `m4a`, `aac`, `mp3`, `wav`, `flac`) is either accepted or has a stream-copy target the provider accepts; both catalogues have `providers.<id>.name` equal to the label and a `description`.

Settings
- **AC-2** Given transcription on, when the admin opens Settings, then "Átírási motor" shows group "Helyi" (chip icon) with the local models and group "Felhő" (cloud icon, hint line) with Soniox and Gladia, each with name, description with price ("Kb. 0,10 USD óránként", "Kb. 0,27 EUR óránként") and key state, and exactly one row shows "Használatban".
- **AC-3** Given a provider with no key, then its row shows "Nincs API-kulcs" and "API-kulcs megadása" and no "Váltás erre", and the use route answers 409 `api_key_missing`.
- **AC-4** Given the key form, when the admin types a key and presses "Mentés", then the row shows "Kulcs mentve" with 8 dots, "Csere" and "Eltávolítás", the field is empty; `provider_secrets` holds a `v1.` value that does not contain the key and decrypts to it; neither the route response, `GET` status nor the `model.updated` event contains the key.
- **AC-5** Given a saved key, when the admin presses "Csere", saves a new key, then the new one is stored (decrypts to it); "Mégse" instead keeps the old one and sends nothing.
- **AC-6** Given a saved key of a provider that is not active, when the admin presses "Eltávolítás", then the dialog "Eltávolítod a {{name}} API-kulcsát?" opens; confirming removes the row and the provider shows "Nincs API-kulcs"; "Mégse" changes nothing. The active provider has no "Eltávolítás" and the delete route answers 409 `engine_in_use`.
- **AC-7** Given the form with a typed key, when the admin presses "Kulcs ellenőrzése", then the fixture's check endpoint is called with that key and no upload happens, nothing is saved, and the line shows "A kulcs működik." (200), "A szolgáltató nem fogadta el a kulcsot." (401/403) or "Nem sikerült elérni a szolgáltatót. Próbáld újra később." (5xx, connection refused, over 10 s); given a saved key, the test with `{}` uses it; with no key `{}` answers 409 `api_key_missing`.
- **AC-8** Given Soniox with a key, when the admin presses "Váltás erre", then it is active at once ("Használatban"), the local model files stay on disk, the switch hint reads "A felvételek szöveggé alakítása felhőszolgáltatással (Soniox)." and the ready line "Az új felvételeket a felhőben írjuk át (Soniox)."; turning transcription off and on again with Soniox active downloads nothing.
- **AC-9** Given an open Settings page in a second tab, when a key is saved or removed or the engine is switched, then the list updates without a reload (`model.updated` carries `activeEngine` and `providers`).
- **AC-10** Given Soniox transcripts this month by 2 recordings (1 h 30 min + 1 h 42 min), one Soniox transcript from last month, one edited this month but transcribed last month, and Turbo transcripts, then the Soniox row shows "Ebben a hónapban: 3,2 óra · kb. 0,32 USD (becslés)" (`en`: "This month: 3.2 h · about $0.32 (estimate)") and Gladia with a saved key and no use shows "Ebben a hónapban: 0 óra · kb. 0,00 EUR (becslés)", a provider with no key and no use shows no usage line; the month starts in the admin's time zone.

Key at rest
- **AC-11** Given `secrets.ts`, then a round trip returns the input, two encryptions of the same value differ, and decryption fails for a changed ciphertext, tag or IV, for another provider id, and under another key file.
- **AC-12** Given no `NIGHTJAR_SECRET_KEY` and a data folder without `secret.key`, when the server starts, then it creates the file (64 hex characters, mode `0600` on POSIX) and a second start reuses it; given `NIGHTJAR_SECRET_KEY` set to 64 hex characters, then that value is used and no file is read or created; an env value or a file of any other form stops the start with a log line that names the source and holds no key characters.
- **AC-13** Given a saved key and a changed instance secret (replaced file, or an env value different from the file), when the server starts, then the provider shows `keyError: 'unreadable'` and the row alert "A mentett kulcs nem olvasható. Add meg újra."; with that provider active the state is `needs_key`, new recordings stay `pending`, and saving a key queues them.

Job with a cloud engine
- **AC-14** Given Soniox active and a Hungarian webm recording, when it is saved, then it goes `pending` → `transcribing` → `done` without a reload; the fixture received the original bytes unchanged as `audio.webm`, a create with `model: 'stt-async-v6'` and `language_hints: ['hu']`; the transcript holds the fixture text, `model = 'soniox'`, language `hu`, and the card shows cloud icon + "Soniox".
- **AC-15** Given Gladia active, then a webm/opus recording reaches the fixture as ogg (starts with `OggS`, codec opus, duration within 0.1 s of the original, so no re-encode) and an m4a recording as it is; the create body has `model: 'solaria-1'` and `language_config.languages: ['en']` for an English recording.
- **AC-16** Given a recording with language `auto`, then Soniox gets `language_hints: ['hu', 'en']` with `enable_language_identification: true` and the transcript stores the language with the most token characters; Gladia gets `languages: ['hu', 'en']` and stores `languages[0]`; a detected `de` is stored as `en`.
- **AC-17** Given a test provider with `maxAudioMs` 60 s and a 150 s opus fixture with pauses at known times, then it is cut into 3 parts, each under 60 s, every cut inside a pause, with the codec unchanged; the fixture gets the parts in order, the transcript is their texts joined by one space, and every part's copy is deleted. A recording under the max is sent as one part.
- **AC-18** Given a done or a failed attempt, then the fixture received the deletes for every copy (Soniox transcription and file, Gladia job) and `cloud_copies` is empty.
- **AC-19** Given the fixture fails the first 2 deletes, then the recording is still `done`, a `cloud-cleanup` job deletes the copy on retry and the row is gone; the warn lines carry only the provider id and a reason. When every retry fails, "provider cleanup gave up" is logged and the row stays for the next run.
- **AC-20** Given a `cloud_copies` row left by a stopped server, when the server starts, then the copy is deleted at the fixture and the row removed; given a recording still `transcribing` with leftover rows, its next attempt deletes them before it uploads.
- **AC-21** Given Soniox switched to while a Turbo job runs, then that job finishes with Turbo (`model` turbo) and the next job uses Soniox and disposes the Turbo transcriber first; given a running Soniox job when the admin switches to Turbo, then it finishes with Soniox.

Failures
- **AC-22** Given the fixture answers 401 (or 403), then the recording is `failed` with `failure = 'api_key_invalid'` after one attempt (no retries), no local transcriber is created, and the card shows "Az átírás nem sikerült." with "A felhőszolgáltató nem fogadta el az API-kulcsot. A rendszergazda a Beállításokban cserélheti." and "Újrapróbálás".
- **AC-23** Given the fixture answers 402, then `quota_exceeded` after one attempt with "Elfogyott a keret a felhőszolgáltatónál."; given the vendor job ends in its error state, then `audio_rejected` after one attempt with "A felhőszolgáltató nem tudta feldolgozni ezt a felvételt."
- **AC-24** Given the fixture answers 503 or refuses connections, then the job is retried twice, then `provider_unavailable` ("A felhőszolgáltató most nem érhető el. Próbáld újra később."); given polls that never finish, then each attempt ends at the part deadline and the recording ends `timeout` ("A felhőszolgáltató túl sokáig dolgozott rajta."). Every attempt deletes its copies.
- **AC-25** Given a failed cloud recording, when the user presses "Újrapróbálás" (or "Átírás újra" on one with an old transcript), then `failure` is cleared with `pending` and a success shows the new text; a transcribe-again that fails keeps the old transcript and shows the reason line with "A korábbi átirat megmaradt."
- **AC-26** Given any recording queued, then its job's `expireInSeconds` is `max(1800, 5 x audio seconds)`.

Hints and labels
- **AC-27** Given transcripts by Turbo, Soniox and an unknown id, then the meta row shows chip icon + "Turbo" (accessible "Modell: Turbo"), cloud icon + "Soniox" (accessible "Felhőszolgáltatás: Soniox") and nothing for the unknown id.
- **AC-28** Given any engine (local, or Soniox active) and transcription on or off, when a user opens the recorder, Home, an entry or the upload screen at 390 and 1280, then no "where is it transcribed" note shows (no "A hang a saját szervereden marad.", no cloud note), and `common.privacyNote` exists in neither catalogue; `GET /api/v1/transcription` returns `engine: { id: 'soniox', kind: 'cloud' }` to a non-admin.
- **AC-29** Given Soniox active with an unreadable key, then "Átírás újra" is disabled with "Nincs használható API-kulcs." and the route answers 409 `model_not_ready`.

Access, privacy, accessibility, upgrade
- **AC-30** Given a non-admin, then the provider routes answer 403 and Settings shows no engine list; an unknown provider id answers 404 `unknown_provider`; a secrets body with an extra field, an empty or blank key or one over 512 characters answers 400 and saves nothing.
- **AC-31** Given this spec's flows (save, test, replace a key; a Soniox job, a Gladia job with a split, failing jobs, a failing delete) run with a marker (like `ZQX-PRIVATE-7781`) as the API key, in the fixture's transcript text and in the uploaded file name, then the marker appears nowhere in the captured logs or in any route response except the transcript itself, no log line or error message carries a vendor response body, and no text column of the database holds the key in plain text.
- **AC-32** Given the engine list (local in use + cloud with key + cloud without; cloud in use with usage), the key form (empty, test ok, invalid key, unreachable, unreadable key), the remove dialog, cards with cloud and local labels and the failed cloud cards, then axe reports no violations and the layout checks pass (no sideways scroll, nothing clipped or overlapping) at 390 and 1280, light and dark.
- **AC-33** Given a database at migration `0010` (spec 009) with `active_model = 'whisper-large-v3-int8'`, a transcript and transcription on, when the new version starts without `NIGHTJAR_SECRET_KEY`, then `active_engine` is large-v3, the transcript's `transcribed_at` equals its `created_at`, both providers show "Nincs API-kulcs", `secret.key` is created, and nothing is downloaded or sent anywhere.

## Test plan

Fakes: `apps/server/test/support/cloud-server.ts`, one local HTTP server that speaks the Soniox and Gladia paths above
under `/soniox/v1` and `/gladia/v2`. It keeps uploads in memory, records every request (method, path, which auth header
was present, body size, first bytes, JSON body without the key), and has switches: `rejectKey`, `status` per step
(`upload`, `start`, `poll`, `delete`, `check`), `refuse` (closes connections), `pollsUntilDone` (or never), `failDeletes`
(count), `jobError`, `text` per part, `tokens` with languages. Tests build providers with `baseUrl` pointing at it and
pass them to `start()` (API) and to `e2e-server.ts` (e2e). No test calls a real vendor. Audio fixtures: the existing HU
and EN WAVs, a short webm/opus and m4a made from them, and `pauses-150s.ogg` (generated once by a script in
`e2e/fixtures/`: speech-like tone blocks with silences at known times). API tests need `ffmpeg` (as spec 003). A
`secret.key` per test data folder. Test files: `010-cloud-transcription.*`.

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | registry values, unique ids, format coverage, catalogue names | | | | |
| AC-2 | price format (`0,10 USD` / `$0.10`) | two groups, icons, one in use | status has `activeEngine`, `providers` | Settings shows both groups | |
| AC-3 | | no-key row | 409 `api_key_missing` | | |
| AC-4 | | save clears field, masked row | ciphertext shape, no key in responses / event | enter key → "Kulcs mentve" | read the row with SQL |
| AC-5 | | replace and cancel (no request on cancel) | replace decrypts to new | | |
| AC-6 | | dialog confirm / cancel | delete, 409 `engine_in_use` | | |
| AC-7 | status mapping for check | three result lines, clears on edit | typed vs saved key, no upload, 409 | test key → "A kulcs működik." | fixture `check` status, `refuse`, slow 11 s with fake timers in unit |
| AC-8 | | cloud hint + ready line | use → active, no model download, files kept | switch to Soniox | |
| AC-9 | | live update from `model.updated` | event carries `activeEngine`, `providers` | second page sees the switch | |
| AC-10 | hours + cost math, month start per time zone | usage line both languages | seeded transcripts → usage | | fixed clock, admin in `Europe/Budapest` |
| AC-11 | encrypt / decrypt / tamper / AAD / other key | | | | |
| AC-12 | `config.ts` accepts 64 hex, rejects other env values without echoing them | | start creates and reuses file, env wins and no file appears, bad file / env stops start | | temp data folder |
| AC-13 | | unreadable alert | replaced file and different env value → `unreadable`, `needs_key`, pending waits, save queues | | |
| AC-14 | | cloud label | status sequence, bytes equal, create body, transcript row | record HU (fake mic) with Soniox → cloud icon + "Soniox" | |
| AC-15 | `copyTargets` choice | | ogg magic + codec + duration via ffprobe, m4a as is | | |
| AC-16 | language pick from tokens, `de` → `en` | | request bodies for auto, stored language | | |
| AC-17 | cut-point choice from silence list | | 3 parts, cuts in pauses, codec copy, join order, all deleted | | test provider with `maxAudioMs: 60_000` |
| AC-18 | | | delete calls after done and after failed, table empty | | |
| AC-19 | | | `failDeletes: 2` → cleanup job deletes; all fail → gave up, row kept | | retry delay 0 |
| AC-20 | | | seeded row → start → deleted; leftover for transcribing recording deleted first | | restart on same data folder |
| AC-21 | | | hold job, switch both ways, models of the two transcripts | | fake local transcriber counts |
| AC-22 | | failed card text | 401 → one attempt, `failure`, no local transcriber | 401 → failed card with reason | |
| AC-23 | | reason texts | 402, `jobError` → one attempt each | | |
| AC-24 | | | 503 / `refuse` → 3 attempts; never-done polls → `timeout` | | poll interval and deadline injectable |
| AC-25 | | reason + kept-transcript line | retry and retranscribe clear `failure` | | |
| AC-26 | expiry formula | | | | |
| AC-27 | | three labels, accessible names | | | |
| AC-28 | catalogue has no `common.privacyNote` | recorder and shell render no note | availability for non-admin | no note on recorder, Home, entry, upload with Soniox active | |
| AC-29 | | disabled hint | 409 `model_not_ready` | | |
| AC-30 | | list hidden for non-admin | 403, 404, 400 cases | | |
| AC-31 | | | marker through the flows; logs, responses, DB text columns | | `log-capture.ts` |
| AC-32 | | | | axe + `expectLayout` on each state | `emulateMedia({ colorScheme })` |
| AC-33 | | | real migrations to `0010`, seed, migrate, start | | also `scripts/upgrade-test.ts`: `activeEngine` after upgrade |

Also covered: both catalogues (spec 006 AC-5), the spec 003 and 009 tests keep passing with `activeEngine`.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `providers.soniox.name` / `.description` | Soniox / Pontos magyar átírás. Kb. {{price}} óránként. | Soniox / Accurate Hungarian transcripts. About {{price}} per hour. |
| `providers.gladia.name` / `.description` | Gladia / Francia szolgáltató. Kb. {{price}} óránként. | Gladia / French provider. About {{price}} per hour. |
| `settings.engines.title` | Átírási motor | Transcription engine |
| `settings.engines.local` / `.cloud` | Helyi / Felhő | Local / Cloud |
| `settings.engines.cloudHint` | A hangot átírásra elküldjük a szolgáltatónak, utána töröljük nála. | Audio is sent to the provider to be transcribed, then deleted there. |
| `settings.engines.noKey` / `.keySaved` | Nincs API-kulcs / Kulcs mentve | No API key / Key saved |
| `settings.engines.addKey` | API-kulcs megadása | Add API key |
| `settings.engines.apiKey` | API-kulcs | API key |
| `settings.engines.save` / `.replace` / `.remove` | Mentés / Csere / Eltávolítás | Save / Replace / Remove |
| `settings.engines.test` / `.testing` | Kulcs ellenőrzése / Ellenőrzés… | Check key / Checking… |
| `settings.engines.testOk` | A kulcs működik. | The key works. |
| `settings.engines.testInvalid` | A szolgáltató nem fogadta el a kulcsot. | The provider didn't accept the key. |
| `settings.engines.testUnreachable` | Nem sikerült elérni a szolgáltatót. Próbáld újra később. | Couldn't reach the provider. Try again later. |
| `settings.engines.keyRequired` | Add meg az API-kulcsot. | Enter the API key. |
| `settings.engines.keyUnreadable` | A mentett kulcs nem olvasható. Add meg újra. | The saved key can't be read. Enter it again. |
| `settings.engines.removeTitle` / `.removeText` | Eltávolítod a {{name}} API-kulcsát? / A kulcs törlődik a szerverről. Később újra megadhatod. | Remove the {{name}} API key? / The key is deleted from the server. You can add it again later. |
| `settings.engines.usage` | Ebben a hónapban: {{hours}} óra · kb. {{cost}} (becslés) | This month: {{hours}} h · about {{cost}} (estimate) |
| `settings.transcriptionHintCloud` | A felvételek szöveggé alakítása felhőszolgáltatással ({{engine}}). | Recordings are turned into text by a cloud service ({{engine}}). |
| `settings.engines.cloudReady` | Az új felvételeket a felhőben írjuk át ({{engine}}). | New recordings are transcribed in the cloud ({{engine}}). |
| `settings.engines.needsKey` | Add meg újra az API-kulcsot. Addig az új felvételek várnak. | Enter the API key again. New recordings wait until then. |
| `transcript.cloudPrefix` (visually hidden) | Felhőszolgáltatás: | Cloud service: |
| `transcript.audioKept` / `.oldKept` | A felvétel megvan. / A korábbi átirat megmaradt. | The recording is safe. / The earlier transcript is still here. |
| `failure.api_key_invalid` | A felhőszolgáltató nem fogadta el az API-kulcsot. A rendszergazda a Beállításokban cserélheti. | The cloud service didn't accept the API key. An admin can replace it in Settings. |
| `failure.quota_exceeded` | Elfogyott a keret a felhőszolgáltatónál. | The cloud service account is out of credit. |
| `failure.provider_unavailable` | A felhőszolgáltató most nem érhető el. Próbáld újra később. | The cloud service can't be reached right now. Try again later. |
| `failure.timeout` | A felhőszolgáltató túl sokáig dolgozott rajta. | The cloud service took too long. |
| `failure.audio_rejected` | A felhőszolgáltató nem tudta feldolgozni ezt a felvételt. | The cloud service couldn't process this recording. |
| `recording.againNoKey` | Nincs használható API-kulcs. | There's no usable API key. |
| `error.api_key_missing` | Előbb add meg az API-kulcsot. | Add the API key first. |
| `error.engine_in_use` | A használatban lévő motor kulcsát nem lehet eltávolítani. Előbb válts másikra. | The key of the engine in use can't be removed. Switch to another one first. |

`settings.models.title` ("Átírási modell") is replaced by `settings.engines.title`. Removed: `common.privacyNote`
("A hang a saját szervereden marad." / "Your voice stays on your own server."). Reused: `settings.models.inUse`,
`settings.models.use`, `common.cancel`, `common.retry`, `transcript.failed`, `transcript.againFailed`,
`transcript.modelPrefix`.

## Privacy & data
- Stored: the encrypted provider key in `provider_secrets`; the key file `secret.key` in the data folder (unless
  `NIGHTJAR_SECRET_KEY` is set); vendor ids of
  copies not yet deleted in `cloud_copies`; the engine id and `transcribed_at` on each transcript; a failure code on
  failed recordings.
- Leaves the server, only while a cloud engine is active: the recording's audio (as stored, remuxed or cut, never
  re-encoded) and the language hint go to that provider; the transcript comes back. Nothing else: no entry text, no
  user name, no file name (fixed `audio.<ext>`). "Kulcs ellenőrzése" sends only the key. Switching to a cloud engine is
  an admin action in Settings, where the Felhő group says audio is sent out; each transcript's label shows the cloud
  icon and the provider name.
- Deleted at the vendor after every attempt (audio and transcript), with retries. Left behind only when Gladia's
  `start` fails after an upload (no delete API for that file; Gladia's retention applies) or a delete keeps failing (the
  row stays and is retried on every cleanup run). Soniox deletes by itself after 30 days.
- Logs: engine switches, key saved / removed / tested (result only), provider calls that failed and cleanup lines
  carry the provider id and a reason code (failure code, HTTP status or `network`). Never the key, transcript text,
  vendor response bodies, file names or vendor ids.
- The Soniox account is US region (owner's account); accepted for now.

## Open questions
None blocking. Decided on 11-28: the instance secret comes from `NIGHTJAR_SECRET_KEY` or a generated key file (D-59;
Better Auth's `auth_secret` lives in the same database as the encrypted keys, so it doesn't fit), and privacy notes stay
in Settings (D-60).
1. Gladia's training opt-out is an account setting, not an API flag (research). The settings hint can't enforce it;
   the owner should switch it off in the Gladia profile.
