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
| Setup wizard | account, language, model download progress |
| Login | email + password |
| Home / Today | record button, write button, today's entries |
| Recorder | timer, level meter, pause, stop, discard |
| Entry | date, text, recordings with transcript + player, status while transcribing |
| Timeline | entries grouped by day |
| Search | search box, results with highlighted matches |
| Settings | UI language, default entry language, time zone |

M1 mockups (all screens and states, 390 / 1280 / 1440, dark + light, screen switcher): `design/alkony/m1.html`
(screenshots in `design/alkony/screenshots/m1/`).

## Direction feedback

| Round | Feedback |
|---|---|
| 1 | Alkony favourite, Erdő also liked, Tinta (bold, graphic) dropped. Round 2: 3 more in the same calm family, one blends Alkony + Erdő |
| 2 | Owner picked Alkony (D-16). Desktop mockups added |
