# 002 Text entries

Status: done
Milestone: M1

## Why
Typing is as important as speaking: the owner needs to write, edit and delete entries, and say which day they are about.

## Scope
In:
- Writer for a new entry (`write` in `design/alkony/m1.html`), opened from Home "Inkább írok". Plain Markdown textarea,
  date chip, autosave with "Mentve HH:MM", "Markdown használható", "Kész".
- Edit an entry (`edit`): same writer with the text and date, plus "Bejegyzés törlése".
- Change the entry date (`date`): month calendar dialog "Melyik napról szól?".
- Entry page, text part (`entry`): date heading, "Dátum módosítása" chip, rendered Markdown, edit and delete buttons.
  Recordings on the same page are spec 003; the desktop list beside it is spec 004.
- Delete with confirmation (`delete`): removes the entry, its recordings, transcripts and audio files.
- API: `POST /api/v1/entries`, `GET /api/v1/entries/:id`, `PATCH /api/v1/entries/:id` (`bodyMd`, `entryDate`),
  `DELETE /api/v1/entries/:id`. Table `entries` (architecture.md, "M1 data model").

Out (not now): title, mood, tags, photos, journals, favourites, Markdown toolbar or rich editor (D-27), version history, trash.

## Acceptance criteria

- **AC-1** Given Home at 2026-11-26 21:30 Europe/Budapest, when the user presses "Inkább írok", then the writer opens titled "Új bejegyzés" with the date chip "Ma, november 26.".
- **AC-2** Given the writer, when the user types, then 1 second after the last keystroke the text is saved (the first save creates the entry) and "Mentve 21:30" shows the save time in the user's time zone; while the text is empty, no entry is created.
- **AC-3** Given unsaved typing in the writer, when the user presses "Kész", then the text is saved and the entry page opens showing it.
- **AC-4** Given a body with Markdown (`**bold**`, a list, a link), when the entry page shows it, then it is rendered (`strong`, `ul`, `a` with `rel="noopener noreferrer"`), and raw HTML in the body (`<script>`, `<img src=x onerror=…>`) is shown as text and never runs.
- **AC-5** Given the writer or the entry page, when the user opens "Dátum módosítása", picks a day and presses "Kész", then `entry_date` is saved and the chip shows the new date; days after today (user's time zone) cannot be picked; "Mégse" changes nothing.
- **AC-6** Given the clock at 2026-11-26 23:30 UTC and the user's time zone Europe/Budapest, when a new entry is created, then its `entry_date` is 2026-11-27.
- **AC-7** Given an `entryDate` after today in the user's time zone, or not a valid date, or a body over 100 000 characters, when the API is called, then it answers 400 with a stable error code and nothing changes.
- **AC-8** Given an existing entry, when the user presses "Szerkesztés", then the writer opens titled "Bejegyzés szerkesztése" with the current text and date, and edits autosave as in AC-2.
- **AC-9** Given an entry with text and recordings, when the user presses delete (entry page or "Bejegyzés törlése") and confirms, then the entry, its recordings, transcripts and audio files are gone (files removed from disk) and the timeline opens; "Mégse" in the dialog keeps everything.
- **AC-10** Given a failed autosave (network error or 500), then the writer shows "Nem sikerült menteni" with a retry, the text stays in the textarea, and the next successful save clears the message.
- **AC-11** Given user A's entry, when user B calls `GET`, `PATCH` or `DELETE /api/v1/entries/:id` on it, then B gets 404 and A's entry is unchanged.
- **AC-12** Given the writer (new and edit), the date dialog, the delete dialog and the entry page, then axe reports no violations on mobile and desktop, light and dark.
- **AC-13** Given the flows of this spec (create, edit, validation error, delete) run in a test with marker text (like `ZQX-PRIVATE-7781`) in every field and file name, then the marker appears nowhere in the captured log output (helper `apps/server/test/support/log-capture.ts`, spec 007).

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | "today" label for a time zone | | | Home → writer, chip text in `hu` and `en` | Playwright `clock.setFixedTime`, `timezoneId: 'Europe/Budapest'` |
| AC-2 | | debounce (fake timers): no save before 1 s, one save after; nothing on empty text | create then update | type → reload → text is there | |
| AC-3 | | | | Kész → entry page shows text | |
| AC-4 | Markdown renderer: allowed tags, HTML escaped, link `rel` | | | | XSS strings from OWASP cheat sheet |
| AC-5 | | calendar disables future days, Mégse keeps date | `PATCH entryDate` | change date → timeline moves entry to that day | fixed clock |
| AC-6 | `todayIn(timeZone, now)` | | entry created with the client date | | 23:30 UTC = 00:30 Budapest next day |
| AC-7 | Zod schema | | each bad input → 400 + code | | today+1 in user zone, `2026-02-30`, 100 001 chars |
| AC-8 | | | | edit → change text → reload shows it | |
| AC-9 | | dialog keeps entry on Mégse | rows and files gone after delete | delete from entry page and from edit screen | seeded entry with 2 recordings on disk |
| AC-10 | | API mocked to fail → message, text kept, retry works | | | |
| AC-11 | | | B gets 404 on all three, A's row unchanged | | second user made by a test helper |
| AC-12 | | | | axe on each screen state | `emulateMedia({ colorScheme })` |
| AC-13 | | | marker through this spec's flows, assert absent from captured logs | | helper from spec 007 |

Also covered: both languages, mobile + desktop, screenshots of `write`, `edit`, `date`, `delete`, `entry`.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `home.write` | Inkább írok | I'd rather write |
| `writer.newTitle` / `writer.editTitle` | Új bejegyzés / Bejegyzés szerkesztése | New entry / Edit entry |
| `writer.textLabel` | A bejegyzés szövege | Entry text |
| `writer.savedAt` | Mentve {{time}} | Saved {{time}} |
| `writer.saveFailed` | Nem sikerült menteni. | Couldn't save. |
| `writer.markdownHint` | Markdown használható | Markdown works here |
| `writer.done` | Kész | Done |
| `entry.changeDate` | Dátum módosítása | Change date |
| `entry.edit` / `entry.delete` | Szerkesztés / Törlés | Edit / Delete |
| `entry.deleteEntry` | Bejegyzés törlése | Delete entry |
| `dateDialog.title` / `.text` | Melyik napról szól? / A bejegyzés a kiválasztott napnál jelenik meg az idővonalon. | Which day is it about? / The entry shows under that day in the timeline. |
| `dateDialog.prevMonth` / `.nextMonth` | Előző hónap / Következő hónap | Previous month / Next month |
| `deleteDialog.title` / `.text` | Törlöd ezt a bejegyzést? / A szöveg és a hozzá tartozó hangfelvételek végleg törlődnek. Ezt nem lehet visszavonni. | Delete this entry? / The text and its recordings are deleted for good. This can't be undone. |
| `common.cancel` / `common.retry` | Mégse / Újrapróbálás | Cancel / Try again |
| `date.today` / `date.yesterday` | Ma, {{date}} / Tegnap, {{date}} | Today, {{date}} / Yesterday, {{date}} |
| `error.entry_not_found` / `.invalid_entry_date` / `.body_too_long` | A bejegyzés nem található. / Érvénytelen dátum. / A szöveg túl hosszú. | Entry not found. / Invalid date. / The text is too long. |

## Privacy & data
- Stored: `entries` row (body, date, timestamps, search vector). Delete removes rows and files for real.
- Entry text is never logged (spec 007). Nothing leaves the server.

## Open questions
None. No title and no journals in M1 (D-30 Q2, Q3); the M2 migration adds a default journal per user.
