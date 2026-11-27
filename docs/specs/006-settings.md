# 006 Settings + HU/EN UI

Status: done
Milestone: M1

## Why
Each user picks their UI language, the default language of their recordings and their time zone, and the whole app
works in Hungarian and English.

## Scope
In (screen names from `design/alkony/m1.html`):
- **Settings** (`settings`): "Személyes" (UI language, default entry language, time zone), "Fiók" (name "Hogyan szólíthatunk?" you can edit, the signed-in
  username, "Kijelentkezés" from spec 001). The "Rendszergazda" section is spec 003. Changes save right away, no save button.
- **HU/EN UI**: react-i18next, catalogues in `packages/shared`, every user-facing string through i18n, dates and times via
  `Intl` in the UI language, `<html lang>` follows the UI language. Before login the browser language is used.
- **Theme**: follows the system light / dark setting, no theme setting (design.md).
- **Installable app** (D-30 Q12): `vite-plugin-pwa` manifest, icons and a service worker that caches the app shell
  (static files) only. API responses and audio are never cached. The offline recording queue stays in M4.
- **Defaults** (D-31): English is the default UI language; the default recording language follows the UI language.
- API: `GET /api/v1/me` (username, name, isAdmin, settings), `PATCH /api/v1/me/settings` (`uiLanguage`, `entryLanguage`, `timeZone`, `name`).
  Columns on `users` (architecture.md, "M1 data model").

Out (not now): changing the username or password, more languages, a theme switch, per-device settings, offline use of journal data.

## Acceptance criteria

- **AC-1** Given Settings, when the user switches "A felület nyelve" to the other language (English to Magyar and back), then the whole UI switches without a reload, `<html lang>` follows, and after a reload (or on another browser) it is still the chosen language.
- **AC-2** Given Settings, when the user picks a default entry language (Magyar / English / Automatikus), then it is saved and used for new recordings and as the default on the upload screen.
- **AC-3** Given the time zone select, then it lists the IANA zones from `Intl.supportedValuesOf('timeZone')` with their UTC offset; picking one saves it and times and "today" follow it at once; the API rejects an unknown zone with 400 `invalid_time_zone`.
- **AC-4** Given a settings change that fails to save, then the control goes back to the saved value and an error shows.
- **AC-5** Given the catalogues, then every key exists in both `hu` and `en`, no value is empty, and both have the same `{{placeholders}}`.
- **AC-6** Given the UI language is English, when every M1 screen state is opened, then no text on the page matches a Hungarian catalogue value that differs from its English one (and the other way round).
- **AC-7** Given a date and time, then they are formatted with the UI language (`hu`: "2026. november 26., csütörtök", 21:30; `en`: "Thursday, November 26, 2026", 9:30 PM).
- **AC-8** Given no session, then setup step 1 renders in English, and login renders in the browser language (`hu` if `navigator.language` starts with `hu`, otherwise `en`).
- **AC-9** Given the system prefers dark (or light), then the app uses the dark (or light) tokens, and there is no theme setting.
- **AC-10** Given Hungarian UI at 390 px wide, when every M1 screen state is opened, then the page has no horizontal scroll, nothing outside the viewport and no overlapping controls (long Hungarian labels wrap). Also checked at 1280 px.
- **AC-11** Given users A and B, when A changes a setting, then only A's row changes, and `GET /api/v1/me` for B shows B's own values.
- **AC-12** Given Settings (personal and account sections), then axe reports no violations on mobile and desktop, light and dark, in both languages.
- **AC-13** Given a user created without a language choice, then `ui_language` is `en` and `entry_language` equals `ui_language`; after the setup wizard picked Magyar, both are `hu`.
- **AC-14** Given the built app, then `/manifest.webmanifest` is served with name "Nightjar", `display: standalone`, `start_url: /`, theme and background colours from the design tokens, and 192 px, 512 px and maskable PNG icons that exist; the page links the manifest and a service worker registers.
- **AC-15** Given the app was opened once and the browser goes offline, when the user reloads, then the app shell loads from the cache (the login or the app frame shows, not a browser error page); no `/api/v1` response and no audio file is ever stored in the cache.
- **AC-16** Given the Account section, when the user changes the name and leaves the field (or presses Enter), then it is saved (1 to 60 characters after trimming), `GET /api/v1/me` returns it and the Home greeting uses it after a reload; an empty or too long name shows an error, sends nothing, and the API answers 400; a failed save puts the saved name back and shows an error; the username cannot be changed here and other users keep their own names.

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
| AC-8 | | | | Playwright `locale: 'hu-HU'` and `'en-US'`: setup step 1 English in both; login `hu` / `en` | |
| AC-9 | | | | `emulateMedia({ colorScheme })` + screenshot per theme | |
| AC-10 | | | | `expectLayout` on each state at 390 and 1280 | |
| AC-11 | | | two users | | |
| AC-12 | | | | axe | |
| AC-13 | default resolver | | DB defaults for a user inserted without languages; setup with Magyar → both `hu` | | |
| AC-14 | manifest JSON shape | | built `dist` served: manifest, icon files exist | Chromium: manifest link present, `navigator.serviceWorker.ready` resolves | production build via `vite preview` |
| AC-15 | | | | load, `context.setOffline(true)`, reload → shell shows; Cache Storage holds no `/api/` or audio entries | Chromium only |
| AC-16 | | name saves on blur, empty name error, unchanged sends nothing, failed save restores | `PATCH name` trims, 400 for empty / 61 characters / `username`, other user untouched | rename → reload → greeting shows it | |

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
| `field.name` (label of the name field) | Hogyan szólíthatunk? | What should we call you? |
| `settings.saveFailed` | Nem sikerült menteni a beállítást. | Couldn't save the setting. |
| `error.invalid_time_zone` | Ismeretlen időzóna. | Unknown time zone. |

The hint "Bejegyzésenként felülírhatod." is only true for uploads in M1 (the recorder uses the default language, D-30 Q4).

## Privacy & data
- Stored: three columns and the name on the user's own row. Nothing leaves the server.
- The service worker caches only static app files, never journal data or audio.

## Open questions
None.
