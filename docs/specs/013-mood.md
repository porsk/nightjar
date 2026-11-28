# 013 Mood

Status: approved
Milestone: 0.5

## Why
The owner wants to note how they felt with each entry (S-4) and later see it over time (calendar and stats, 0.8). The
look is variant A, simple faces (D-64).

## Scope
In (mockup: `design/alkony/012-mood.html`, screens `facewrite`, `faceafter`, `faceentry`, `faceempty`, `facetimeline`;
screenshots in `design/alkony/screenshots/012/`):
- **One optional mood per entry**, a whole number 1 to 5, or none:

  | Value | hu | en | Face |
  |---|---|---|---|
  | 1 | Nehéz | Rough | frown |
  | 2 | Borongós | Low | slight frown |
  | 3 | Rendben | Okay | straight mouth |
  | 4 | Jó | Good | slight smile |
  | 5 | Nagyszerű | Great | smile |

  Colours go from cool blue (1) to warm amber (5), no red. A face always has its word next to it (visible, or as hidden
  text where only the small face shows), so nothing depends on colour.
- **Picker** (five faces with their words in one row): in the writer under the text and its save line, labelled
  "Hangulat" with "nem kötelező" (O-15); on the entry page as a card "Hogy érzed magad?" with
  "Most nem", shown once right after a voice recording when the entry has no mood yet (O-15); and on the entry page when the user taps the mood chip.
- **Entry page:** a chip next to "Dátum módosítása": face + word when set, dashed "+ Hangulat" when not. Tapping it
  opens the picker card.
- **Timeline cards and desktop rows:** after the time, a separator dot, the small face and the word. No mood: nothing.
- **Clear:** choosing the selected face again sets no mood.
- API: `mood` on entries (create, update, read) and on timeline items.

Out (not now): mood on search results, filters by mood (0.6 filters), calendar colours and stats (0.8), more than one
mood per entry, named feelings or notes about the mood, mood on a recording, asking for a mood after an upload or a
typed entry.

## Flows

```
Writer (new or existing entry)
  text ... [Hangulat  nem kötelező]  (1)(2)(3)(4)(5)
     new entry: mood is kept with the draft, saved when the entry is created (an entry still needs text or a recording)
     existing entry: saved at once, like the date

Recorder ──stop──► /entries/:id (state: askMood)
  entry has no mood ──► card "Hogy érzed magad?" [faces] [Most nem]
      pick ──► saved, card closes, chip shows the face        Most nem ──► card closes, nothing saved
  the flag is cleared from history at once, so a reload or Back does not show the card again

Entry page
  chip "(face) Jó" or "+ Hangulat" ──► the same card titled "Hangulat" with "Bezárás"
      pick ──► saved, card closes          pick the selected face again ──► no mood, card closes
```

## Server behaviour

- Migration `0013_entry_mood`: `entries.mood smallint null`, check `mood between 1 and 5`.
- Shared schemas: `moodSchema = z.number().int().min(1).max(5)`; `createEntrySchema` and `updateEntrySchema` get
  `mood: moodSchema.nullable().optional()` (`null` clears); `entryResponseSchema` and `timelineItemSchema` get
  `mood: moodSchema.nullable()`.
- `PATCH /api/v1/entries/:id` with only `mood` is valid. Ownership and 404 rules as spec 002. Changing the mood does not
  change the entry date or the search text.
- Values are stored as given (1 is the lowest). 0.8 charts read `entries.mood` with `entry_date`; none is `null`, never
  0.

## Web behaviour

- `MoodFace` component: one SVG per value (the mockup's 40×40 drawing: circle, two eyes, mouth path), three looks:
  plain (muted line, unselected picker), on (filled tint + coloured line, selected), tint (small, on chips and cards).
- Colour tokens in `styles.css`, one set per theme (spec 011 theme rules):
  dark `--mood-1 #8b9ae6`, `--mood-2 #ab97e6`, `--mood-3 #cfa6dc`, `--mood-4 #f2ab8c`, `--mood-5 #f6c35c`;
  light `--mood-1 #4a5aa8`, `--mood-2 #6a56b4`, `--mood-3 #9a5aa6`, `--mood-4 #c0621a`, `--mood-5 #b07800`
  (each at least 3:1 against its surface).
- `MoodPicker`: a `fieldset`/`role="radiogroup"` labelled "Hangulat" with five native radio inputs, each label the face
  and the word; 44 px or more touch target; arrow keys move between faces (native radios). Choosing the checked face
  again by click, tap or Space clears it.
- Writer: picker under the text field and the save line. New entry: the value travels with the first `POST`. Existing
  entry: `PATCH { mood }` at once; a failed save shows the existing writer error line.
- Recorder: after a successful save it navigates to the entry with `state: { askMood: true }`. The entry page shows the
  card only when that flag is set and `mood` is null, then replaces the history entry without the flag.
- Entry page: chips row (`flex-wrap`) with the date chip and the mood chip (`aria-label` "Hangulat: Jó. Módosítás" /
  "Hangulat hozzáadása"). The card sits under the chips, its heading is an `h2`. A save failure keeps the card open and
  shows `error.generic`.
- Timeline card and row (`EntryCard`): mood after the time as `· <face> <word>`, with hidden "Hangulat:" before the word.

## Acceptance criteria

Data
- **AC-1** Given an entry, when `PATCH /api/v1/entries/:id` sends `mood` 1 to 5, then it is stored and returned by the entry and timeline routes; `null` clears it; 0, 6, 2.5, "4" answer 400 and change nothing; another user's entry answers 404.
- **AC-2** Given `POST /api/v1/entries` with text and `mood: 3`, then the entry is created with mood 3; without `mood` it is `null`; an existing database after the migration has `null` on every entry.
- **AC-3** Given a mood change, then the entry's `entry_date`, `body_md` and search text are unchanged.

Writer
- **AC-4** Given the writer, then under the text and save line it shows "Hangulat" with "nem kötelező" and five faces labelled Nehéz, Borongós, Rendben, Jó, Nagyszerű (`en`: Rough, Low, Okay, Good, Great), none selected for an entry without mood (O-15).
- **AC-5** Given a new entry, when the user picks Jó and types text, then the created entry has mood 4; given only a mood and no text, then no entry is created when the user leaves.
- **AC-6** Given an existing entry in the writer, when the user picks a face, then it is saved at once (one `PATCH { mood }`); picking the selected face again (click or Space) saves `null`.

After a recording
- **AC-7** Given the user stops a recording for a new entry, then the entry page shows the card "Hogy érzed magad?" with the five faces and "Most nem" above the recordings (O-15).
- **AC-8** Given that card, when the user picks Borongós, then mood 2 is saved, the card closes and the chip shows the Borongós face and word; "Most nem" closes it and saves nothing.
- **AC-9** Given the card was shown, when the user reloads or goes Back and forward, then it does not show again; given "Újabb felvétel" on an entry that already has a mood, then no card shows; given an upload or a typed entry, then no card shows.

Entry page and timeline
- **AC-10** Given an entry with mood 4, then the entry page shows a chip with the Jó face and "Jó" next to "Dátum módosítása"; without a mood, a dashed "+ Hangulat" chip.
- **AC-11** Given either chip, when the user taps it, then the picker card opens titled "Hangulat" with "Bezárás"; a pick saves and closes it; picking the selected face clears the mood and the chip turns into "+ Hangulat".
- **AC-12** Given timeline entries with moods 1 to 5 and one without, then each card (and each desktop row) shows `· face word` after the time for the five, and nothing extra for the one without; screen readers get "Hangulat: Jó".
- **AC-13** Given the mood is changed on the entry page, then the timeline card shows the new mood without a reload.

Look and access
- **AC-14** Given light and dark themes, then each face colour has at least 3:1 contrast against the surface it sits on (picker card, chip, timeline card), and no mood token is red (hue outside 345° to 15° in HSL).
- **AC-15** Given the picker, then it is a radio group named "Hangulat", each option's accessible name is its word, arrow keys move the selection, and the selected one is announced as checked.
- **AC-16** Given the screens `facewrite`, `faceafter`, `faceentry`, `faceempty`, `facetimeline` in `hu` and `en`, at 390 and 1280, light and dark, then axe reports no violations and the layout checks pass (five faces with "Nagyszerű" fit in one row at 390).

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | `moodSchema` | | PATCH 1..5, null, bad values 400, other user 404 | | |
| AC-2 | | | POST with and without mood; migration default | | upgrade test DB from 0.4.0 |
| AC-3 | | | date, body, search text unchanged | | |
| AC-4 | | writer renders picker, labels in both languages | | | |
| AC-5 | | new draft keeps mood, POST carries it; mood only → no POST | | write + pick → open entry → chip Jó | |
| AC-6 | | PATCH on pick, `null` on second pick and on Space | | | |
| AC-7 | | | | record with the fake mic → stop → card shows | fake transcriber |
| AC-8 | | pick saves + closes; Most nem sends nothing | | pick Borongós → chip | |
| AC-9 | | flag cleared from history state | | reload after the card → no card; upload → no card | |
| AC-10 | | chip both states | | | |
| AC-11 | | card opens from chip, pick, clear | | change mood on an entry | |
| AC-12 | | `EntryCard` with each value and none, hidden prefix | timeline items carry `mood` | timeline at 390 and desktop rows at 1280 | |
| AC-13 | | | | change on entry → back to timeline shows it | |
| AC-14 | contrast and hue check of the token values against `--surface` / `--surface2` / `--bg` for both themes | | | | reads the tokens from `styles.css` |
| AC-15 | | roles, names, keyboard | | | Testing Library `userEvent.keyboard` |
| AC-16 | | | | axe + `expectLayout` per state | |

Also covered: both languages, mood shown the same after the spec 011 theme switch.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `mood.label` | Hangulat | Mood |
| `mood.optional` | nem kötelező | optional |
| `mood.values.1` … `.5` | Nehéz / Borongós / Rendben / Jó / Nagyszerű | Rough / Low / Okay / Good / Great |
| `mood.ask` | Hogy érzed magad? | How are you feeling? |
| `mood.notNow` | Most nem | Not now |
| `mood.close` | Bezárás | Close |
| `mood.add` | Hangulat | Mood |
| `mood.addLabel` | Hangulat hozzáadása | Add a mood |
| `mood.chipLabel` | Hangulat: {{mood}}. Módosítás | Mood: {{mood}}. Change |
| `mood.prefix` | Hangulat: | Mood: |

## Privacy & data
- Stored: one small number on the user's own entry. Deleted with the entry and with the user (spec 012).
- Never logged, never sent anywhere.

## Open questions
None open. O-15 was decided by the owner on 2026-11-28 (D-67).
