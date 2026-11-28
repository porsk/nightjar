# Design plan

## Feel
Calm, private, evening-friendly. Dusk palette (deep blue/violet, warm amber accent), dark mode as good as light.
The app follows the system light/dark theme. There is no theme setting.
Readable type for long entries. Big, obvious record button. Mobile first, works great on desktop.
Hungarian words are long, so layouts must handle long labels. WCAG 2.2 AA.

## Direction
**Alkony** (decision D-16). Mobile: `design/directions/1-alkony.html`. Desktop: `design/alkony/desktop.html`
(screenshots in `design/alkony/screenshots/`). Desktop layout: left sidebar instead of the tab bar, Home with today's
entries beside the record button, Entry as timeline list + reading pane side by side.

## Process
1. 2 or 3 visual directions as quick HTML mockups (home + recording + entry screen). Owner picks one.
2. Design tokens (colours, type, spacing, radius) from the chosen direction.
3. Clickable mockups of the M1 screens. Owner reviews.
4. Build the screens with those tokens. Playwright screenshots catch visual regressions.

## M1 screens
| Screen | Main content |
|---|---|
| Setup wizard (starts in English) | setup code + account; language + time zone; transcription now or later (download progress shows in Settings) |
| Login | username + password |
| Home / Today | record button, write button, today's entries |
| Recorder | timer, level meter, pause, stop, discard |
| Entry | date, text, recordings with transcript + player, status while transcribing |
| Timeline | entries grouped by day |
| Search | search box, results with highlighted matches |
| Settings | UI language, default entry language, time zone |

M1 mockups (all screens and states, 390 / 1280 / 1440, dark + light, screen switcher): `design/alkony/m1.html`
(screenshots in `design/alkony/screenshots/m1/`).

Spec 009 mockups (model list in Settings, recording menu with "Átírás újra", edited-transcript confirm, model label):
`design/alkony/009-transcription-models.html` (screenshots at 390 / 1280, dark + light in `design/alkony/screenshots/009/`).

Spec 010 mockups (engine list with Local and Cloud groups, API key entry and check, monthly estimate, cloud / local
transcript label, failed cloud transcription; no privacy line outside Settings, D-60): `design/alkony/010-cloud-transcription.html`
(screenshots at 390 / 1280, dark + light in `design/alkony/screenshots/010/`).

## 0.5 mockups (waiting for owner approval)

| Mockup | What | Status |
|---|---|---|
| `design/alkony/011-settings-users.html` | Settings in tabs (General, Transcription, Users, Account; one URL per tab, tabs at the top on phone and desktop), "Megjelenés" theme switch on General (Rendszer / Világos / Sötét, per user, applied right away), user list, create / edit / delete user, last-admin locked state, change own password, a basic user's settings, "Letöltés" in the recording menu | waiting for owner approval |
| `design/alkony/012-mood.html` | Mood, three variants on the same 1-5 scale: A faces, B colour scale, C words with sky icons. Each shown while writing, right after a recording, on the entry, empty, and on the timeline, plus a side-by-side board | waiting for owner approval |

Screenshots at 390 / 1280, dark + light in `design/alkony/screenshots/011/` and `design/alkony/screenshots/012/`.

## Direction feedback

| Round | Feedback |
|---|---|
| 1 | Alkony favourite, Erdő also liked, Tinta (bold, graphic) dropped. Round 2: 3 more in the same calm family, one blends Alkony + Erdő |
| 2 | Owner picked Alkony (D-16). Desktop mockups added |
