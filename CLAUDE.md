# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A Discord bot for managing a book club server. Core features:

- **Monthly nominations** — members nominate books each month via `/nominate`; an admin configures each month via `/setup` and opens nominations with `/nominations-start`
- **Ranked voting** — members cast 1st/2nd/3rd ranked choices via `/vote`; admin opens and closes voting with `/voting-start` / `/voting-end`
- **Current book tracking** — bot knows what the active book is
- **Reading progress** — members can update and share their progress through the current book

## Branches

- `main` — stable base (original bot: `/ping`, `/read`, `/setup`)
- `features/voting` — active development branch; contains nominations and ranked voting system

**The `dev.db` file is not tracked by git.** Its schema reflects whichever migrations have been run locally, regardless of which branch is checked out. If the live database is out of sync with the checked-out branch's `prisma/schema.prisma`, run `npx prisma migrate dev` to bring it in line.

## Environment

Requires a `.env` file with:
- `TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application/client ID
- `GUILD_ID` — Discord server (guild) ID for registering guild-scoped commands
- `DATABASE_URL` — SQLite connection string (e.g. `file:./dev.db`)

## Dev Commands

```bash
npm install                  # Install dependencies
node index.js                # Start the bot
node deploy-commands.js      # Register slash commands with Discord (re-run after any command changes)
npm test                     # Run unit tests (Jest)
npx prisma studio            # Browse the database in a web UI
npx prisma migrate dev       # Apply schema changes and create a new migration
npx prisma generate          # Regenerate the Prisma client after schema changes
```

## Architecture

- `index.js` — Bot entry point. Loads all commands from `commands/` into a Collection at startup, then dispatches incoming interactions by command name.
- `deploy-commands.js` — One-off script to register slash commands with Discord's API via REST. Auto-discovers all files in `commands/` so new commands are picked up automatically.
- `db.js` — Exports a singleton `PrismaClient` instance. Import this wherever database access is needed.
- `lib/scrapeBook.js` — Fetches a Goodreads book page and extracts metadata (title, author, rating, pages, image, genres) from the JSON-LD script tag and HTML. Used by `/read` and `/nominate`.

### Commands (`commands/`)

Each file exports `{ data, execute }` — `data` is a `SlashCommandBuilder` and `execute` is the async handler.

| Command | Branch | Description |
|---|---|---|
| `/ping` | main | Health check |
| `/read <url>` | main | Looks up a Goodreads book URL and displays an embed with title, author, rating, pages, and genres |
| `/setup <month> <year> [nominator]` | main | Admin-only. Configures nominations for a month. Omit `nominator` for open-to-all; provide a user to restrict nominations to that person. |
| `/nominations-start` | features/voting | Admin-only. Opens nominations for the current month (must run `/setup` first). Posts `@everyone` announcement to `#voting`. |
| `/nominate <url>` | features/voting | Nominates a Goodreads book for the current month. Enforces one nomination per user in open periods; overwrites if re-run. Announces in `#voting`. |
| `/voting-start` | features/voting | Admin-only. Opens ranked voting from all nominated books (requires ≥ 3). Posts numbered book list to `#voting`. |
| `/vote <first> <second> <third>` | features/voting | Members cast their 1st/2nd/3rd choice by number. All three must be different. Can re-run to update picks. |
| `/voting-end` | features/voting | Admin-only. Closes voting and announces winner in `#voting`. Tiebreaker: most 1st-choice wins, then 2nd, then 3rd. |

### #voting channel

Many commands post public announcements to the channel named `voting`. This is the canonical status channel for the book club. The channel is looked up by name at runtime (`interaction.guild.channels.cache.find`). The name is defined as `VOTING_CHANNEL_NAME = 'voting'` at the top of each relevant command file.

### Adding a new slash command

1. Create `commands/<name>.js` exporting `{ data, execute }`.
2. Run `node deploy-commands.js` to register it with Discord.
No changes to `index.js` or `deploy-commands.js` are needed.

## Database

Prisma 5 + SQLite. Schema lives in `prisma/schema.prisma`. The client is generated into `node_modules/@prisma/client`.

After any schema change:
```bash
npx prisma migrate dev --name <description>
npx prisma generate
```

### Models

| Model | Purpose |
|---|---|
| `Book` | Canonical book record scraped from Goodreads. `genres` is stored as a JSON string (full list, not display-truncated). |
| `NominationPeriod` | Admin-configured record for a month: `active` flag (set by `/nominations-start`), `openToAll` flag, optional `nominatorId`/`nominatorName`. Unique on `(month, year)`. |
| `Nomination` | A book nomination submitted by a member. In open-to-all periods, one per user per month (enforced in app code); overwritten if the user re-nominates. In restricted periods, unlimited submissions from the designated nominator. |
| `VotingPeriod` | Created by `/voting-start`. Stores `open`, `expiresAt`, and `bookIds` (JSON array of book IDs in fixed display order). Unique on `(month, year)`. |
| `RankedVote` | One ranked vote per user per `VotingPeriod`. Stores `firstBookId`, `secondBookId`, `thirdBookId`. Unique on `(votingPeriodId, userId)`; upserted so members can change their picks. |
| `CurrentBook` | The active book the club is reading. One row per book (`bookId` unique). |
| `ReadingProgress` | A member's page progress through the current book. One entry per user per book, updated in-place. |

### Nomination logic

- `/nominations-start` sets `NominationPeriod.active = true` for the current month.
- `/nominate` checks `active` before accepting nominations.
- Open-to-all: one nomination per user per month. Re-nominating overwrites the existing record (`nomination.update`).
- Restricted: only the designated `nominatorId` may nominate, no cap.

### Voting logic

- `/voting-start` deduplicates nominations by `bookId` (ordered by `createdAt asc`), stores the ordered list in `VotingPeriod.bookIds`, and creates the period.
- `/vote` maps the user's 1-based choices to `bookIds`, validates all three are distinct and in range, then upserts a `RankedVote`.
- `/voting-end` tallies `firstBookId`, `secondBookId`, `thirdBookId` counts per book, sorts by `first DESC → second DESC → third DESC`, and announces the winner. A tie (identical counts across all three ranks) is called out explicitly.

## Notes

- All ephemeral replies use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`).
- Discord user IDs are stored as `String` — they are snowflakes that exceed JS integer range.
- Prisma 7 was tried and reverted — it requires driver adapters for SQLite and is incompatible with this plain CommonJS setup. Stay on Prisma 5.
