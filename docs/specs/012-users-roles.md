# 012 Users and roles

Status: approved
Milestone: 0.5

## Why
The owner wants family members on the same install (S-14, D-63). There is no public sign-up, so an admin creates the
accounts. Each person's journal stays private, also from admins.

## Scope
In (mockups: `design/alkony/011-settings-users.html`, screens `users`, `usersen`, `usercreate`, `useredit`,
`usermakeadmin`, `userlastadmin`, `userdelete`; screenshots in `design/alkony/screenshots/011/`):
- **Settings > Felhasználók** (`/settings/users`, admin only, tab from spec 011): the line "Új fiókot csak rendszergazda
  hozhat létre, nyilvános regisztráció nincs.", button "Új felhasználó", the list, and two rule lines under it ("Mindenki
  csak a saját bejegyzéseit látja. A rendszergazdák sem olvashatják másokét." / "Mindig marad legalább egy
  rendszergazda.").
- **List:** every user with name (plus a "Te" chip on your own row), username, role ("Rendszergazda" / "Felhasználó"),
  created date. Phone: one card row per user; desktop: a table-like grid with column heads. Oldest first. A row opens
  the edit dialog.
- **Create:** name, username, role (Felhasználó default / Rendszergazda), starting password set by the admin. The user
  is not forced to change it.
- **Edit:** name, username shown read-only (O-9), role, "Új jelszó beállítása" (opens a
  password field), "Felhasználó törlése". Your own row: no password field, a link to the Account tab instead (O-11).
- **Delete:** confirm dialog, unlocked by typing the username. Deletes the user and everything they own: entries,
  recordings, transcripts, audio files, settings, sessions, and any copy still at a cloud provider (spec 010 cleanup).
- **Rules:** there is always at least one admin. Nobody can remove the admin role from the last admin or delete them;
  the UI shows the control disabled with the reason. An admin can't delete themselves from Users (O-10) and can remove their own admin role only while another admin exists (O-10).
- **Privacy:** admins can't read other users' entries anywhere. No "view as", no impersonation, no counts or activity
  of other users. Every admin route is checked on the server.
- **Password reset by an admin** ends all of that user's sessions (O-12).
- API: `GET/POST /api/v1/admin/users`, `PATCH/DELETE /api/v1/admin/users/:id`.

Out (not now): public sign-up or invites, email, forcing a password change at next sign-in, disabling (banning) an
- **Transcript label by role** (D-68): on the recording card meta row an admin sees the engine as today (chip
  icon + model name, or cloud icon + provider name). A basic user sees only where it ran: chip icon + "Helyi" or cloud
  icon + "Felhő". The provider is still named for basic users in Settings > General (spec 011), so they know who
  receives their audio. This is display only; the API is unchanged.
account, roles other than user / admin, per-journal sharing between users, an audit log screen, changing usernames
(O-9), bulk actions, showing another user's storage use or entry count.

## Better Auth: plugin or own routes

The installed `better-auth` 1.7.28 ships an `admin` plugin (`/admin/create-user`, `/set-role`, `/set-user-password`,
`/remove-user`, `/list-users`, `/ban-user`, `/impersonate-user`, …). It is **not used**:
- it needs new columns (`users.role`, `banned`, `ban_reason`, `ban_expires`, `sessions.impersonated_by`) next to our
  `is_admin`, so two sources of truth or a migration of every admin check;
- it brings impersonation, which this spec forbids, and HTTP routes we would have to block one by one (today only
  sign-in, sign-out and get-session are exposed, D-36);
- it has no last-admin rule and no typed-username confirm, so our own checks are needed anyway.

Instead: four routes of our own over `users.is_admin`, doing what setup already does (insert the user and a
`credential` account with our Argon2id `hashPassword`, spec 001). Sessions are rows in `sessions`, so ending them is a
delete. No new auth dependency, no new columns.

## Flows

```
Settings > Felhasználók (admin)
  Új felhasználó ──► dialog [name, username, role, starting password] ──Létrehozás──► row added
                                                                     \─ username taken ──► error under the field
  row ──► edit dialog
           [name] [role: Felhasználó | Rendszergazda] [Új jelszó beállítása ──► password field]
           Mentés ──► saved; a new password ends that user's sessions (O-12)
           Felhasználó törlése ──► confirm [type username] ──Végleges törlés──► user and all their data gone
  own row ──► edit dialog: password ──► "use the Fiók tab" link; delete disabled (O-10, O-11)
                           last admin: role locked + reason; delete locked + reason
```

## Server behaviour

Routes (all need a session and `is_admin`, read fresh from the database on each request: 401 without a session, 403
`forbidden` for a basic user):

| Route | Body | Answer |
|---|---|---|
| `GET /api/v1/admin/users` | | `{ users: [{ id, name, username, isAdmin, createdAt }] }`, oldest first. Nothing else about other users |
| `POST /api/v1/admin/users` | `{ name, username, isAdmin, password }` | 201 with the user. 409 `username_taken` |
| `PATCH /api/v1/admin/users/:id` | any of `{ name, isAdmin, password }` | 200 with the user. 409 `last_admin`; 400 `use_account_password` for your own id with `password` (O-11); 404 `user_not_found` |
| `DELETE /api/v1/admin/users/:id` | `{ confirmUsername }` | 204. 400 `confirmation_mismatch`; 409 `cannot_delete_self` (O-10); 409 `last_admin`; 404 `user_not_found` |

- Validation: `nameSchema`, `usernameSchema` (trimmed, lowercased, 3 to 32 of `a-z 0-9 . - _`), password 8 to 128
  characters, `isAdmin` boolean, strict objects (unknown keys 400 `invalid_request`). `username` is not accepted by PATCH
  (O-9).
- New user defaults: `ui_language` and `entry_language` `en` (D-31), `time_zone` copied from the admin who creates it,
  `theme` `system`. The user changes them in General.
- **Last-admin rule:** every role change and delete runs in one transaction that first takes
  `pg_advisory_xact_lock(<users lock key>)`, then counts admins. Removing the role from, or deleting, the only admin
  answers 409 `last_admin`. Two admins demoting each other at the same time: one succeeds, the other gets 409.
- **Delete:** `confirmUsername` must equal the target's username (trimmed, lowercased) or 400. In the transaction:
  delete the `users` row; the existing foreign keys remove sessions, accounts, entries, recordings and transcripts, and
  set `cloud_copies.user_id` / `recording_id` to null so the spec 010 cleanup still deletes those vendor copies. After
  the commit: remove the storage prefix `media/<userId>/`. A server start removes any `media/<id>/` folder whose user
  no longer exists (covers a crash between commit and file removal).
- **Jobs of a deleted user:** a queued transcription job whose recording is gone finishes as a no-op (no retry, no
  error-level log). A running job that finds its recording gone when it saves drops the result; a cloud job still
  deletes its vendor copies after the attempt (spec 010 AC-18).
- **Sessions:** a password reset by an admin deletes all `sessions` rows of that user (O-12). A delete removes them through the foreign key. No session cookie cache is configured, so the next request of
  that browser gets 401.
- **Live updates:** after a role change, password reset or delete, the server closes every open `/api/v1/events`
  stream of that user (an event to that user's audience that the stream handler ends on). Browsers reconnect as today;
  an ended session gets 401, a changed role reconnects with the new admin flag (admin-only events start or stop).
- **No reading other users' data:** entry, recording, audio, transcript, search, timeline and event routes stay
  scoped by `request.me.id` for admins too (no admin bypass anywhere). There is no impersonation route.
- **Rate limits:** the global 300 per minute per IP stays; the three write routes also have 30 per minute per IP.
- **Spec 010 usage estimate:** transcripts of a deleted user are gone, so "this month" drops by their audio. Accepted.

Shared schemas (`packages/shared/src/index.ts`):

```ts
export const passwordSchema = z.string().min(passwordMinLength).max(128) // setup uses it too
export const adminUserSchema = z.object({
  id: z.string(), name: z.string(), username: z.string(), isAdmin: z.boolean(), createdAt: z.string(),
})
export const createUserSchema = z.strictObject({
  name: nameSchema, username: usernameSchema, isAdmin: z.boolean(), password: passwordSchema,
})
export const updateUserSchema = z
  .strictObject({ name: nameSchema, isAdmin: z.boolean(), password: passwordSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0)
export const deleteUserSchema = z.strictObject({ confirmUsername: z.string() })
```

## Web behaviour

- Users tab as the mockup. Rows are buttons with `aria-label` "{{name}} szerkesztése"; the "Te" chip is text. Role is a
  text pill (the admin one with the shield icon), never colour alone.
- Dialogs use the existing `Dialog` (bottom sheet on phone, centred on desktop, focus trapped, Esc closes).
- Create: fields as the mockup, role is a `Segmented` (default Felhasználó) with the role hint, starting password field
  (`autocomplete="new-password"`) with the hint. Client checks as setup (`field.error.*`); `username_taken` shows under
  the username field. On success the dialog closes and the list refreshes.
- Edit: "Új jelszó beállítása" swaps in a password field (`new-password`) with its hint; "Mentés" sends only changed
  fields. Own row (O-11): instead of the button, "A saját jelszavadat a Fiók fülön módosíthatod." with a link
  to `/settings/account`. Last admin (own row): the role `Segmented` is `aria-disabled` with the lock note (info icon)
  linked by `aria-describedby`; delete is `aria-disabled` with "Az egyetlen rendszergazda nem törölhető.". Own row with
  other admins (O-10): role enabled; delete disabled with "Saját magadat nem törölheted.".
- When the live-updates stream reconnects, the app refetches `me`, so a changed role shows (tabs appear or go) without a reload.
- Transcript label (D-68): the meta row picks the label from `me.isAdmin`. Basic user: chip icon + "Helyi" or cloud
  icon + "Felhő", visually hidden prefix "Átírás:" (`transcript.where.label`). Admin: unchanged from specs 009 and 010.
  An unknown model id shows nothing for both roles.
- Saving your own role away (another admin exists, O-10): after the 200 the app refetches `me` and moves to
  `/settings/general`.
- Delete: `alertdialog` "Törlöd {{name}} fiókját?", the warning text, a field "A megerősítéshez írd be a
  felhasználónevét: {{username}}" (username in a code style), "Végleges törlés" (danger) stays `aria-disabled` until the
  field matches (trimmed, any case), "Mégse".

## Acceptance criteria

Access
- **AC-1** Given a basic user, then they have no Felhasználók tab, and every `/api/v1/admin/users` route answers 403 `forbidden` and changes nothing; given no session, 401.
- **AC-2** Given an admin whose admin role was just removed by another admin, when they call an admin route with their existing session, then it answers 403 (the flag is read fresh, not from the session).

List
- **AC-3** Given three users (the signed-in admin, a user, a second user), when the admin opens `/settings/users`, then the list shows each name, username, role and created date (`hu` "2026. nov. 12.", `en` "Nov 12, 2026"), oldest first, with "Te" on the admin's own row, the intro line and the two rule lines.
- **AC-4** Given `GET /api/v1/admin/users`, then each item has exactly `id`, `name`, `username`, `isAdmin`, `createdAt`: no email, hash, sessions, settings, counts or activity.

Create
- **AC-5** Given the create dialog with name "Bence", username " Bence.K ", role Felhasználó and an 8+ character password, when the admin presses "Létrehozás", then the API answers 201, the user is stored with username `bence.k`, `is_admin` false, an Argon2id credential, `ui_language` and `entry_language` `en`, the admin's time zone and theme `system`; the row appears; that person can sign in with that username and password and lands on Home, and is not asked to change the password.
- **AC-6** Given role Rendszergazda, then the new user is an admin and sees all four Settings tabs after signing in.
- **AC-7** Given an existing username (any capitals), then the API answers 409 `username_taken`, nothing is created, and the error shows under the username field; given a bad username, empty or 61-character name, or a password under 8 or over 128 characters, then the field error shows and nothing is sent, and the API answers 400 for the same bodies.

Edit
- **AC-8** Given another user's dialog, when the admin changes the name and saves, then the list and that user's greeting (after their reload) show the new name; the username shows read-only and a PATCH with `username` answers 400 (O-9).
- **AC-9** Given a basic user, when an admin sets Rendszergazda and saves, then they are admin; setting Felhasználó on an admin while another admin exists makes them a basic user, and their open Settings page loses the admin tabs after the stream reconnects.
- **AC-10** Given "Új jelszó beállítása" with a new password, when the admin saves, then the target signs in with the new password only, and every session the target had answers 401 on its next request (O-12); the admin's own session is untouched.
- **AC-11** Given the admin's own row, then there is no password button but the line linking to the Fiók tab, and `PATCH` of your own id with `password` answers 400 `use_account_password` and changes nothing (O-11).

Last admin and self
- **AC-12** Given the signed-in admin is the only admin, when they open their own row, then the role control is disabled with "Te vagy az egyetlen rendszergazda, ezért ez nem változtatható. Előbb tegyél meg valaki mást rendszergazdának.", delete is disabled with "Az egyetlen rendszergazda nem törölhető.", and `PATCH { isAdmin: false }` on themselves answers 409 `last_admin` with no change.
- **AC-13** Given two admins A and B, when A removes their own admin role, then it succeeds, A's app moves to `/settings/general` with two tabs, and B is now the only admin (O-10).
- **AC-14** Given two admins, when each sends `PATCH { isAdmin: false }` for the other at the same moment, then exactly one answers 200, the other 409 `last_admin`, and one admin remains.
- **AC-15** Given any admin, then `DELETE` of their own id answers 409 `cannot_delete_self` and the own-row delete button is disabled with "Saját magadat nem törölheted." (or the last-admin reason when they are the only admin) (O-10).

Delete
- **AC-16** Given the delete dialog for "bence.k", then "Végleges törlés" stays disabled until the field holds `bence.k` (spaces around and capitals ignored); `DELETE` with a different `confirmUsername` answers 400 `confirmation_mismatch` and deletes nothing.
- **AC-17** Given a user with text entries, recordings (an upload and a recording) and transcripts, when an admin deletes them, then the API answers 204 and no row with their id is left in `users`, `accounts`, `sessions`, `entries`, `recordings` or `transcripts`, the folder `media/<id>/` is gone, their signed-in browser gets 401 and shows login, and their username can be used for a new account.
- **AC-18** Given the deleted user had a `cloud_copies` row (the spec 010 fixture still holds the copy), then the cleanup deletes it at the fixture and removes the row; given one of their recordings was queued, then its job ends without a retry, without an error-level log and without creating a transcript.
- **AC-19** Given a `media/<id>/` folder whose user does not exist, when the server starts, then the folder is removed; folders of existing users stay.
- **AC-20** Given two users, when one is deleted, then the other's entries, recordings, files and sessions are untouched.

Privacy
- **AC-21** Given admin A and user U with entries and recordings, when A (signed in as A) asks for U's entry, its recordings, audio (also with `?download=1`), transcript, retry, retranscribe, edit or delete by id, then each answers 404 exactly like a made-up id; A's timeline, search and live events contain none of U's data; and no route exists for impersonation (`/api/v1/auth/admin/impersonate-user` and similar answer 404).

Limits, logs, quality
- **AC-22** Given 30 user-management writes from one IP within a minute, when a 31st is sent, then it answers 429.
- **AC-23** Given create, edit, password reset and delete run with marker text in name, username and password, then the marker appears nowhere in the captured logs; log lines name users only by id.
- **AC-24** Given the screens `users`, `usercreate`, `useredit`, `usermakeadmin`, `userlastadmin`, `userdelete` in `hu` and `en`, at 390 and 1280, light and dark, then axe reports no violations and the layout checks pass.
- **AC-25** Given transcripts by Turbo and by Soniox, then a basic user sees chip icon + "Helyi" (accessible "Átírás: Helyi") and cloud icon + "Felhő" (accessible "Átírás: Felhő") on the recording cards, with no model or provider name, while an admin sees chip icon + "Turbo" and cloud icon + "Soniox" as in spec 010; in `en` the basic labels are "Local" and "Cloud".

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | no tab for a basic user | 403 on all four routes for a basic user, 401 without session, rows unchanged | | |
| AC-2 | | | demote B, B's old cookie → 403 | | |
| AC-3 | created-date formatter | list rendering, "Te", order | | admin sees list at 390 + 1280 | fixed clock |
| AC-4 | response schema is strict | | exact keys | | |
| AC-5 | | create dialog submit | 201, DB row, credential hash, defaults | create → sign out → sign in as the new user → Home | |
| AC-6 | | | `is_admin` true | new admin sees 4 tabs | |
| AC-7 | schemas | client errors, `username_taken` under the field | 409, 400 cases | | `Bence.K` vs `bence.k` |
| AC-8 | | | name saved, PATCH `username` 400 | | |
| AC-9 | | | role both ways | open Settings of the demoted user updates after reconnect | two browser contexts |
| AC-10 | | password field toggle | sessions of target deleted, new password works, admin session 200 | | |
| AC-11 | | own row shows the link | 400 `use_account_password` | | |
| AC-12 | | locked controls, `aria-disabled`, reasons linked | 409 `last_admin` | | |
| AC-13 | | | self-demote with another admin | A ends on General | |
| AC-14 | | | two parallel PATCHes, one 409 | | `Promise.all`, repeated 20 times |
| AC-15 | | disabled button + reason | 409 `cannot_delete_self` | | |
| AC-16 | match rule | button state while typing | 400 `confirmation_mismatch` | | |
| AC-17 | | | rows gone in every table, folder gone, username free | delete a signed-in user in context B → B sees login | real storage dir in the test |
| AC-18 | | | copy deleted at fixture, queued job no-op | | spec 010 provider fixture, fake transcriber |
| AC-19 | | | start with an orphan folder → removed | | |
| AC-20 | | | other user untouched | | |
| AC-21 | | | every user-content route with U's ids as A → 404; search, timeline, events | | table-driven over the route list |
| AC-22 | | | 31st write → 429 | | |
| AC-23 | | | marker through all four routes, log capture | | spec 007 helper |
| AC-24 | | | | axe + `expectLayout` per state | |
| AC-25 | | meta row per role and engine, hu + en | | basic user sees "Felhő" on a Soniox transcript | spec 010 provider fixture |

Also covered: both languages for every string, error states (network failure shows `error.generic` in the dialog and
keeps the input).

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `users.intro` | Új fiókot csak rendszergazda hozhat létre, nyilvános regisztráció nincs. | Only an admin can create accounts. There is no public sign-up. |
| `users.new` | Új felhasználó | New user |
| `users.columns.name` / `.username` / `.role` / `.created` | Név / Felhasználónév / Szerep / Létrehozva | Name / Username / Role / Created |
| `users.createdOn` | Létrehozva: {{date}} | Created {{date}} |
| `users.you` | Te | You |
| `users.role.admin` / `.user` | Rendszergazda / Felhasználó | Admin / User |
| `users.roleHint` | A rendszergazda kezeli a felhasználókat és az átírást. Mások bejegyzéseit ő sem látja. | Admins manage users and transcription. They can't see other people's entries either. |
| `users.rules.private` | Mindenki csak a saját bejegyzéseit látja. A rendszergazdák sem olvashatják másokét. | Everyone sees only their own entries. Admins can't read other people's entries either. |
| `users.rules.oneAdmin` | Mindig marad legalább egy rendszergazda. | There is always at least one admin. |
| `users.edit` | {{name}} szerkesztése | Edit {{name}} |
| `users.create.title` / `.submit` | Új felhasználó / Létrehozás | New user / Create |
| `users.usernameHint` | Ezzel lép be. Később nem módosítható. | Used to sign in. Can't be changed later. |
| `users.startPassword` / `.startPasswordHint` | Kezdő jelszó / Legalább 8 karakter. Add át neki személyesen. Belépés után a Fiók fülön megváltoztathatja. | Starting password / At least 8 characters. Hand it over in person. They can change it on the Account tab after signing in. |
| `users.editTitle` | {{name}} fiókja | {{name}}'s account |
| `users.setPassword` | Új jelszó beállítása | Set a new password |
| `users.newPassword` / `.newPasswordHint` | Új jelszó / Legalább 8 karakter. Mentés után ezzel léphet be, a régi jelszava nem működik többé. | New password / At least 8 characters. After saving, this is the one that works; the old password stops working. |
| `users.ownPassword` | A saját jelszavadat a Fiók fülön módosíthatod. | Change your own password on the Account tab. |
| `users.lockedRole` | Te vagy az egyetlen rendszergazda, ezért ez nem változtatható. Előbb tegyél meg valaki mást rendszergazdának. | You're the only admin, so this can't change. Make someone else an admin first. |
| `users.lockedDeleteLastAdmin` | Az egyetlen rendszergazda nem törölhető. | The only admin can't be deleted. |
| `users.lockedDeleteSelf` | Saját magadat nem törölheted. | You can't delete yourself. |
| `users.delete` | Felhasználó törlése | Delete user |
| `users.deleteTitle` | Törlöd {{name}} fiókját? | Delete {{name}}'s account? |
| `users.deleteText` | {{name}} összes bejegyzése, hangfelvétele és fájlja végleg törlődik a szerverről. Ezt nem lehet visszavonni. | All of {{name}}'s entries, recordings and files are deleted from the server for good. This can't be undone. |
| `users.deleteConfirmLabel` | A megerősítéshez írd be a felhasználónevét: {{username}} | To confirm, type their username: {{username}} |
| `users.deleteSubmit` | Végleges törlés | Delete for good |
| `common.save` | Mentés | Save |
| `transcript.where.label` | Átírás: | Transcription: |
| `transcript.where.local` / `.cloud` | Helyi / Felhő | Local / Cloud |
| `error.username_taken` | Ez a felhasználónév már foglalt. | This username is taken. |

## Privacy & data
- Stored: users, credential accounts and sessions as in spec 001. No new columns.
- An admin sees other users' name, username, role and created date only. No entry, recording, transcript, file, count
  or activity of another user is returned to anyone.
- Delete is a hard delete of the user's rows and files, plus the vendor copies through the spec 010 cleanup. Backups
  made before the delete still hold the data (backup guide, spec 008).
- Logs name users by id only; names, usernames and passwords never appear.
- Nothing leaves the server, except the vendor delete calls of spec 010.

## Open questions
None open. O-9, O-10, O-11, O-12 were decided by the owner on 2026-11-28 (D-67).
