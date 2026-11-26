# 006 Settings + HU/EN UI

Status: draft
Milestone: M1

## Why
Each user picks their UI language, the default language of their recordings and their time zone, and the whole app
works in Hungarian and English.

## Scope
In (screen names from `design/alkony/m1.html`):
- **Settings** (`settings`): "Személyes" (UI language, default entry language, time zone), "Fiók" (signed-in email,
  "Kijelentkezés" from spec 001). The "Rendszergazda" section is spec 003. Changes save right away, no save button.
- **HU/EN UI**: react-i18next, catalogues in `packages/shared`, every user-facing string through i18n, dates and times via
  `Intl` in the UI language, `<html lang>` follows the UI language. Before login the browser language is used.
- **Theme**: follows the system light / dark setting, no theme setting (design.md).
- API: `GET /api/v1/me` (email, isAdmin, settings), `PATCH /api/v1/me/settings` (`uiLanguage`, `entryLanguage`, `timeZone`).
  Columns on `users` (architecture.md, "M1 data model").

Out (not now): changing email or password, more languages, a theme switch, per-device settings.

## Acceptance criteria

- **AC-1** Given Settings, when the user switches "A felület nyelve" to English, then the whole UI switches without a reload, `<html lang>` becomes `en`, and after a reload (or on another browser) it is still English.
- **AC-2** Given Settings, when the user picks a default entry language (Magyar / English / Automatikus), then it is saved and used for new recordings and as the default on the upload screen.
- **AC-3** Given the time zone select, then it lists the IANA zones from `Intl.supportedValuesOf('timeZone')` with their UTC offset; picking one saves it and times and "today" follow it at once; the API rejects an unknown zone with 400 `invalid_time_zone`.
- **AC-4** Given a settings change that fails to save, then the control goes back to the saved value and an error shows.
- **AC-5** Given the catalogues, then every key exists in both `hu` and `en`, no value is empty, and both have the same `{{placeholders}}`.
- **AC-6** Given the UI language is English, when every M1 screen state is opened, then no text on the page matches a Hungarian catalogue value that differs from its English one (and the other way round).
- **AC-7** Given a date and time, then they are formatted with the UI language (`hu`: "2026. november 26., csütörtök", 21:30; `en`: "Thursday, November 26, 2026", 9:30 PM).
- **AC-8** Given no session, then setup step 1 and login render in the browser language (`hu` if `navigator.language` starts with `hu`, otherwise `en`).
- **AC-9** Given the system prefers dark (or light), then the app uses the dark (or light) tokens, and there is no theme setting.
- **AC-10** Given Hungarian UI at 390 px wide, when every M1 screen state is opened, then the page has no horizontal scroll (long Hungarian labels wrap).
- **AC-11** Given users A and B, when A changes a setting, then only A's row changes, and `GET /api/v1/me` for B shows B's own values.
- **AC-12** Given Settings (personal and account sections), then axe reports no violations on mobile and desktop, light and dark, in both languages.

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | language switch re-renders | `PATCH uiLanguage` persists | switch → reload → still `en`, `html[lang]` | |
| AC-2 | | upload screen default follows setting | value saved | change to `en` → new recording has language `en` | |
| AC-3 | offset label for a zone | | 400 for `Mars/Base` | change zone → card times change | fixed clock |
| AC-4 | | API mocked to fail → value restored + error | | | |
| AC-5 | catalogue completeness + placeholders | | | | extends the existing i18n test |
| AC-6 | | | | walk all screen states in `en` and in `hu`, compare page text with the other catalogue | strings equal in both languages (e.g. "Nightjar", "English") are skipped |
| AC-7 | date / time formatters | | | | `Intl`, fixed clock and zone |
| AC-8 | | | | Playwright `locale: 'hu-HU'` and `'en-US'` on login | |
| AC-9 | | | | `emulateMedia({ colorScheme })` + screenshot per theme | |
| AC-10 | | | | `scrollWidth <= clientWidth` on each state at 390 | |
| AC-11 | | | two users | | |
| AC-12 | | | | axe | |

Also covered: screenshots of `settings` in both languages and themes.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `settings.title` | Beállítások | Settings |
| `settings.personal` / `.account` | Személyes / Fiók | Personal / Account |
| `settings.uiLanguage` | A felület nyelve | App language |
| `settings.entryLanguage` / `.entryLanguageHint` | Alapértelmezett nyelv a felvételekhez / Bejegyzésenként felülírhatod. | Default language for recordings / You can change it per entry. |
| `settings.timeZone` | Időzóna | Time zone |
| `settings.saveFailed` | Nem sikerült menteni a beállítást. | Couldn't save the setting. |
| `error.invalid_time_zone` | Ismeretlen időzóna. | Unknown time zone. |

The hint "Bejegyzésenként felülírhatod." is only true for uploads in M1 (the recorder has no language choice yet, question 4).

## Privacy & data
- Stored: three columns on the user's own row. Nothing leaves the server.

## Open questions
- Make the app installable (PWA manifest + cached app shell) in M1? See m1-summary, question 12.
