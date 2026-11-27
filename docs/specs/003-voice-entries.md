# 003 Voice entries

Status: done
Milestone: M1

## Why
Speaking is the main way to journal: one tap to record (or upload a phone voice memo), and the owner's own server
turns it into text in the background, if the admin turned transcription on.

## Scope
In (screen names from `design/alkony/m1.html`):
- **Recorder** (`recorder`): from the Home record button, the desktop sidebar button, or "Újabb felvétel" on an entry.
  Timer, level meter, pause / resume, stop, discard (with a confirm dialog), screen wake lock, privacy note. Uses the user's default entry language.
- **Upload** (`upload`, `uploadready`, `uploadprog`): from Home "Hangfájl feltöltése" (new entry) or from an entry (adds to it).
  Pick or drop a file, language (Magyar / English / Automatikus), date (new entry only), progress, cancel.
- **Limits**: a recording can be up to 60 minutes. The recorder stops by itself at 60 minutes and says so, an upload that is longer is refused with 413 `recording_too_long`.
- **Storage**: the original file is kept as is under the user's folder, type checked by content, duration measured on the server.
- **Transcription** (pg-boss queue `transcribe`): ffmpeg makes a temp 16 kHz mono WAV, the `Transcriber` turns it into text,
  the temp WAV is deleted, an SSE event goes out. One job at a time; the model is loaded only while jobs run (D-21).
  Default model Whisper large-v3-turbo int8 via sherpa-onnx (D-20), from the model list in the repo.
- **Entry page recording cards** (`entry`, `entryedit`, `entryfail`, `entryoff`): player, "Átírás folyamatban…",
  transcript with language and time, "Átirat szerkesztése", failed state with "Újrapróbálás", "Nincs átírva" when off.
- **Transcription off / on** (D-23), admin section of Settings (`settings`, `settingsdl`, `settingsready`): off by default,
  turning it on downloads the model to `/data/models` with live progress (or uses it as is if already there),
  then offers to transcribe recordings that were never transcribed.
- API: `POST /api/v1/recordings` (multipart: `file`, `language`, and `entryId` or `entryDate`),
  `GET /api/v1/recordings/:id/audio` (Range), `PATCH /api/v1/recordings/:id/transcript`, `POST /api/v1/recordings/:id/retry`,
  `GET /api/v1/events` (SSE), `GET|PUT /api/v1/admin/transcription`, `POST /api/v1/admin/transcription/backlog`.
  Tables `recordings`, `transcripts`, `instance_settings` (architecture.md, "M1 data model").

Out (not now): streaming transcription while speaking, choosing a model in the UI, re-transcribing a finished recording,
deleting a single recording, offline recording queue (M4), word highlighting during playback.

## Acceptance criteria

Recorder
- **AC-1** Given Home, when the user presses the record button, then the recorder opens, recording starts, the timer counts up from 00:00 and the level meter moves with the microphone input.
- **AC-2** Given a recording in progress, when the user pauses, then the timer stops and the state shows paused; after resume it continues, and the saved recording's `duration_ms` matches the time spent recording (paused time not included) within 0.5 s.
- **AC-3** Given a recording started from Home, when the user presses "Leállítás", then the audio is uploaded, a new entry for today (user's time zone) is created and its entry page opens with the recording card; a recording started from "Újabb felvétel" is added to that entry instead.
- **AC-4** Given a recording in progress, when the user presses "Elvetés", then a dialog "Elveted a felvételt?" opens and the recording keeps running; "Elvetés" in the dialog uploads nothing and opens the previous screen, "Felvétel folytatása" closes the dialog and the recording goes on.
- **AC-5** Given the microphone is blocked or missing, when the recorder opens, then it shows a message on how to allow the microphone and a way back, and nothing is recorded.
- **AC-6** Given the upload after "Leállítás" fails (network error or 5xx), then the recorder shows an error with "Újrapróbálás", keeps the audio in memory, and a retry uploads it.
- **AC-7** Given a recording in progress, then a screen wake lock is held, and it is released on stop or discard.

Upload
- **AC-8** Given the upload screen, when the user picks or drops an audio file, then its name, size and duration show, the language defaults to the user's default entry language, and the date defaults to the file's last-modified date; "Feltöltés" uploads with a progress bar, and "Mégse" during the upload aborts it and nothing is saved.
- **AC-9** Given a file, then the server accepts it only if its content is webm, ogg/opus, mp4/m4a/aac, mp3, wav or flac (magic bytes, not file name or `Content-Type`); anything else gets 415 `unsupported_audio`, and a file over 200 MB gets 413 `file_too_large`; in both cases no row and no partial file remain.
- **AC-10** Given an accepted file, then the original bytes are stored unchanged at `/data/media/<user_id>/recordings/<recording_id>.<ext>`, `duration_ms` is measured on the server, and the client's file name is stored nowhere.

Transcription
- **AC-11** Given transcription on and the model ready, when a recording is saved, then it goes `pending` → `transcribing` → `done`, the transcript is stored with the model id and detected language, and the temp WAV is deleted.
- **AC-12** Given the entry page or the timeline is open, when a recording's status changes, then the card and badge update without a reload (SSE), and the transcript text appears when it is done; this works for a Hungarian and an English recording made through the fake microphone.
- **AC-13** Given 3 recordings queued, then at most one transcription runs at any moment and they finish in the order they were queued.
- **AC-14** Given the queue was empty, when a job starts, then one transcriber (model) is created, and once no job is left it is disposed; with an empty queue no model is in memory.
- **AC-15** Given a recording with language `hu` or `en`, then that language is passed to the transcriber; with `auto`, the detected language is stored on the transcript; the card shows "Magyar" or "English".
- **AC-16** Given the transcriber fails, then the job is retried 2 more times, then the status is `failed` and the card shows "Az átírás nem sikerült." with "Újrapróbálás"; retry sets it back to `pending` and a success shows the transcript; the audio stays playable the whole time.
- **AC-17** Given a done transcript, when the user presses "Átirat szerkesztése", edits and presses "Mentés", then the text is saved with `is_user_edited = true` and search finds the new words; "Mégse" restores the old text.
- **AC-18** Given a transcript with `is_user_edited = true`, when a transcribe job for that recording runs again (for example a duplicate delivery), then the user's text is unchanged.
- **AC-19** Given a recording, when the player plays it, then `GET /api/v1/recordings/:id/audio` returns the original bytes with the stored `Content-Type` and supports Range requests (206), and the player shows position / duration.

Transcription off / on
- **AC-20** Given transcription off (the default), when a recording is saved, then no job is queued, the status is `skipped`, the card shows "Nincs átírva" with the hint to Settings, and the timeline badge says "Nincs átírva".
- **AC-21** Given the admin turns transcription on and the model is not on disk, then the model downloads to a temp file in `/data/models`, Settings shows live progress ("Modell letöltése…", MB / MB, %), the file is moved into place only if its sha256 matches the model list, and Settings then shows "A modell letöltve, az új felvételeket átírjuk."
- **AC-22** Given the model files are already in `/data/models` with the expected size, when the admin turns transcription on, then nothing is downloaded and it is ready at once.
- **AC-23** Given the download fails (network error or checksum mismatch), then the partial file is removed and Settings shows an error with "Újrapróbálás"; recordings saved meanwhile stay `pending` and are transcribed once the model is ready; after a server restart with transcription on and no model, the download starts again.
- **AC-24** Given the model is ready and N recordings are `skipped`, then Settings asks "N felvételt még nem írtunk át. Átírjuk most?"; "Átírás most" sets all of them to `pending` and they are transcribed one at a time; "Most nem" hides the question until the admin opens Settings again.
- **AC-25** Given transcription on with queued recordings, when the admin turns it off, then queued (not running) jobs are cancelled and those recordings become `skipped`, the running job finishes, the model files stay on disk, and new recordings are `skipped`.
- **AC-26** Given a user who is not an admin, then the transcription endpoints answer 403 and Settings does not show the admin section.

Isolation, accessibility, real model
- **AC-27** Given user A's recording and entry, when user B fetches the audio, edits the transcript, retries, or uploads into A's entry, then B gets 404 and nothing changes; B's SSE stream never receives A's events.
- **AC-28** Given the recorder (and its discard dialog), upload (3 states), entry cards (done, transcribing, editing, failed, off) and the Settings admin states (off, downloading, ready + question), then axe reports no violations on mobile and desktop, light and dark.
- **AC-29** Given the real default model (nightly only), when `hu-sample.wav` and `en-sample.wav` are transcribed, then the word error rate against the fixture text is under 30% for each.
- **AC-30** Given a few API requests and one finished fake transcription job, then `/metrics` on the metrics port returns `nightjar_job_duration_seconds` (labels `queue`, `outcome`), `nightjar_transcription_rtf` (label `model`) and `nightjar_queue_depth` (label `queue`), their counts went up, and no label holds a user id, file name or text.
- **AC-31** Given the flows of this spec (upload with a marker file name, fake transcript with a marker, transcript edit, failing job) run in a test with marker text (like `ZQX-PRIVATE-7781`) in every field and file name, then the marker appears nowhere in the captured log output (helper `apps/server/test/support/log-capture.ts`, spec 007).

## Test plan

Fakes: `NIGHTJAR_TRANSCRIBER=fake` returns fixed text per language (`hu` / `en`), counts live instances and the
highest number of parallel calls, and can be told to fail. It also swaps the model list for a test list that points at a
small fixture HTTP server started by the test (no internet). API tests need `ffmpeg` on the PATH (the CI image has it).

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | | | fake mic → timer moves, meter bars change | `fakeMic('hu-sample.wav')`, Chromium only |
| AC-2 | | timer with fake timers | `duration_ms` from server | pause 2 s, resume, stop → duration check | tolerance 0.5 s |
| AC-3 | | | | stop → entry page with card; "Újabb felvétel" adds a 2nd card | |
| AC-4 | | dialog opens, keep → recording goes on | | discard → dialog → confirm → no request to `/recordings`; discard → keep → still recording | Playwright request listener |
| AC-5 | | `getUserMedia` rejects `NotAllowedError` / `NotFoundError` → message | | | |
| AC-6 | | upload mocked to fail → retry succeeds with same blob | | | |
| AC-7 | | `navigator.wakeLock` mock: request on start, release on stop / discard | | | |
| AC-8 | | file picked → name, size, duration, defaults; cancel aborts | | upload `en-sample.wav` → entry with card | progress via `XMLHttpRequest` upload events |
| AC-9 | magic-byte sniffer per format | | 415 for `.jpg` renamed `.m4a`, 413 for 201 MB, no leftovers | | fixtures: one tiny file per format |
| AC-10 | path builder | | bytes equal, path shape, no file name in DB | | |
| AC-11 | | | status sequence, transcript row, temp dir empty | | fake transcriber |
| AC-12 | | | SSE event order for one recording | HU and EN fake mic → "Átírás folyamatban…" → fixture text | `fake-mic.hu.spec.ts`, `fake-mic.en.spec.ts`; the HU test sets the default entry language to `hu` first (the default is `en`) |
| AC-13 | | | 3 jobs → max parallel = 1, finish order | | fake reports max concurrency |
| AC-14 | | | live instances 0 → 1 → 0 | | |
| AC-15 | | card language label | language passed through, `auto` stores detected | | fake returns the language it got, `hu` for `auto` (so "detected" differs from the `en` default) |
| AC-16 | | failed card + retry | 3 attempts then `failed`, retry → `done` | failed card → retry → transcript | fake set to fail N times |
| AC-17 | | edit / save / cancel | `is_user_edited`, search hit on new word | edit transcript → reload shows it | |
| AC-18 | | | job re-run leaves edited text | | |
| AC-19 | | | 200 full, 206 with `Range: bytes=0-99`, content type | player plays (`currentTime` advances) | |
| AC-20 | | off card | no job, `skipped` | record with transcription off → "Nincs átírva" | default instance state |
| AC-21 | | progress bar values from SSE | download → checksum → ready, events | turn on → progress → ready line | fixture server streams a 5 MB file slowly |
| AC-22 | | | no HTTP request to fixture server | | pre-seeded `/data/models` |
| AC-23 | | error + retry button | bad checksum → file gone; pending waits; restart resumes | | fixture server can drop the connection |
| AC-24 | | question with count, both buttons | backlog endpoint → all `pending` → `done` one by one | | 3 skipped recordings seeded |
| AC-25 | | | cancel queued, running finishes, files kept | | fake transcriber with a hold |
| AC-26 | | admin section hidden | 403 for non-admin | | |
| AC-27 | | | 404 on audio, transcript, retry, upload into A's entry; SSE isolation | | two users, two SSE clients |
| AC-28 | | | | axe on each state | `emulateMedia({ colorScheme })` |
| AC-29 | WER helper | | | | nightly, real model in `/data/models`, skipped unless `NIGHTJAR_TRANSCRIBER=sherpa` |
| AC-30 | | | parse `/metrics` after a finished job; labels checked against a pattern | | fake transcriber reports a duration so the RTF is known |
| AC-31 | | | marker through this spec's flows, assert absent from captured logs | | helper from spec 007 |

Also covered: both languages, mobile + desktop, screenshots of every listed screen state.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `home.record` | Felvétel indítása | Start recording |
| `home.upload` / `entry.uploadAnother` | Hangfájl feltöltése | Upload an audio file |
| `nav.newRecording` | Új felvétel | New recording |
| `recorder.recording` / `.paused` | Felvétel folyamatban / Szünetel | Recording / Paused |
| `recorder.calm` | Beszélj nyugodtan, nem sietünk. | Take your time, there's no rush. |
| `recorder.discard` / `.stop` / `.pause` / `.resume` | Elvetés / Leállítás / Szünet / Folytatás | Discard / Stop / Pause / Resume |
| `recorder.discardConfirm.title` / `.text` / `.keep` | Elveted a felvételt? / A hang nem lesz elmentve. / Felvétel folytatása | Discard the recording? / The audio won't be saved. / Keep recording |
| `recorder.elapsed` | Eltelt idő | Elapsed time |
| `recorder.micBlocked` | A mikrofon nem érhető el. Engedélyezd a böngésző beállításaiban, és próbáld újra. | The microphone isn't available. Allow it in your browser settings and try again. |
| `recorder.uploadFailed` | A felvételt nem sikerült elmenteni. A hang még megvan, próbáld újra. | Couldn't save the recording. The audio is still here, try again. |
| `upload.title` / `.lead` | Hangfájl feltöltése / Például egy telefonos hangjegyzet. Új bejegyzés lesz belőle. | Upload an audio file / A voice memo from your phone, for example. It becomes a new entry. |
| `upload.drop` / `.choose` / `.replace` | Húzd ide a fájlt, vagy válaszd ki az eszközödről. / Fájl kiválasztása / Csere | Drop the file here, or choose it from your device. / Choose file / Replace |
| `upload.language` / `.whichDay` / `.submit` / `.progress` | Nyelv / Melyik napról szól? / Feltöltés / Feltöltés: {{pct}}% | Language / Which day is it about? / Upload / Uploading: {{pct}}% |
| `lang.hu` / `lang.en` / `lang.auto` | Magyar / English / Automatikus | Magyar / English / Automatic |
| `entry.recordings` / `entry.recordAnother` | Hangfelvételek / Újabb felvétel | Recordings / Record another |
| `player.play` / `.pause` | Lejátszás / Szünet | Play / Pause |
| `transcript.working` | Átírás folyamatban… | Transcribing… |
| `transcript.edit` / `.save` / `.editNote` | Átirat szerkesztése / Mentés / A módosításaidat az átírás később sem írja felül. | Edit transcript / Save / Your edits are never overwritten by transcription. |
| `transcript.failed` / `.failedText` | Az átírás nem sikerült. / A felvétel megvan, a szöveg hiányzik. Próbáld újra. | Transcription failed. / The recording is safe, the text is missing. Try again. |
| `transcript.off` / `.offText` | Nincs átírva. / Az átírás ki van kapcsolva, ezért ehhez a felvételhez csak hang tartozik. Bekapcsolni a Beállításokban tudod. | Not transcribed. / Transcription is off, so this recording has audio only. You can turn it on in Settings. |
| `settings.admin` | Rendszergazda | Admin |
| `settings.transcription` / `.transcriptionHint` | Átírás / A felvételek szöveggé alakítása a saját szervereden. Egyszeri, kb. {{size}} letöltés kell hozzá. | Transcription / Turns recordings into text on your own server. Needs a one-time download of about {{size}}. |
| `settings.model.downloading` / `.progress` | Modell letöltése… / {{done}} / {{total}} · {{pct}}% | Downloading model… / {{done}} / {{total}} · {{pct}}% |
| `settings.model.ready` | A modell letöltve, az új felvételeket átírjuk. | Model downloaded. New recordings will be transcribed. |
| `settings.model.failed` | A modell letöltése nem sikerült. | The model download failed. |
| `settings.backlog.question` / `.now` / `.later` | {{count}} felvételt még nem írtunk át. Átírjuk most? / Átírás most / Most nem | {{count}} recordings were never transcribed. Transcribe them now? / Transcribe now / Not now |
| `error.unsupported_audio` / `.file_too_large` | Ezt a fájlt nem tudjuk hangként kezelni. / A fájl túl nagy (legfeljebb 200 MB). | This file isn't a supported audio format. / The file is too large (200 MB max). |

## Privacy & data
- Stored: original audio under `/data/media/<user_id>/`, `recordings` and `transcripts` rows, the model under `/data/models`.
- The temp WAV is deleted after each job. The uploaded file name is never stored or logged; transcripts are never logged (spec 007).
- Outbound traffic: only the model download, only after the admin turns transcription on. Audio never leaves the server.

## Open questions
None. The recorder uses the default recording language (D-30 Q4).
