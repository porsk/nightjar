# 014 Download a recording

Status: approved
Milestone: 0.5

## Why
The owner wants to keep or share the audio of a recording outside Nightjar (D-65). Today it can only be played.

## Scope
In (mockup: `design/alkony/011-settings-users.html`, screen `recmenu`; screenshots in `design/alkony/screenshots/011/`):
- **"Letöltés"** in the recording card's "…" menu, under "Átírás újra", with the file name as a small second line.
- **File name:** `nightjar-YYYY-MM-DD-HHMM.<ext>`, date and time when the recording was saved, in the user's time zone
  (the time the card shows), for example `nightjar-2026-11-26-2042.webm`.
- **File type:** the stored file as it is, no conversion: a browser recording downloads as `.webm` (or `.ogg`), an
  uploaded `.m4a` as `.m4a`, `.mp3` as `.mp3`, and so on (O-13).
- Works for recordings in every state (pending, transcribing, done, failed, not transcribed) and whether transcription
  is on or off.
- Only the owner of the recording can download it (admins included, spec 012).

Out (not now): downloading a whole entry or all recordings (export zip is S-2), converting to another format, the
transcript as a file, sharing links.

## Server behaviour

- `GET /api/v1/recordings/:id/audio?download=1`: same route, same ownership check, same range support and
  `cache-control: private, no-store` as playback (spec 003), plus
  `content-disposition: attachment; filename="nightjar-2026-11-26-2042.webm"`. Without `download=1` nothing changes
  (playback stays inline). Any other value of `download` is treated as absent.
- File name: `nightjar-` + the recording's `created_at` formatted `YYYY-MM-DD-HHMM` in the owner's `time_zone` (24 h,
  zero-padded) + `.` + the extension of the stored file key (`webm`, `ogg`, `m4a`, `aac`, `mp3`, `wav`, `flac`, from
  `sniff.ts`). ASCII only, so no `filename*` is needed. Two recordings saved in the same minute get the same name; the
  browser adds its own counter.
- `recordingSchema` gets `fileName: z.string()`, computed by the same function, so the menu shows exactly the name the
  download gets.
- Not the owner, or a made-up id: 404 `recording_not_found`, same as playback. File missing on disk: 404.

## Web behaviour

- `RecordingMenu`: a second item, an `<a role="menuitem" href="/api/v1/recordings/:id/audio?download=1" download>`
  with the download icon, label "Letöltés" and the `fileName` as `<small>`. It is never disabled. Keyboard: arrow keys
  move between the two items, Enter starts the download and closes the menu, focus returns to the "…" button.
- The menu's minimum width stays 240 px; the file name may wrap (`overflow-wrap: anywhere`), it never widens the menu
  past the card.

## Acceptance criteria

- **AC-1** Given a recording of the signed-in user, when `GET /api/v1/recordings/:id/audio?download=1` is called, then it answers 200 with the exact stored bytes, the stored `content-type`, `cache-control: private, no-store` and `content-disposition: attachment; filename="nightjar-YYYY-MM-DD-HHMM.<ext>"`; without `download=1` there is no `content-disposition` header.
- **AC-2** Given a recording saved at 2026-11-26T19:42:30Z by a user in `Europe/Budapest`, then the name is `nightjar-2026-11-26-2042.webm`; for a user in `America/New_York` it is `nightjar-2026-11-26-1442.webm`; a recording saved at 23:05 local time on 31 December is named with that local date, not the UTC one.
- **AC-3** Given uploads stored as `m4a`, `mp3`, `wav`, `ogg`, `aac` and `flac`, then each downloads with that extension and its bytes unchanged (no conversion) (O-13).
- **AC-4** Given a `Range: bytes=0-99` request with `download=1`, then it answers 206 with those bytes, the range headers and the same `content-disposition`.
- **AC-5** Given another user's recording (also when the caller is an admin) or a made-up id, then the download answers 404 `recording_not_found` and sends no bytes; without a session, 401.
- **AC-6** Given `GET /api/v1/entries/:id/recordings`, then every recording has `fileName` equal to the name the download gets.
- **AC-7** Given the recording card's "…" menu, then it shows "Átírás újra" and below it "Letöltés" with the file name as a second line; "Letöltés" is enabled also while the recording is transcribing, failed, or transcription is off.
- **AC-8** Given the menu opened with the keyboard, when the user moves to "Letöltés" and presses Enter, then the browser downloads a file with that name and the same bytes as the stored file, the menu closes and focus returns to the "…" button.
- **AC-9** Given the `recmenu` state in `hu` and `en`, at 390 and 1280, light and dark, then axe reports no violations and the layout checks pass (the menu stays inside the card at 390).
- **AC-10** Given downloads run in a test, then the captured logs contain no file name of the download and no stored file key.

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | | headers and bytes with and without `download=1`, `download=0` treated as absent | | |
| AC-2 | file name function with fixed instants and zones, year end, DST change day | | | | |
| AC-3 | | | one upload per format, bytes compared | | fixture files from spec 003 upload tests |
| AC-4 | | | 206 + header | | |
| AC-5 | | | other user, admin on other user, made-up id → 404; no session → 401 | | |
| AC-6 | | | `fileName` in the list equals the header name | | |
| AC-7 | | menu items, second line, enabled in every state | | | |
| AC-8 | | arrow keys, Enter closes, focus back | | Playwright `page.waitForEvent('download')`: `suggestedFilename()` and bytes | record with the fake mic first |
| AC-9 | | | | axe + `expectLayout` on `recmenu` | |
| AC-10 | | | download with log capture, assert no name or key | | spec 007 helper |

Also covered: both languages.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `recording.download` | Letöltés | Download |

## Privacy & data
- Nothing new is stored. The file leaves the server only to the signed-in owner's browser.
- Logs keep the route and status only, never the file name or storage key.

## Open questions
None open. O-13 was decided by the owner on 2026-11-28 (D-67).
