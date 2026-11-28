# 009 Transcription model choice + transcribe again

Status: done
Milestone: 0.2.1

## Why
Whisper large-v3 is clearly more accurate on the owner's Hungarian clips (about 18% WER vs 26% for turbo), but much
slower (RTF about 2.7 vs 0.4 on a 4-core box) and needs more RAM (peak about 4.7 GB vs 2.1 GB). The admin picks which
one the server uses, and old recordings can be transcribed again with the better model (D-47, D-48).

## Scope
In (mockups: `design/alkony/009-transcription-models.html`, screenshots in `design/alkony/screenshots/009/`):
- **More models** in `models.json`: Whisper large-v3 int8 and Turbo full precision (fp32), both sherpa-onnx. Turbo
  (int8) stays the default and first in the list. Turbo full precision is for older CPUs without int8 acceleration
  (the owner's i5-6500T has AVX2 but no VNNI, where int8 Whisper can loop or drop text): it avoids the int8 kernels.
- **Model list** in Settings > Rendszergazda, under the transcription switch, shown only while transcription is on
  (screens `models`, `modelsfirst`, `modelsready`, `modelsfail`, `modelsdelete`). Rows: name, one-line description, download size,
  state, actions. Choosing a model that is not downloaded downloads it, then makes it active. One model is active.
  Downloaded models stay on disk when you switch; the admin can delete a downloaded model that is not active.
- **Which model runs**: a job uses the model that is active when the job starts. Switching never interrupts a
  running job. Only one model is in memory at a time: the next job drops the old child process before it starts one
  for the new model.
- **Model label** on a transcript: the name of the model that wrote it ("Turbo", "Large-v3"), quietly in the meta
  row of the recording card.
- **Transcribe again** (screens `recmenu`, `recmenuoff`, `reconfirm`, `reworking`, `refail`): a menu button on each
  recording card opens a menu with "Átírás újra". It re-runs the recording with the active model. If the transcript was
  edited by hand, a confirm dialog says the edits will be replaced. The old transcript stays visible until the new one
  arrives; if it fails, the old one stays and an error shows. Search follows through the existing triggers.
- **Upgrade**: an install with turbo on disk shows turbo as downloaded and in use. Nothing is downloaded on upgrade.

Out (not now, suggestions S-24 and S-25 in `decisions.md`): transcribe all recordings again in bulk, RAM detection or
warnings based on the host. Also out: cancelling a running download (turning transcription off still cancels it,
as today), choosing a model per user or per recording, more than one download at a time.

This spec replaces two "Out" lines of spec 003: "choosing a model in the UI" and "re-transcribing a finished recording".

## Model list

`apps/server/src/modules/transcription/models.json` gets a second entry after turbo. Values checked against the
`asr-models` release of `k2-fsa/sherpa-onnx` (archive size from the GitHub API, sha256 of a fresh download, file sizes
from the archive listing):

```json
{
  "id": "whisper-large-v3-int8",
  "label": "Whisper large-v3 int8",
  "downloads": [
    {
      "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-large-v3.tar.bz2",
      "sha256": "2d0e134b3b5fc4a0533baf24a0c9d473b629aa47f030af0a165a05f461df7a03",
      "bytes": 1068482488,
      "archive": true
    },
    {
      "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
      "sha256": "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
      "bytes": 643854,
      "archive": false
    }
  ],
  "files": [
    { "name": "large-v3-encoder.int8.onnx", "bytes": 766671985 },
    { "name": "large-v3-decoder.int8.onnx", "bytes": 1008265203 },
    { "name": "large-v3-tokens.txt", "bytes": 816730 },
    { "name": "silero_vad.onnx", "bytes": 643854 }
  ]
}
```

Third entry, `whisper-large-v3-turbo-fp32` (label "Whisper large-v3-turbo fp32"), all downloads are plain files from
`https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main/` (sha256 from the Hugging Face LFS ids,
`turbo-tokens.txt` hashed from a fresh download), none is an archive. The encoder weights are external data and must sit
next to `turbo-encoder.onnx` under that exact name (checked: sherpa-onnx-node loads them from there):

| File | Bytes | sha256 |
|---|---|---|
| `turbo-encoder.onnx` | 735920 | `1b960f278564fb8bbacd544d4f85f4dd6d8a64d3aa89543d8f2c4021c926f976` |
| `turbo-encoder.weights` | 2600325120 | `746f879ecf066450ab0cdecc05383380b85157270ff6c0a9fb7cfdd917036e12` |
| `turbo-decoder.onnx` | 636209532 | `b24db5d90fa230c5eaa6b823d74862ced9e0d1dc3e01ec46601968e8db0e09ec` |
| `turbo-tokens.txt` | 816730 | `b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126` |
| `silero_vad.onnx` | 643854 | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` (GitHub release, as for the other models) |

`files` lists the same five names and sizes, `.onnx` encoder first (`sherpa-transcriber.ts` picks the first file whose
name contains "encoder"). Measured natively on a 20-core desktop with the sherpa child (4 threads, 48.7 s Hungarian
clip, load included): peak RSS 4.1 GB, real-time factor about 1.05, no int8 kernels involved. No loop guard or other code
tweak for old CPUs is part of this spec.

Sizes the UI shows: turbo 564 MB download, 1.0 GB on disk; large-v3 1.1 GB download, 1.8 GB on disk; turbo full
precision 3,2 GB download and on disk. Large-v3 uses
the same sherpa-onnx Whisper settings as turbo (128 mel features), so `sherpa-child.ts` does not change. Each model
keeps its own copy of the VAD file in its own folder, so deleting one model never breaks the other.

If `active_model` ever names an id that is no longer in the list (a later release drops a model), the server treats the
default model as active.

## Flows

```
Settings, transcription on
  row "not downloaded" --Letöltés--> downloading --ok--> downloaded
                       --Váltás erre--> downloading (then use) --ok--> downloaded + active ("Használatban")
  downloading --fails--> failed (row error + "Újrapróbálás" repeats the same action)
  row "downloaded" --Váltás erre--> active at once
                   --Törlés--> confirm --> files removed --> not downloaded

Recording card, entry owner
  ⋯ menu --Átírás újra--> [edited by hand? confirm] --> pending --> transcribing --> done (new text, new label)
                                                                               \--> failed (old text kept + error)
```

### Model row states and actions

| State | Shows | Actions |
|---|---|---|
| Not downloaded | "Nincs letöltve" | "Váltás erre" (primary: download, then use), "Letöltés" (line: download only) |
| Downloading | progress bar, "Modell letöltése…", "{{done}} / {{total}} · {{pct}}%"; with "then use" also "Letöltés után erre váltunk." | none |
| Failed | alert "A modell letöltése nem sikerült." or the disk-full text | "Újrapróbálás" (repeats download, or download then use) |
| Downloaded | "Letöltve" | "Váltás erre" (primary), "Törlés" (danger text button, opens confirm) |
| In use (active and downloaded) | accent chip "Használatban", accent border on the row | none (the active model cannot be deleted) |

- One download at a time. While one runs, "Váltás erre" and "Letöltés" on the other not-downloaded rows are
  disabled. "Váltás erre" on a downloaded row still works.
- The active model while it downloads for the first time (turning transcription on, spec 003) shows as Downloading
  in its row. The old progress block under the switch moves into the row; the switch, its hint, the ready line and the
  backlog question stay where they are.
- The switch hint (`settings.transcriptionHint`) shows the download size of the active model.
- The list follows live events: progress, state changes and the active model update without a reload.

## API

All admin routes answer 401 without a session, 403 for a non-admin, and return the full transcription status.

| Route | Who | Body | What |
|---|---|---|---|
| `GET /api/v1/admin/transcription` | admin | | status, now with `activeModel` and `models` |
| `PUT /api/v1/admin/transcription` | admin | `{ enabled }` | unchanged (turning on downloads the active model if missing) |
| `POST /api/v1/admin/transcription/backlog` | admin | | unchanged |
| `POST /api/v1/admin/transcription/models/:id/download` | admin | | starts a download. Already downloaded: nothing happens. 409 `model_not_ready` while transcription is off, 409 `download_running` if another model is downloading |
| `POST /api/v1/admin/transcription/models/:id/use` | admin | | downloaded: becomes active at once. Not downloaded: starts a download that makes it active when done (or marks the running download of this model "then use"). 409 `download_running` if another model is downloading |
| `DELETE /api/v1/admin/transcription/models/:id` | admin | | removes `models/<id>/`. 409 `model_in_use` for the active model, 409 `model_downloading` while it downloads. Not downloaded: nothing happens |
| `GET /api/v1/transcription` | any signed-in user | | `{ state: 'off' \| 'not_ready' \| 'ready' }`: off, on but the active model is not on disk, or ready |
| `POST /api/v1/recordings/:id/retranscribe` | entry owner | `{ replaceEdited?: boolean }` (strict) | queues the recording again with the active model, returns the recording (`status: 'pending'`, old transcript still attached) |

Model routes answer 404 `unknown_model` for an id that is not in the list.

`retranscribe` answers:
- 404 `recording_not_found` for someone else's recording or a bad id; nothing is queued.
- 409 `model_not_ready` when transcription is off or the active model is not on disk.
- 409 `already_transcribing` when the recording is `pending` or `transcribing`.
- 409 `transcript_edited` when the transcript has `is_user_edited = true` and `replaceEdited` is not `true`.
- Allowed from `done`, `failed` and `skipped`.

Shared schemas (`packages/shared/src/recordings.ts`):

```ts
export const modelStateSchema = z.enum(['not_downloaded', 'downloading', 'downloaded', 'failed'])

export const modelStatusSchema = z.object({
  id: z.string(),
  state: modelStateSchema,
  downloadBytes: z.number().int().nonnegative(), // size of the download
  diskBytes: z.number().int().nonnegative(), // sum of `files`, what deleting frees
  downloadedBytes: z.number().int().nonnegative(), // progress while downloading, else 0
  useWhenReady: z.boolean(), // the running or failed download makes it active when done
  error: z.enum(['download_failed', 'disk_full']).nullable(), // set when state is `failed`
})

// transcriptionStatusSchema gets two more fields; the existing ones keep their meaning for the active model
activeModel: z.string(),
models: z.array(modelStatusSchema), // in models.json order

export const retranscribeSchema = z.strictObject({ replaceEdited: z.boolean().optional() })
export const transcriptionAvailabilitySchema = z.object({ state: z.enum(['off', 'not_ready', 'ready']) })
```

"In use" in the UI is `id === activeModel && state === 'downloaded'`.

SSE (no new event types):
- `model.updated` gets `activeModel` and `models` next to its current fields, so the web app puts the whole list into
  the query cache. It goes out on every progress tick (at most about once a second, as today), on every state change,
  on a switch and on a delete.
- `recording.updated` is unchanged: the retranscribe request announces `pending`, the job announces `transcribing`,
  `done` or `failed` as usual. The card refetches the recordings of the entry, so the new text and label arrive with it.

## Server behaviour

Model manager (`model-manager.ts`): takes the model per download instead of one fixed model, runs one download at a
time, and keeps writing to `models/<id>.<n>.part` and `models/<id>.unpacked` as today. A write or unpack that fails
with `ENOSPC` ends as `failed` with error `disk_full`; any other failure is `download_failed`. Either way the partial
and unpacked files are removed. When a "then use" download finishes, `active_model` is set to that model in the same
step that marks it downloaded, then `model.updated` goes out.

On start:
- leftover `models/*.part` files and `models/*.unpacked` folders are removed before anything else touches the models
  folder;
- a download of the active model that was running is started again (spec 003, AC-23);
- a download of any other model that was running is marked `failed` (`download_failed`) and is not resumed. Its row
  offers "Újrapróbálás".

Turning transcription off cancels any running download (as today) and removes its partial files; the row goes back to
its earlier state.

Delete: removes the whole `models/<id>/` folder through the storage module, sets the row to not downloaded and sends
`model.updated`. Downloading it again later is a normal full download.

Transcribe job (`transcribe-job.ts`):
- At the start of each job, after the existing status checks, it reads the active model from `instance_settings`. If
  the loaded transcriber is for another model, it disposes it and waits until it is gone, then creates one for the
  active model. `TranscriberFactory` becomes `(model: ModelInfo) => Transcriber`.
- The transcript stores `transcriber.modelId`, which is the id of the model that ran.
- Job data gets `replaceEdited?: boolean`. With `true` the upsert writes text, language and model and sets
  `is_user_edited = false` even if the old row was edited. Without it the existing guard stays (edited text is never
  overwritten, spec 003 AC-18).
- A duplicate job for a recording that is already `done` still does nothing, so a replace can't run twice.
- When the model files are gone at load time (deleted between a job reading the active model and loading it, which
  needs a switch and a delete in that moment), the load fails like any transcriber failure: that attempt is retried, and
  the retry reads the active model again.
- Deleting a model that a running job has already loaded does not stop that job (the model is in the child process's
  memory); the next job loads the active model.

Retranscribe route: sets the recording to `pending`, announces it, and queues a job with `replaceEdited` from the body
when the model is ready (as `schedule` does). It never deletes or changes the transcript row. When the job fails for
good, the recording is `failed` and the old transcript row is untouched.

Fake transcriber: `modelId` is the id of the model it was created for (was the fixed `fake`), so tests and the e2e app
show real model names.

## Web behaviour

- `TranscriptionSettings` renders the model list as described above. Delete opens the existing `Dialog`
  (`alertdialog`); its size is `diskBytes`, rows show `downloadBytes`. Sizes use one helper: under 1 GB whole MB ("564 MB"), from 1 GB one decimal GB ("1,1 GB" in `hu`,
  "1.1 GB" in `en`, `Intl.NumberFormat`), with a non-breaking space before the unit so "564 MB" never wraps.
  Progress numbers stay in MB like today.
- Recording card: a 44 px icon button (same size as the play button) (three dots, `aria-label` "Felvétel műveletei", `aria-haspopup="menu"`,
  `aria-expanded`) at the end of the player row opens a small menu (`role="menu"`, items `role="menuitem"`). Enter,
  Space and Arrow Down open it and focus the first item; Escape and a click outside close it and focus the button.
  Opening the menu fetches `GET /api/v1/transcription`.
- "Átírás újra" is `aria-disabled` with a hint under its label when: transcription is off ("Az átírás ki van
  kapcsolva."), the active model is not on disk ("Még nincs letöltött modell."), or the recording is pending or
  transcribing ("Az átírás már folyamatban van."). The hint is linked with `aria-describedby`.
- Transcript edited by hand: the item opens a confirm dialog first; "Átírás újra" in the dialog sends
  `replaceEdited: true`, "Mégse" sends nothing.
- A 409 from `retranscribe` (state changed meanwhile) shows the matching error text on the card.
- While a recording that has a transcript is `pending` or `transcribing`: the line "Újraírás folyamatban…"
  (`role="status"`) shows above the old text, the old text is shown in the muted colour, and "Átirat szerkesztése" is
  hidden. A recording without a transcript keeps today's skeleton.
- `failed` with a transcript: an alert "Az újraírás nem sikerült." / "A korábbi átirat megmaradt. Próbáld újra." with
  "Újrapróbálás" above the old text; "Újrapróbálás" does the same as the menu item (same confirm when edited). Editing
  is allowed in this state.
- Model label: the meta row (`.tag`) shows the model name after the time, for a transcript whose model id has a
  catalogue entry; an unknown id shows nothing. Screen readers hear "Modell: Large-v3" (visually hidden prefix).
- `transcript.editNote` changes to say automatic transcription never overwrites edits (see i18n).

## Data model

Migration `0008`:

| Table | Change |
|---|---|
| `instance_settings` | `active_model text not null default 'whisper-large-v3-turbo-int8'` |
| `instance_settings` | `model_download_id text` (null when no download is running or failed), `model_download_use boolean not null default false`, `model_download_error text` (`download_failed` / `disk_full`, null otherwise) |
| `instance_settings` | backfill: `model_download_id = 'whisper-large-v3-turbo-int8'` where `model_download_state <> 'idle'` (until now every download was turbo) |
| `transcripts` | no change. `model` exists since spec 003 and every transcript written by a release holds `whisper-large-v3-turbo-int8`, the only model so far, so the backfill D-48 asks for is already true |

`model_download_state` and `model_downloaded_bytes` keep their meaning, now for the model in `model_download_id`.

Migration `0009`: `recordings.replace_edited boolean not null default false`. A confirmed "transcribe again" of an
edited transcript is kept here, so a restart that queues the recording again keeps it. It is cleared when the job ends
(done or failed for good), when the recording is set to skipped, and when the user saves a transcript edit.

Migration `0010`: `instance_settings.model_downloaded_bytes` becomes `bigint` (an `integer` overflows at 2.1 GB, and
Turbo full precision is 3,2 GB).

Folders of a model that a later release drops from `models.json` stay on disk and have no Delete button (open item in
`decisions.md`).

Docs to update when this is built: `architecture.md` (data model table, events, data folder, transcription
section), `product.md` (settings and entry flows).

## Acceptance criteria

Model list
- **AC-1** Given `models.json`, then it parses with the model list schema, turbo is the default and first, and the large-v3 and turbo full precision entries have exactly the URLs, sha256, byte counts and file names in this spec.
- **AC-2** Given transcription on, when the admin opens Settings, then the model list shows Turbo, Large-v3 and Turbo (teljes pontosság), each with name, description and download size ("564 MB", "1,1 GB"), and the active one shows "Használatban" without action buttons; given transcription off, then no model list shows and the switch, hint and turn-on flow of spec 003 work as before.
- **AC-3** Given a model that is not downloaded, when the admin presses "Letöltés", then it downloads into `models/<id>/` with the checksum checked, the row shows live progress (MB / MB, %) and then "Letöltve", the active model does not change, and recordings saved meanwhile are transcribed with the active model.
- **AC-4** Given a model that is not downloaded, when the admin presses "Váltás erre", then it downloads with "Letöltés után erre váltunk." under the progress, and once the files are in place it becomes active ("Használatban") and the previous model shows "Letöltve" with its files still on disk.
- **AC-5** Given a downloaded model that is not active, when the admin presses "Váltás erre", then it becomes active at once, nothing is downloaded, and the previous model's files stay.
- **AC-6** Given a download running, then "Váltás erre" and "Letöltés" on other not-downloaded rows are disabled, and the download and use routes answer 409 `download_running` for another not-downloaded model.
- **AC-7** Given a downloaded model that is not active, when the admin presses "Törlés", then a dialog "Törlöd a {{name}} modellt?" opens; "Törlés" removes `models/<id>/` completely and the row shows "Nincs letöltve"; "Mégse" changes nothing. The active model has no "Törlés" button, and the delete route answers 409 `model_in_use` for it and 409 `model_downloading` for a model that is downloading.
- **AC-8** Given a model that was deleted, when the admin downloads it again, then it is a normal full download (every file fetched again, checksum checked) and it ends as "Letöltve".
- **AC-9** Given a download that fails (dropped connection or wrong checksum), then partial and unpacked files are removed, the row shows "A modell letöltése nem sikerült." with "Újrapróbálás", the active model and running jobs are not affected, and "Újrapróbálás" repeats the same action (download only, or download then use).
- **AC-10** Given the disk fills up during a download or unpack (`ENOSPC`), then partial and unpacked files are removed and the row shows "Nincs elég hely a szerveren. Szabadíts fel helyet, és próbáld újra." with "Újrapróbálás".
- **AC-11** Given the server stops during a download, when it starts again, then leftover `.part` files and `.unpacked` folders are gone; a download of the active model starts again (spec 003); a download of another model shows as failed with "Újrapróbálás" and is not resumed.
- **AC-12** Given a download running, when the admin turns transcription off, then the download stops, its partial files are removed, and the row goes back to "Nincs letöltve".
- **AC-13** Given an open Settings page in one tab, when progress, a switch or a delete happens (from another tab or the server), then the list updates without a reload (`model.updated` with `activeModel` and `models`).

Which model runs
- **AC-14** Given turbo active and a job running, when the admin switches to large-v3, then the running job finishes with turbo and its transcript stores `whisper-large-v3-turbo-int8`; the next job disposes the turbo transcriber before creating one for large-v3 (never two live), and its transcript stores `whisper-large-v3-int8`.
- **AC-15** Given a job that read model X as active and X's files are gone when it loads (switched away and deleted at that moment), then that attempt fails like any transcriber failure and the retry uses the model active then; the recording ends `done` with that model's id.
- **AC-16** Given a job running with model X, when the admin switches away from X and deletes it, then the delete succeeds and the running job still finishes `done` with X.

Transcribe again
- **AC-17** Given a recording card of the signed-in user, then a "Felvétel műveletei" button opens a menu with "Átírás újra"; the menu opens with Enter, Space or Arrow Down, focuses the item, and Escape or a click outside closes it and puts focus back on the button.
- **AC-18** Given a done transcript that was not edited, when the user picks "Átírás újra", then the recording goes `pending` → `transcribing` → `done` without a reload; meanwhile the old text stays visible (muted) under "Újraírás folyamatban…" and "Átirat szerkesztése" is hidden; at the end the new text and the new model's label show, and search finds words of the new text and no longer finds words only the old text had.
- **AC-19** Given a transcript edited by hand, when the user picks "Átírás újra", then a dialog "Felülírjuk a javításaidat?" opens; "Átírás újra" in the dialog queues the job with `replaceEdited: true` and the new text replaces the edit with `is_user_edited = false`; "Mégse" sends nothing. The route answers 409 `transcript_edited` and queues nothing when `replaceEdited` is not `true`.
- **AC-20** Given transcription off, or on with the active model not on disk, or the recording `pending` / `transcribing`, then "Átírás újra" is disabled with the matching hint ("Az átírás ki van kapcsolva.", "Még nincs letöltött modell.", "Az átírás már folyamatban van."), and the route answers 409 `model_not_ready` or `already_transcribing`.
- **AC-21** Given a transcribe-again job that fails for good, then the recording is `failed`, the old transcript (text, model, language, edited flag) is unchanged in the database and on the card, and the card shows "Az újraírás nem sikerült." with "Újrapróbálás", which transcribes again (with the confirm when the transcript was edited).
- **AC-22** Given user A's recording, when user B calls `retranscribe` or `GET /api/v1/transcription` as a non-admin, then B gets 404 for A's recording and nothing is queued, and B gets the availability state (it holds no user data).

Model label and upgrade
- **AC-23** Given a transcript, then the meta row shows "Turbo" for `whisper-large-v3-turbo-int8` and "Large-v3" for `whisper-large-v3-int8`, nothing for an unknown id, and the accessible text is "Modell: <name>".
- **AC-24** Given a database from 0.2.0 (migrations up to `0007`) with transcription on, turbo files on disk and a transcript, when the new version starts, then `active_model` is turbo, the status shows turbo downloaded and in use and large-v3 not downloaded, nothing is downloaded, and the card shows "Turbo" on the old transcript.

Access, accessibility, privacy
- **AC-25** Given a non-admin user, then the model routes answer 403 and Settings shows no model list; given an id not in the list, then the model routes answer 404 `unknown_model`.
- **AC-26** Given the model list (one row downloading, one in use; downloaded + delete button; failed), the delete dialog, the open recording menu (enabled and disabled item), the edited-transcript dialog and the cards re-transcribing and failed with an old transcript, then axe reports no violations on mobile and desktop, light and dark.
- **AC-27** Given this spec's flows (download, switch, delete, transcribe again with an edited transcript, a failing job) run with marker text (like `ZQX-PRIVATE-7781`) in the transcript, the edit and the uploaded file name, then the marker appears nowhere in the captured logs, and model log lines carry only the model id and a reason.

## Test plan

Fakes: the model fixture server (`apps/server/test/support/model-server.ts`) serves two models under the real ids
(`whisper-large-v3-turbo-int8` first and default, `whisper-large-v3-int8`; the fp32 entry is covered by the AC-1 unit test only), each with its own small random files at
`/<modelId>/<file>`, so the UI shows real names. It keeps `slowMs`, `dropOnce` and `corrupt`. The fake transcriber
reports the model it was created for, and gets an option so its text names the model (old and new text differ after
a switch). Disk full is a unit test on the model manager with a writer that fails with
`ENOSPC`. API tests need `ffmpeg` (as in spec 003). Test file names: `009-transcription-models.*`.

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | parse real `models.json`, pin large-v3 values | | | | |
| AC-2 | size helper (`564 MB`, `1,1 GB` / `1.1 GB`) | rows, in-use chip, list hidden when off | status has `activeModel`, `models` | turn on → list with Turbo "Használatban" | |
| AC-3 | | progress from cache, "Letöltve" | download → files in `models/<id>/`, active unchanged, recording meanwhile uses active | "Letöltés" on Large-v3 → progress → "Letöltve" | fixture `slowMs` |
| AC-4 | | then-use note | use → download → `activeModel` switches, old files kept | "Váltás erre" on Large-v3 → "Használatban" | |
| AC-5 | | | use downloaded → active at once, no fixture request | | pre-seeded folders |
| AC-6 | | buttons disabled while downloading | 409 `download_running` | | |
| AC-7 | | dialog opens, cancel keeps | delete → folder gone; 409 `model_in_use`, `model_downloading` | delete Turbo after switching → "Nincs letöltve" | |
| AC-8 | | | delete → download → every file requested again | | count fixture requests |
| AC-9 | | error + retry calls the same route | `dropOnce` and `corrupt` → no leftovers, active unchanged, retry repeats then-use | | |
| AC-10 | `ENOSPC` writer → `disk_full`, files removed | disk-full text | | | |
| AC-11 | | | leftovers removed on start; other model's download `failed`, active model's resumes | | restart the app on the same data folder |
| AC-12 | | | off during download → cancelled, no `.part` | | |
| AC-13 | | live update of list from `model.updated` | event carries `activeModel`, `models` | second page sees the switch | |
| AC-14 | | | hold job, switch, release → transcript model turbo; next job large-v3; live instances never above 1 | | `holdJobs`, counts per model |
| AC-15 | | | factory that throws when the model folder is missing; switch + delete before release → retry ends `done` with the active id | | retry delay 0 |
| AC-16 | | | hold job with X, switch, delete X (200), release → `done` with X | | |
| AC-17 | | menu keyboard + outside click | | open menu with keyboard | |
| AC-18 | | working line over old muted text, edit hidden | status sequence, transcript replaced, search old/new word | done card → "Átírás újra" → "Újraírás folyamatban…" → label "Large-v3" | fake text names the model |
| AC-19 | | dialog confirm / cancel (no request on cancel) | 409 without flag, replace with flag, `is_user_edited` false | edit → transcribe again → confirm → edit gone | |
| AC-20 | | three disabled hints | 409 `model_not_ready`, `already_transcribing` | | |
| AC-21 | | failed-with-transcript card, retry → confirm when edited | fail 3 times → `failed`, row unchanged | | `failNext(3)` |
| AC-22 | | | 404 + no job for B; availability for non-admin | | two users |
| AC-23 | | label per id, none for unknown, accessible name | | | |
| AC-24 | | | real migrations to `0007`, seed, migrate, start with turbo files → status, no fixture request, transcript model | | also extend `scripts/upgrade-test.ts`: after upgrade `activeModel` is turbo |
| AC-25 | | list hidden for non-admin | 403 / 404 `unknown_model` | | |
| AC-26 | | | | axe on each state | `emulateMedia({ colorScheme })` |
| AC-27 | | | marker through the flows, absent from captured logs | | `log-capture.ts` |

Also covered: both languages (catalogue test from spec 006 AC-5), layout checks at 390 and 1280 on the new states
(spec 006 AC-10 helper), the spec 003 tests keep passing with the fixture's new ids and paths.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `models.whisper-large-v3-turbo-int8.name` / `.description` | Turbo / Gyors, jó alapértelmezés. | Turbo / Fast, a good default. |
| `models.whisper-large-v3-turbo-fp32.name` / `.description` | Turbo (teljes pontosság) / Régebbi processzorokhoz. Kb. 4 GB szabad memória kell hozzá, és lassabb. | Turbo (full precision) / For older processors. Needs about 4 GB of free RAM and is slower. |
| `models.whisper-large-v3-int8.name` / `.description` | Large-v3 / A legpontosabb. 4 magos processzoron kb. 3-szor lassabb a valós időnél, és kb. 5 GB szabad memória kell hozzá. | Large-v3 / Most accurate. About 3x slower than real time on a 4-core CPU, needs about 5 GB of free RAM. |
| `settings.models.title` | Átírási modell | Transcription model |
| `settings.models.size` | {{size}} letöltés | {{size}} download |
| `settings.models.notDownloaded` / `.downloaded` / `.inUse` | Nincs letöltve / Letöltve / Használatban | Not downloaded / Downloaded / In use |
| `settings.models.use` / `.download` / `.delete` | Váltás erre / Letöltés / Törlés | Use / Download / Delete |
| `settings.models.useAfter` | Letöltés után erre váltunk. | We'll switch to it once it's downloaded. |
| `settings.models.diskFull` | Nincs elég hely a szerveren. Szabadíts fel helyet, és próbáld újra. | There isn't enough disk space on the server. Free up some space and try again. |
| `settings.models.deleteTitle` / `.deleteText` | Törlöd a {{name}} modellt? / A fájljai ({{size}}) törlődnek a szerverről. Később újra letöltheted. | Delete the {{name}} model? / Its files ({{size}}) are removed from the server. You can download it again later. |
| `recording.menu` | Felvétel műveletei | Recording actions |
| `recording.transcribeAgain` | Átírás újra | Transcribe again |
| `recording.againOff` / `.againNoModel` / `.againRunning` | Az átírás ki van kapcsolva. / Még nincs letöltött modell. / Az átírás már folyamatban van. | Transcription is off. / No model is downloaded yet. / It's already being transcribed. |
| `recording.replaceTitle` / `.replaceText` | Felülírjuk a javításaidat? / Ezt az átiratot kézzel javítottad. Az új átírás lecseréli a szöveget, a javításaid elvesznek. | Replace your edits? / You edited this transcript by hand. Transcribing again replaces the text and your edits are lost. |
| `transcript.reworking` | Újraírás folyamatban… | Transcribing again… |
| `transcript.againFailed` / `.againFailedText` | Az újraírás nem sikerült. / A korábbi átirat megmaradt. Próbáld újra. | Transcribing again failed. / The earlier transcript is still here. Try again. |
| `transcript.modelPrefix` (visually hidden) | Modell: | Model: |
| `transcript.editNote` (changed) | Az automatikus átírás nem írja felül a javításaidat. | Automatic transcription never overwrites your edits. |
| `error.model_in_use` | A használatban lévő modellt nem lehet törölni. Előbb válts másikra. | The model in use can't be deleted. Switch to another one first. |
| `error.download_running` | Egyszerre csak egy modell töltődhet le. | Only one model can download at a time. |
| `error.model_not_ready` | Az átírás most nem érhető el. | Transcription isn't available right now. |
| `error.transcript_edited` | Ezt az átiratot közben kézzel javították. | This transcript was edited by hand in the meantime. |
| `error.already_transcribing` | Az átírás már folyamatban van. | It's already being transcribed. |

Reused: `settings.model.downloading`, `settings.model.progress`, `settings.model.failed`, `common.retry`,
`common.cancel`, `transcript.edit`.

## Privacy & data
- Stored: the active model id and the download state in `instance_settings`; model files under `/data/models/<id>/`;
  the model id on each transcript (already there).
- Outbound traffic: only model downloads from the sherpa-onnx GitHub release, and only after an admin action (turning
  transcription on, "Letöltés", "Váltás erre"). Audio and text never leave the server.
- Logs: model download, switch and delete lines carry the model id and a reason code only. Transcript text, edits and
  file names are never logged (spec 007); a transcribe-again request logs the request line like any other route.
- Deleting a model removes its files right away. Transcripts keep their model id.

## Open questions
None blocking. Choices made here that the owner may want to change:
1. The model list shows only while transcription is on (keeps the spec 003 flow as is). Alternative: show it when off
   too, so the admin can pick Large-v3 before the first download.
2. One download at a time, no cancel button (turning transcription off cancels).
