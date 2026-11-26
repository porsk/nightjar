# 004 Timeline

Status: approved
Milestone: M1

## Why
The owner needs to see and open past entries, newest first, and see today's entries on Home.

## Scope
In (screen names from `design/alkony/m1.html`):
- **Timeline** (`timeline`): entries grouped by day, infinite scroll, a card per entry with icon, time, length,
  excerpt and transcription badge. Desktop entry view (`entry`): the same list beside the reading pane.
- **Home** (`home`): greeting, date, record button, "Inkább írok", "Hangfájl feltöltése" (buttons lead to specs 002 / 003),
  "Mai bejegyzések" list.
- **Navigation**: mobile tab bar (Ma, Idővonal, Keresés, Beállítások), desktop sidebar with the same items,
  "Új felvétel" button and privacy note. Sidebar record button hidden on Home and while recording (D-22).
- API: `GET /api/v1/entries?before=<cursor>&limit=30` (timeline page), `GET /api/v1/entries?date=YYYY-MM-DD` (one day).
  Each item: id, entryDate, createdAt, excerpt, hasRecordings, totalDurationMs, badge. Table `entries`, `recordings`,
  `transcripts` (architecture.md, "M1 data model").

Out (not now): calendar, filters, mood, favourites, look-backs, stats.

## Acceptance criteria

- **AC-1** Given entries on several days, when the timeline opens, then days are newest first and, within a day, entries are newest `created_at` first.
- **AC-2** Given the clock at 2026-11-26 21:00 Europe/Budapest, then day headings read "Ma, november 26.", "Tegnap, november 25.", "Hétfő, november 23." (weekday + date for older days) and add the year for days not in the current year ("Péntek, 2025. december 5."); in English "Today, November 26", "Yesterday, November 25", "Monday, November 23", "Friday, December 5, 2025".
- **AC-3** Given an entry, then its card shows a microphone icon if it has recordings (pen icon otherwise), the creation time in the user's time zone, the total recording length (m:ss) if any, and an excerpt: the body text with Markdown stripped, else the first finished transcript, else "Hangfelvétel, szöveg nélkül"; the excerpt is cut to 2 lines.
- **AC-4** Given an entry's recordings, then the card badge is "Nem sikerült" if any failed, else "Átírás folyamatban" if any is pending or transcribing, else "Nincs átírva" if any is skipped, else no badge; the badge updates live when a status changes (SSE).
- **AC-5** Given 75 entries, when the user scrolls to the end of the list, then the next 30 load with "További bejegyzések betöltése…" shown meanwhile, until all 75 are shown once each; entries added or deleted between pages cause no duplicates or gaps (cursor on `entry_date`, `created_at`, `id`).
- **AC-6** Given no entries, then the timeline shows "Még nincs bejegyzésed." with a hint to Home, and Home's "Mai bejegyzések" shows "Ma még nincs bejegyzés.".
- **AC-7** Given a card, when the user opens it, then on mobile the entry page opens (with "Vissza" back to the same scroll position), and on desktop (1024 px and wider) the entry opens in the reading pane beside the list with that card marked `aria-current`.
- **AC-8** Given Home, then it shows the greeting by time of day in the user's time zone (5 to 10 "Jó reggelt" / Good morning, 10 to 18 "Jó napot" / Good afternoon, 18 to 5 "Jó estét" / Good evening, each followed by the question), the weekday (mobile) or weekday + date (desktop), the record button, "Inkább írok", "Hangfájl feltöltése", and "Mai bejegyzések" listing the entries whose `entry_date` is today in the user's time zone, newest first.
- **AC-9** Given mobile, then the tab bar shows Ma, Idővonal, Keresés, Beállítások with the current one marked `aria-current`, and is hidden on the recorder, writer, upload and entry screens; given desktop, then the sidebar shows the same items plus "Új felvétel" and the privacy note, and the "Új felvétel" button is hidden on Home and on the recorder.
- **AC-10** Given an entry created at 2026-11-26 23:30 UTC with `entry_date` 2026-11-27 by a user in Europe/Budapest, then it shows under November 27 at 00:30; after the user switches their time zone to UTC, it still shows under November 27, at 23:30.
- **AC-11** Given entries of user A and user B, then A's timeline and A's today list never contain B's entries, and a cursor taken from B's list returns only A's entries for A.
- **AC-12** Given Home, the timeline (with all badges and the loading state), the empty states and the desktop split view, then axe reports no violations on mobile and desktop, light and dark.

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | | order of a seeded mix | | seed script with fixed timestamps |
| AC-2 | day label formatter, `hu` + `en`, year rule | | | headings on seeded data | Playwright `clock.setFixedTime`, `timezoneId` |
| AC-3 | excerpt builder (Markdown stripped, fallbacks), duration format | card icon + text | item fields | | entries: text only, voice only, both, voice with no transcript |
| AC-4 | badge precedence | | badge field per status mix | transcribing badge turns into excerpt when the fake finishes | fake transcriber with a hold |
| AC-5 | cursor encode / decode | | 75 entries, 3 pages, insert + delete between pages | scroll loads more | |
| AC-6 | | empty states | | fresh account | |
| AC-7 | | | | mobile: open + back keeps scroll; desktop 1280: split + `aria-current` | |
| AC-8 | | Home sections | `?date=` returns today only | Home shows today's entries, not yesterday's | fixed clock around midnight |
| AC-9 | | nav item visibility per route | | tab bar / sidebar on 390 and 1280 | |
| AC-10 | | | | time zone switch re-renders time, day unchanged | |
| AC-11 | | | both list endpoints with two users, foreign cursor | | |
| AC-12 | | | | axe on each state | `emulateMedia({ colorScheme })` |

Also covered: both languages, mobile + desktop, screenshots of `home`, `timeline`, desktop `entry`.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `nav.today` / `.timeline` / `.search` / `.settings` | Ma / Idővonal / Keresés / Beállítások | Today / Timeline / Search / Settings |
| `timeline.title` | Idővonal | Timeline |
| `timeline.loadingMore` | További bejegyzések betöltése… | Loading more entries… |
| `timeline.empty` | Még nincs bejegyzésed. A Ma oldalon felvehetsz vagy írhatsz egyet. | No entries yet. Record or write one on the Today page. |
| `entry.noText` | Hangfelvétel, szöveg nélkül | Recording, no text |
| `badge.working` / `.off` / `.failed` | Átírás folyamatban / Nincs átírva / Nem sikerült | Transcribing / Not transcribed / Failed |
| `home.todayEntries` / `.todayEmpty` | Mai bejegyzések / Ma még nincs bejegyzés. | Today's entries / No entries today yet. |
| `home.greeting.*` | Jó estét. Mi járt a fejedben? (and the other variants) | Good evening. What's on your mind? (and the other variants) |
| `a11y.icon.voice` / `.text` | Hangfelvétel / Szöveges bejegyzés | Voice entry / Text entry |

Day and date formats come from `Intl.DateTimeFormat` with the UI language, no hand-written month names.

## Privacy & data
- Reads only. Excerpts are built on the server for the signed-in user. Nothing is logged about content (spec 007).

## Open questions
None.
