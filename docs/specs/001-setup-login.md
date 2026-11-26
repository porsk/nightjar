# 001 Setup wizard + login

Status: done
Milestone: M1

## Why
The owner needs a first account on a fresh install, and the journal must stay private behind a login.

## Scope
In:
- Setup wizard, 3 steps (mockups `setup1`, `setup2`, `setup3`, `setup3on` in `design/alkony/m1.html`):
  1. account: setup code, email, password, password again
  2. UI language (English / Magyar, English preselected, D-31) + time zone prefilled from the browser
  3. transcription: "Most nem" (default) or "Átírás bekapcsolása" (download starts after setup, progress in Settings, spec 003)
- The wizard starts in English; picking Magyar on step 2 switches it.
- The first account is the admin. Its `entry_language` starts equal to the chosen UI language.
- Setup code (D-30 Q1): on start, while no account exists, the server prints a random one-time code to the container log
  (`docker compose logs nightjar`). Step 1 asks for it. It stops working once the first account exists.
- Login (`login`, `loginerr`), logout (button in Settings > Fiók), redirect to login when the session is gone.
- Rate limit on login.
- API: `GET /api/v1/setup` (`{ needed }`), `POST /api/v1/setup` (needs `setupCode`; creates the admin, settings, transcription flag, signs in),
  Better Auth routes for sign-in / sign-out / session. Data model: `users`, `instance_settings` (architecture.md, "M1 data model").

Out (not now): more accounts or sign-up, password change or reset, OAuth, passkeys, email verification, user management.

## Acceptance criteria

- **AC-1** Given an empty database, when anyone opens any app URL, then they land on setup step 1, and the login page is not reachable.
- **AC-2** Given setup step 1, when the setup code is empty, the email is not valid, the password is shorter than 8 characters, or the two passwords differ, then that field shows an error and "Tovább" stays on step 1.
- **AC-3** Given setup step 2, then the wizard is in English whatever the browser language, the UI language is preselected as English and the time zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`; picking Magyar re-renders the wizard in Hungarian right away.
- **AC-4** Given the wizard finished with "Most nem", then exactly one user exists with `is_admin = true`, the chosen `ui_language` and `time_zone`, `entry_language` equal to `ui_language`, `instance_settings.transcription_enabled = false`, and the browser is signed in and on Home.
- **AC-5** Given the wizard finished with "Átírás bekapcsolása", then `transcription_enabled = true` and the model download has started (Settings shows the progress state from spec 003).
- **AC-6** Given a user already exists, when `POST /api/v1/setup` is called, then it answers 409 `setup_done` and creates nothing; opening `/setup` in the browser redirects to login.
- **AC-7** Given an empty database, when two setup requests arrive at the same time, then exactly one succeeds and the other gets 409.
- **AC-8** Given any state, when Better Auth's own sign-up endpoint is called, then it answers 403 and creates no user.
- **AC-9** Given the admin account, when the correct email and password are submitted on the login screen, then the user lands on Home and the session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when served over https.
- **AC-10** Given a wrong password or an unknown email, then the login screen shows the same alert ("Hibás e-mail cím vagy jelszó…", `role="alert"`) and the API returns the same error code and status for both cases.
- **AC-11** Given 10 failed logins from one IP within a minute, when an 11th is tried, then the API answers 429 and the login screen shows a "too many attempts, wait a minute" message.
- **AC-12** Given a signed-in user, when they press "Kijelentkezés" in Settings, then the session is deleted on the server, the browser shows the login screen, and the old cookie gets 401 from the API.
- **AC-13** Given no valid session, when the browser opens an app page or calls any `/api/v1` route except setup, sign-in, `/healthz` and `/readyz`, then the API answers 401 and the UI shows login; after signing in, the user lands on the page they asked for.
- **AC-14** Given an account was created, then the stored password is an Argon2id hash (`$argon2id$…`) and the plain password appears nowhere in the database.
- **AC-15** Given the setup steps (including `setup3on`) and login (including the error state), then axe reports no violations on mobile (390) and desktop (1280), light and dark.
- **AC-16** Given an empty database, when the server starts, then it logs one line with a random setup code (8 characters); given at least one user, then no setup code is generated or logged.
- **AC-17** Given an empty database, when `POST /api/v1/setup` has a missing or wrong `setupCode`, then it answers 403 `invalid_setup_code`, creates nothing, and step 1 shows "Hibás telepítési kód." next to the code field; the right code works.
- **AC-18** Given the first account was created with the right code, when the same code is sent again, then it answers 409 `setup_done` and creates nothing; a restart with a user prints no code.
- **AC-19** Given the flows of this spec (setup, login, wrong password, logout) run in a test with marker text (like `ZQX-PRIVATE-7781`) in every field and file name, then the marker appears nowhere in the captured log output (helper `apps/server/test/support/log-capture.ts`, spec 007).

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | | `GET /setup` says needed on empty DB | fresh DB: `/`, `/timeline`, `/login` all show step 1 | |
| AC-2 | email / password / code Zod schema | step 1 shows one error per bad field, stays on step | | | 7 vs 8 chars, mismatch, `a@b`, empty code |
| AC-3 | | switching language re-renders step 2 | | Playwright `locale: 'hu-HU'` and `'en-US'` both start in English, `timezoneId: 'Europe/Budapest'` | |
| AC-4 | | | DB row after setup | full wizard → Home, both languages | fake transcriber; the e2e helper reads the setup code from the captured server log |
| AC-5 | | | flag true, download job started | wizard with transcription on → Settings shows progress | test model server (spec 003) |
| AC-6 | | | 409 `setup_done` | `/setup` after setup → login | |
| AC-7 | | | two parallel `POST /setup` → one 200, one 409, one user | | |
| AC-8 | | | sign-up route → 403, no row | | |
| AC-9 | | | cookie flags in `Set-Cookie` | login → Home | `Secure` checked with `x-forwarded-proto: https` and trust proxy on |
| AC-10 | | alert rendered with `role="alert"` | same status + code for both | wrong password shows alert | |
| AC-11 | | 429 → message | 11th attempt → 429 | | real limit (10 per minute per IP), counted per test IP |
| AC-12 | | | session row gone, old cookie → 401 | logout → login screen | |
| AC-13 | | | each protected route → 401 | deep link `/timeline` → login → `/timeline` | public routes listed in the AC |
| AC-14 | | | hash prefix, plain text not in any column | | |
| AC-15 | | | | axe on each screen state | `emulateMedia({ colorScheme })` |
| AC-16 | | | captured log stream: one line with an 8-character code on an empty DB, none with a user | | log capture as in spec 007 |
| AC-17 | | code error shown | missing / wrong code → 403, no rows; right code → 200 | wrong code on step 1 → error → right code works | |
| AC-18 | | | second request with the used code → 409; restart with a user → no code logged | | |
| AC-19 | | | marker through this spec's flows, assert absent from captured logs | | helper from spec 007 |

Also covered: both languages (`hu` + `en`) on every screen, mobile + desktop, Playwright screenshots of all 6 states.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `setup.step` | {{n}}. lépés a 3-ból | Step {{n}} of 3 |
| `setup.account.title` | Üdv a Nightjarban | Welcome to Nightjar |
| `setup.account.lead` | Hozd létre az első fiókot. Ezzel a fiókkal kezeled majd a szervert is. | Create the first account. You'll also use it to manage the server. |
| `setup.account.passwordAgain` | Jelszó újra | Password again |
| `setup.account.code` / `.codeHint` | Telepítési kód / A kódot a szerver naplójában találod: `docker compose logs nightjar` | Setup code / Find the code in the server log: `docker compose logs nightjar` |
| `setup.lang.title` | Nyelv és időzóna | Language and time zone |
| `setup.lang.lead` | Ezeket később a Beállításokban bármikor átállíthatod. | You can change these any time in Settings. |
| `setup.lang.tzHint` | A böngésződ alapján választottuk ki. A bejegyzések napjai ez szerint számolódnak. | Picked from your browser. Entry days are counted in this time zone. |
| `setup.transcription.title` | Szöveggé alakítsuk a felvételeket? | Turn recordings into text? |
| `setup.transcription.lead` | Az átírás a saját szervereden fut, nem megy ki semmi az internetre. | Transcription runs on your own server. Nothing goes out to the internet. |
| `setup.transcription.later` / `.laterHint` | Most nem / A felvételeket meghallgathatod, de nem lesz hozzájuk szöveg. Bármikor bekapcsolhatod a Beállításokban. | Not now / You can listen to recordings, but they won't have text. Turn it on any time in Settings. |
| `setup.transcription.on` / `.onHint` | Átírás bekapcsolása / A magyar és angol felvételekből szöveg lesz. Egyszeri, kb. {{size}} letöltés kell hozzá, ez a belépés után indul el. | Turn on transcription / Hungarian and English recordings become text. Needs a one-time download of about {{size}}, which starts after setup. |
| `setup.finish` / `setup.finishAndDownload` | Befejezés / Befejezés és letöltés indítása | Finish / Finish and start download |
| `login.title` / `login.lead` | Üdv újra. / Jelentkezz be a naplódba. | Welcome back. / Sign in to your journal. |
| `login.submit` | Belépés | Sign in |
| `login.error.invalid` | Hibás e-mail cím vagy jelszó. Ellenőrizd, és próbáld újra. | Wrong email or password. Check them and try again. |
| `login.error.tooMany` | Túl sok próbálkozás. Várj egy percet, és próbáld újra. | Too many attempts. Wait a minute and try again. |
| `auth.logout` | Kijelentkezés | Sign out |
| `field.email` / `field.password` | E-mail cím / Jelszó | Email / Password |
| `field.error.email` / `.passwordShort` / `.passwordMismatch` | Adj meg egy érvényes e-mail címet. / Legalább 8 karakter legyen. / A két jelszó nem egyezik. | Enter a valid email. / Use at least 8 characters. / The passwords don't match. |
| `field.error.code` / `error.invalid_setup_code` | Add meg a telepítési kódot. / Hibás telepítési kód. | Enter the setup code. / Wrong setup code. |
| `common.next` / `common.back` | Tovább / Vissza | Next / Back |
| `common.privacyNote` | A hang a saját szervereden marad. | Your voice stays on your own server. |

## Privacy & data
- Stored: email, Argon2id password hash, sessions (Better Auth tables), settings on the user row, the transcription flag.
- Logs never contain the email, password or session token (checked in spec 007). The one secret in the log is the setup code, and only while no account exists.
- Nothing leaves the server.

## Open questions
None. No password reset in M1 (D-30 Q11); a reset command is a backlog suggestion.
