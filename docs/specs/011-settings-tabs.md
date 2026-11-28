# 011 Settings tabs, appearance, change password

Status: draft
<!-- draft until the owner answers O-11, O-12 and O-14 in decisions.md. Places that use a recommended answer say "(assumed, waiting for owner)". -->
Milestone: 0.5

## Why
Settings got too long for one page, the owner wants a light / dark switch instead of only following the system, and
every user needs to change their own password now that an admin can create accounts (D-61, D-62, D-63).

## Scope
In (mockups: `design/alkony/011-settings-users.html`, screens `general`, `generalen`, `basic`, `transcription`, `account`,
`accounterr`, `accountok`; screenshots in `design/alkony/screenshots/011/`):
- **Tabs.** Settings has four tabs at the top of the page, on phone and desktop: Általános (General), Átírás
  (Transcription), Felhasználók (Users), Fiók (Account). Each tab has its own URL: `/settings/general`,
  `/settings/transcription`, `/settings/users`, `/settings/account`. `/settings` opens General. The bottom tab bar and the
  sidebar keep "Beállítások" current on every tab.
- **Who sees what.** Admins see all four tabs. A basic user sees General and Account only; opening an admin tab URL sends
  them to `/settings/general`.
- **General:** UI language, Megjelenés (appearance, new), default entry language, time zone (moved from "Személyes").
  For a basic user, one read-only line at the end says where transcription runs (assumed, waiting for owner: O-14).
- **Appearance:** Rendszer (System, default) / Világos (Light) / Sötét (Dark), a 3-way segmented control like the
  language ones, with the hint "A Rendszer a készüléked beállítását követi." Saved per user, applied at once (no reload),
  no flash of the wrong theme when the app loads.
- **Transcription:** the "Rendszergazda" section of spec 010 moves here as it is (switch, engine list, backlog
  question). The "Rendszergazda" heading goes away.
- **Users:** spec 012.
- **Account:** name ("Hogyan szólíthatunk?", as spec 006 AC-16), username (read-only) with "Kijelentkezés", and
  "Jelszó módosítása": current password, new password, new password again, button "Jelszó módosítása".
- API: `PATCH /api/v1/me/settings` accepts `theme`; `GET /api/v1/me` returns it; new `POST /api/v1/me/password`.

Out (not now): more themes or an accent colour, per-device appearance (the setting is per user), password reset by
email, password strength meters, changing the username (O-9), a sessions list.

This spec replaces spec 006's "no theme setting" (Scope "Theme", AC-9) and its "Személyes" / "Fiók" sections.

## Flows

```
/settings ──► /settings/general
tab click ──► URL changes (pushState), content swaps, focus stays on the tab link
basic user on /settings/transcription or /settings/users ──► replace with /settings/general

Appearance: pick ──► <html data-theme> changes at once ──► localStorage cache ──► PATCH theme
                                                       \── PATCH fails ──► previous value back + error
Page load: /theme-boot.js (blocking, in <head>) reads the cache ──► sets data-theme before first paint
           GET /me arrives ──► server value wins, cache updated

Change password: current + new + again ──► POST /me/password
   ok ──► "A jelszavad megváltozott.", fields cleared, other sessions ended (assumed, O-12)
   wrong current ──► error under "Jelenlegi jelszó"
```

## Server behaviour

- `users.theme` text not null default `'system'`, one of `system`, `light`, `dark` (migration `0012_user_theme`).
- `settingsPatchSchema` gets `theme: z.enum(['system', 'light', 'dark'])`; `meResponseSchema` gets `theme`.
- `POST /api/v1/me/password` body `{ currentPassword, newPassword }` (`newPassword` 8 to 128 characters, same rule as
  setup). It calls Better Auth's `changePassword` (installed 1.7.28, `auth.api.changePassword`) with
  `revokeOtherSessions: true` (assumed, waiting for owner: O-12), which checks the current password with our Argon2id
  verify, stores the new hash and ends every other session of that user; the current browser gets a fresh session cookie
  and stays signed in. Better Auth's own `/change-password` HTTP route stays unexposed (only our route is registered).
- Answers: 204 on success; 400 `invalid_request` for a bad body; 400 `wrong_current_password` when the current password
  does not match; 429 `too_many_attempts` after 10 tries per minute per IP (same limit as sign-in, it is a password check).
- Live updates: a session that is ended this way gets 401 on its next request (no session cookie cache is configured,
  so this is immediate); its open `/api/v1/events` stream is closed by the server.
- Transcription line for basic users: `GET /api/v1/transcription` (spec 010, any signed-in user) already returns
  `{ state, engine: { id, kind } }`; no new route.

## Web behaviour

- Routes: `/settings` redirects to `/settings/general`; `/settings/:tab` renders `SettingsPage` with the tab. Unknown tab:
  `/settings/general`. A basic user on an admin tab: replace with `/settings/general`.
- Tab strip: `<nav aria-label="Beállítások">` with one link per tab, the current one has `aria-current="page"`, accent
  underline. The strip scrolls sideways inside itself if it ever does not fit, the page never does. Tab links are at
  least 48 px tall.
- Theme tokens: `styles.css` and `voice.css` move from `@media (prefers-color-scheme: light)` to: dark tokens on `:root`;
  light tokens under `:root[data-theme="light"]` and under `@media (prefers-color-scheme: light)` for
  `:root:not([data-theme="dark"])`. `color-scheme` follows. `<meta name="theme-color">` is updated to the active `--bg`.
- `public/theme-boot.js` (a few lines, loaded with a plain blocking `<script src>` in `<head>`, allowed by the existing
  CSP `default-src 'self'`): reads `localStorage['nightjar.theme']` (`light` | `dark` | `system`, wrapped in try/catch)
  and sets `document.documentElement.dataset.theme` for light / dark, nothing for system. The app keeps the cache in sync
  with `me.theme` and on every change. Sign-out keeps the cache, so the login page matches the last user of this browser.
- Appearance control: `Segmented` (radios), label "Megjelenés", hint under it. Change: apply at once, then save like the
  other settings (optimistic, back to the old value on failure with "Nem sikerült menteni a beállítást.").
- Transcription line (basic users only, assumed, waiting for owner: O-14): read-only row in the General group, label
  "Átírás", text by state: off "Az átírás ki van kapcsolva."; local "A felvételeket a saját szervered írja át
  ({{engine}})."; cloud "A felvételeket felhőszolgáltatás írja át ({{engine}})." with the cloud icon. Engine names from the
  catalogue (`models.<id>.name` / `providers.<id>.name`).
- Account tab: the password form is a `<form>` with `autocomplete` `current-password` / `new-password` /
  `new-password`. Client checks before sending: all three filled, new at least 8 characters, the two new ones equal
  (errors as in setup: `field.error.passwordShort`, `field.error.passwordMismatch`). Server error
  `wrong_current_password` shows under the current-password field (`aria-invalid`, `aria-describedby`), focus moves
  there. Success: fields cleared, `role="status"` line "A jelszavad megváltozott.". 429 shows `login.error.tooMany`.
- Admin editing themselves in Users gets no password field there; the dialog links to this tab (spec 012, assumed,
  waiting for owner: O-11).

## Acceptance criteria

Tabs
- **AC-1** Given an admin, when they open `/settings`, then the URL becomes `/settings/general`, the tab strip shows Általános, Átírás, Felhasználók, Fiók in that order with Általános current (`aria-current="page"`), and "Beállítások" is current in the bottom tab bar (390) and the sidebar (1280).
- **AC-2** Given an admin on any tab, when they click another tab, then the URL changes to that tab's path without a reload, the content swaps, and Back returns to the previous tab; opening each tab URL directly shows that tab.
- **AC-3** Given a basic user, then the strip shows only Általános and Fiók; opening `/settings/transcription`, `/settings/users` or `/settings/nope` lands on `/settings/general` (history replaced), and the admin API routes still answer 403 for them.
- **AC-4** Given the General tab, then it shows, in order, UI language, Megjelenés, default entry language and time zone, all working as in spec 006 (AC-1 to AC-4 of 006 pass on this tab); the Transcription tab shows the spec 010 content without the "Rendszergazda" heading.

Appearance
- **AC-5** Given a new or migrated user, then `theme` is `system`; `PATCH /api/v1/me/settings` with `theme` `light`, `dark` or `system` saves it and `GET /api/v1/me` returns it; any other value answers 400 and changes nothing; user B's theme is not touched.
- **AC-6** Given the system prefers dark, when the user picks Világos, then without a reload the page uses the light tokens (`html[data-theme="light"]`, body background `#f7f2fb`) and `theme-color` matches; Sötét with the system on light gives the dark tokens; Rendszer follows `prefers-color-scheme` again, also when it changes while the page is open.
- **AC-7** Given a saved theme of `light` and a system preference of dark, when the app is loaded fresh (also on the login page after sign-out), then the first paint already uses the light tokens: the `<html>` element has `data-theme="light"` before the app script runs, and no frame with the dark background is captured.
- **AC-8** Given a theme saved on another device, when this browser loads the app with an old cached value, then `GET /me` wins: the page switches to the saved theme and the cache is updated; given `localStorage` throws or holds junk, then the app falls back to the system theme without errors.
- **AC-9** Given the theme save fails, then the control and the page go back to the previous theme and "Nem sikerült menteni a beállítást." shows.

Change password
- **AC-10** Given the Account tab, then it shows the name field, the username read-only with "Kijelentkezés", and "Jelszó módosítása" with three password fields (`current-password`, `new-password`, `new-password`) and the button.
- **AC-11** Given the right current password and a new one of 8 to 128 characters typed twice, when the user presses "Jelszó módosítása", then the API answers 204, the stored hash changes (Argon2id, old password no longer signs in, new one does), the fields clear and "A jelszavad megváltozott." shows.
- **AC-12** Given a wrong current password, then the API answers 400 `wrong_current_password`, nothing changes, and the error "A jelenlegi jelszó nem jó." shows under that field with focus on it.
- **AC-13** Given an empty field, a new password under 8 characters or two new passwords that differ, then the form shows the field error and sends nothing; given the same cases sent straight to the API (or a new password over 128 characters), then it answers 400 `invalid_request`.
- **AC-14** Given the user is signed in on two browsers, when they change their password in one, then that one stays signed in and the other gets 401 on its next request and shows login; its live-updates stream is closed (assumed, waiting for owner: O-12).
- **AC-15** Given 10 password-change attempts from one IP within a minute, when an 11th is sent, then it answers 429 and the form shows "Túl sok próbálkozás. Várj egy percet, és próbáld újra."; Better Auth's own `/api/v1/auth/change-password` route answers 404.

Basic user transcription line (assumed, waiting for owner: O-14)
- **AC-16** Given a basic user, then General ends with a read-only "Átírás" row: off "Az átírás ki van kapcsolva."; Turbo active "A felvételeket a saját szervered írja át (Turbo)."; Soniox active "A felvételeket felhőszolgáltatás írja át (Soniox)." with a cloud icon; it updates without a reload when the admin switches engine. An admin does not see this row.

Quality
- **AC-17** Given every tab state of this spec (general for admin and basic user, account, account with an error, account done) in `hu` and `en`, at 390 and 1280, light and dark, then axe reports no violations and the layout checks pass (no sideways page scroll, nothing clipped or overlapping, the tab strip fits at 390 in both languages).
- **AC-18** Given the flows of this spec run with marker text in the passwords and the name, then the marker appears nowhere in the captured logs (spec 007 helper), and no response contains a password or hash.

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | redirect `/settings` → general, tab order, `aria-current` | | admin opens Settings at 390 and 1280 | |
| AC-2 | | tab click changes route, Back works | | deep link to each tab | |
| AC-3 | | basic user: 2 tabs, admin paths replaced | admin routes 403 for a basic user | basic user deep links | second user made through spec 012 API in the fixture |
| AC-4 | | General order; 006 settings tests moved to the tab | | | existing 006 and 010 tests keep passing on the new paths |
| AC-5 | schema accepts the 3 values only | | default `system` after migration, PATCH + GET, 400 for `blue`, other user untouched | | migration on a 0.4.0 DB in the upgrade test |
| AC-6 | | `data-theme` set on pick | | `emulateMedia({ colorScheme })` both ways, read computed `background-color` of `body`, change the emulated scheme while on Rendszer | |
| AC-7 | `theme-boot.js` sets the attribute from each cached value | | | new page with cached `light` under dark scheme: `page.addInitScript` records `data-theme` and body background at `DOMContentLoaded`, before the module script | also on `/login` after sign-out |
| AC-8 | boot script with junk and with throwing `localStorage` | `me.theme` overrides the cache | | | |
| AC-9 | | API mocked to fail → old theme back + error | | | |
| AC-10 | | Account tab fields, autocomplete attributes | | | |
| AC-11 | | | 204, hash changed, old password 401 on sign-in, new one works | change password → sign out → sign in with the new one | |
| AC-12 | | error under the field, focus | 400 `wrong_current_password`, hash unchanged | | |
| AC-13 | form rules | each client error, nothing sent | 400 for short, 129 characters, missing fields | | |
| AC-14 | | | two sessions: other one 401 after the change, current one 200; events stream of the other closes | two browser contexts | |
| AC-15 | | 429 → message | 11th attempt 429; `/api/v1/auth/change-password` 404 | | real limit, per test IP |
| AC-16 | text per state | row only for basic users | | engine switch by admin updates a basic user's open page | fake transcriber, provider fixture from spec 010 |
| AC-17 | | | | axe + `expectLayout` on each state, both languages and themes | |
| AC-18 | | | marker in passwords and name, log capture | | `apps/server/test/support/log-capture.ts` |

Also covered: both languages on every new string, the i18n completeness test (spec 006 AC-5).

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `settings.tabs.label` | Beállítások | Settings |
| `settings.tabs.general` / `.transcription` / `.users` / `.account` | Általános / Átírás / Felhasználók / Fiók | General / Transcription / Users / Account |
| `settings.theme` | Megjelenés | Appearance |
| `settings.themes.system` / `.light` / `.dark` | Rendszer / Világos / Sötét | System / Light / Dark |
| `settings.themeHint` | A Rendszer a készüléked beállítását követi. | System follows your device setting. |
| `settings.transcriptionInfo.label` | Átírás | Transcription |
| `settings.transcriptionInfo.off` | Az átírás ki van kapcsolva. | Transcription is off. |
| `settings.transcriptionInfo.local` | A felvételeket a saját szervered írja át ({{engine}}). | Recordings are transcribed on your own server ({{engine}}). |
| `settings.transcriptionInfo.cloud` | A felvételeket felhőszolgáltatás írja át ({{engine}}). | Recordings are transcribed by a cloud service ({{engine}}). |
| `settings.password.title` | Jelszó módosítása | Change password |
| `settings.password.current` / `.new` / `.again` | Jelenlegi jelszó / Új jelszó / Új jelszó újra | Current password / New password / New password again |
| `settings.password.hint` | Legalább 8 karakter. | At least 8 characters. |
| `settings.password.submit` | Jelszó módosítása | Change password |
| `settings.password.done` | A jelszavad megváltozott. | Your password has been changed. |
| `error.wrong_current_password` | A jelenlegi jelszó nem jó. | The current password is wrong. |

Removed: `settings.personal`, `settings.admin` (the tabs replace the headings).

## Privacy & data
- Stored: `users.theme`; the new password hash in `accounts` (Argon2id, as setup). The theme is also cached in the
  browser's `localStorage` (one word, no personal data).
- Logs never contain passwords, hashes, usernames or names; a failed password check logs nothing but the route's status.
- Nothing leaves the server.

## Open questions
O-11, O-12, O-14 in `decisions.md` (this spec uses the recommended answers, marked "assumed, waiting for owner").
