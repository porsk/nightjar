# Nightjar - product plan

> *Verba volant, scripta manent* - spoken words fly away, written words remain.

**Nightjar** is a self-hosted, open source journal you can **speak** to. Record a thought in Hungarian or English,
and your own server turns it into searchable text. No cloud needed. Type when you prefer, attach photos,
look back on past days, and (only if you want) let an AI suggest tags and summaries or read your journal over MCP.

*Name: the nightjar is a bird that sings at dusk; a jar is where you keep things.*

Status: **draft for review** (2026-11-26).

---

## 1. Principles

1. **Your data, your server.** Works fully offline. No telemetry, no external calls unless the owner enables them.
2. **Voice first, text equal.** Recording is one tap. Typing is never second-class.
3. **Bilingual from day one.** Hungarian and English for recordings, UI, prompts and AI output.
4. **Seconds to capture.** Opening the app and starting a recording takes under 3 seconds on a phone.
5. **Durable.** Original audio is always kept.
6. **AI is optional and transparent.** Off by default. Every entry shows whether and where it was processed.
7. **Calm.** No streak-shaming, no notifications, no gamification beyond gentle stats.
8. **The app follows the system light/dark theme.**

## 2. Who it's for

| Persona | Needs |
|---|---|
| **Owner / self-hoster** | One `docker compose up`, sane defaults, upgrades that don't break, runs on a NAS / mini PC / Raspberry Pi 5 |
| **Journaler** | Phone-first PWA, big record button, English or Hungarian UI (English by default), nothing to configure |
| **AI assistant** (Claude via MCP) | Scoped access to search and read entries when the owner allows it |

## 3. Core concepts

| Concept | Meaning |
|---|---|
| **Journal** | A notebook (e.g. "Personal", "Dreams"). Every user gets a default one. More are optional. |
| **Entry** | A journal entry for a day (a day can have several): optional title, typed text (Markdown), mood, tags, photos, recordings. Has an *entry date* (the day it's about) separate from when it was created. Can be a favourite. |
| **Recording** | An audio clip attached to an entry. An entry can have several. |
| **Transcript** | The text of a recording: editable, tied to its audio, records which model made it. |
| **Photo** | An image attached to an entry, with thumbnail. |
| **Mood** | 1-5 scale. |
| **Tag** | Free-form label, added by the user or suggested by AI. |
| **Prompt** | A writing/speaking question ("What surprised you today?"), built-in library in HU/EN plus custom ones. |
| **Look-back** | Past entries resurfaced: on this day, one month/year ago. |
| **Suggestion** | AI-proposed summary, tags, people and places for an entry. Pending until accepted or dismissed. |
| **Access token** | Personal token with scopes, for MCP clients. |

### Entry text vs transcripts
The entry's typed text and each recording's transcript are **stored separately**. The transcript stays tied to its
audio, and the entry page shows typed text and recordings together. Search and AI treat the entry as
*typed text + all transcripts*.

## 4. Feature catalogue

### Capture
| Feature | Milestone |
|---|---|
| Record in browser/PWA: start, pause/resume, stop, timer, level meter, discard | M1 |
| Text entry with Markdown editor | M1 |
| Entry date picker (write about yesterday) | M1 |
| Upload an existing audio file (voice memo from phone) | M1 |
| Photos: attach from camera/gallery, thumbnails | M2 |
| Offline recording queue: record with no connection, queue persists across reloads (IndexedDB) | M4 |

### Transcription
| Feature | Milestone |
|---|---|
| Offline transcription on the server, background job, live status in the UI | M1 |
| Language per recording: Hungarian / English / auto-detect; default from user settings (follows the UI language) | M1 |
| Editable transcript; user edits are never overwritten | M1 |
| Transcription off by default; the admin turns it on and the model downloads then | M1 |

### Organise and find
| Feature | Milestone |
|---|---|
| Timeline (grouped by day, infinite scroll) | M1 |
| Full-text search across text + transcripts, Hungarian- and English-aware (word endings, accents) | M1 |
| Mood | M2 |
| Manual tags + filters (tag, mood, journal, date range, has audio/photos) | M2 |
| Multiple journals, favourites | M2 |
| Calendar view (days with entries, mood colour) | M2 |

### Reflect
| Feature | Milestone |
|---|---|
| Daily prompt on the home screen; answer by voice or text | M2 |
| Prompt library in HU + EN, custom prompts | M2 |
| Look-backs: on this day, 1 month / 1 year ago | M2 |
| Gentle stats: entries per week, words spoken, mood over time | M2 |

### AI (opt-in)
| Feature | Milestone |
|---|---|
| Provider set by the admin in Settings: Claude (Anthropic API key, stored encrypted), Ollama (local), off (default); status shown in settings | M3 |
| Enrichment on entry text + transcripts: suggests summary, tags, people, places. Accept or dismiss | M3 |

### MCP server (opt-in)
| Feature | Milestone |
|---|---|
| Access tokens (read-only or read+write), revocable, last-used shown | M3 |
| Read tools: search entries, get entry, list by date range, list tags | M3 |
| Write tools: create entry, add tags (separate `write` scope) | M3 |
| Copy-paste setup snippets for Claude Desktop / Claude Code | M3 |

### Accounts and settings
| Feature | Milestone |
|---|---|
| First-run setup wizard: setup code from the server log, owner account, language, transcription now or later | M1 |
| Login with password | M1 |
| Settings: UI language, default entry language, time zone | M1 |
| Edit and delete entries (hard delete with media) | M1 |
| Logs, health checks, metrics | M1 |

## 5. Key user flows (M1)

1. **First run.** Owner opens `http://server:port`, setup wizard (English, Hungarian selectable): enter the setup code from the server log, create account, pick UI language (EN/HU),
   choose transcription now or later (if now, the model download starts in the background), lands on Home.
2. **Quick voice entry.** Home, big record button, recording screen (timer, level meter, pause), Stop.
   Entry appears with "Transcribing...", transcript shows up when ready (live status), edit if needed.
3. **Typed entry.** Home, "Write", editor, autosave.
4. **Find something.** Search box, results with highlighted matches from text and transcripts, open the entry.

## 6. Non-goals

- Public sharing, social features, collaborative journals.
- Hosted SaaS by us.
- End-to-end encryption: the server must read audio and text to transcribe and search. We protect data with
  authentication and documented disk-encryption guidance.
- Real-time (streaming) transcription while speaking.
- Transcription quality guarantees beyond HU/EN.

## 7. Success criteria for 1.0

- The owner journals daily with it for a month without data loss or needing the terminal.
- Hungarian transcription on the owner's own voice is "edit a few words, not rewrite".
- Fresh install to first transcribed entry in under 10 minutes on a mid-range mini PC.
- Upgrade with `docker compose pull && docker compose up -d`, migrations automatic.
- All features covered by specs, with tests for every acceptance criterion.
