# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A Discord bot for managing a book club server. Core features:

- **Monthly nominations** — members nominate books each month via `/nominate`; an admin configures each month via `/setup` and opens nominations with `/nominations-start`
- **Ranked voting** — members cast 1st/2nd/3rd ranked choices via `/vote`; admin opens and closes voting with `/voting-start` / `/voting-end`
- **Personal reading tracker** — each member has a personal forum channel; `/read` starts a book thread, `/progress`, `/rate`, `/finish` are run from inside the thread
- **Club read tracking** — `/club-start` designates the community-voted book, creates threads for all members, and maintains a live progress bar post in `#progress`

## Branches

- `main` — stable base (original bot: `/ping`, `/read`, `/setup`)
- `features/voting` — nominations and ranked voting system
- `features/reading-tracker` — **active branch**; personal reading tracker + club read tracking

**The `dev.db` file is not tracked by git.** Its schema reflects whichever migrations have been run locally, regardless of which branch is checked out. If the live database is out of sync with the checked-out branch's `prisma/schema.prisma`, run `npx prisma db push --accept-data-loss` (dev) or `npx prisma migrate dev` (prod-safe) to bring it in line.

## Environment

Requires a `.env` file with:
- `TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application/client ID
- `GUILD_ID` — Discord server (guild) ID for registering guild-scoped commands
- `DATABASE_URL` — SQLite connection string (e.g. `file:./dev.db`)

## Dev Commands

```bash
npm install                        # Install dependencies
node index.js                      # Start the bot
node deploy-commands.js            # Register slash commands with Discord (re-run after any command schema changes)
npm test                           # Run unit tests (Jest)
npx prisma studio                  # Browse the database in a web UI
npx prisma db push --accept-data-loss  # Apply schema changes in dev (data loss ok)
npx prisma migrate dev             # Apply schema changes and create a migration (production-safe)
npx prisma generate                # Regenerate the Prisma client after schema changes
```

## Architecture

- `index.js` — Bot entry point. Loads all commands from `commands/` into a Collection at startup, then dispatches incoming interactions by command name.
- `deploy-commands.js` — One-off script to register slash commands with Discord's API via REST. Auto-discovers all files in `commands/` so new commands are picked up automatically.
- `db.js` — Exports a singleton `PrismaClient` instance. Import this wherever database access is needed.
- `lib/scrapeBook.js` — Fetches a Goodreads book page and extracts metadata (title, author, rating, pages, image, genres) from the JSON-LD script tag and HTML.
- `lib/progressPost.js` — Builds and edits the `#progress` channel post for club reads. Looks up all `ReadingLog` entries for a book, renders an ASCII progress bar per member, and edits the stored message (or creates a new one). Called by `/read`, `/progress`, `/finish`, and `/club-start`. The `#progress` channel is found by name (`"progress"`) in the guild cache — **TODO: store channel ID in DB instead for robustness.**

### Commands (`commands/`)

Each file exports `{ data, execute }` — `data` is a `SlashCommandBuilder` and `execute` is the async handler.

| Command | Branch | Description |
|---|---|---|
| `/ping` | main | Health check |
| `/test <url>` | reading-tracker | Scrapes a Goodreads URL and displays a metadata embed. Useful for verifying the scraper works. (Was `/read` on main.) |
| `/setup <month> <year> [nominator]` | main | Admin-only. Configures nominations for a month. Omit `nominator` for open-to-all; provide a user to restrict nominations to that person. |
| `/nominations-start` | features/voting | Admin-only. Opens nominations for the current month (must run `/setup` first). Posts `@everyone` announcement to `#voting`. |
| `/nominate <url>` | features/voting | Nominates a Goodreads book for the current month. Enforces one nomination per user in open periods; overwrites if re-run. Announces in `#voting`. |
| `/voting-start` | features/voting | Admin-only. Opens ranked voting from all nominated books (requires ≥ 3). Posts numbered book list to `#voting`. |
| `/vote <first> <second> <third>` | features/voting | Members cast their 1st/2nd/3rd choice by number. All three must be different. Can re-run to update picks. |
| `/voting-end` | features/voting | Admin-only. Closes voting and announces winner in `#voting`. Tiebreaker: most 1st-choice wins, then 2nd, then 3rd. |
| `/register <user> <channel>` | reading-tracker | Admin-only. Maps a Discord member to their personal forum channel. Channel must be a forum channel. Safe to re-run to update. |
| `/read <url>` | reading-tracker | Starts tracking a book. Scrapes Goodreads, creates a thread in the member's forum channel, upserts the Book record, and opens a ReadingLog. If the book is a club read, updates the #progress post. |
| `/progress` | reading-tracker | Logs reading progress. Run from inside a book thread. Accepts `page` OR `percentage` (not both). Stored as a float percentage (0–100). Updates #progress if club read. |
| `/rate <rating>` | reading-tracker | Rates the book 1–5 stars (decimals allowed, e.g. 4.5). Run from inside a book thread. |
| `/finish` | reading-tracker | Marks the book as finished. Posts a completion embed in the thread. Sets progress to 100% and updates #progress if club read. |
| `/club-start <url>` | reading-tracker | Admin-only. Designates a book as the active club read. Creates a thread in every registered member's forum channel (with "Bot" and "Book Club Book" tags if they exist on that channel, skipping tags gracefully on failure), creates ReadingLog entries, and posts/refreshes the #progress channel post. Safe to re-run. |

### Channel lookup patterns

- **`#voting`** — looked up by name (`VOTING_CHANNEL_NAME = 'voting'`) via `guild.channels.cache.find`. Used by voting commands.
- **`#progress`** — looked up by name (`'progress'`) via `guild.channels.cache.find` in `lib/progressPost.js`. **TODO: store channel ID in DB** (same pattern as member channels) to make it rename-proof.
- **Member forum channels** — stored by ID in `MemberChannel.channelId`. Fetched via `guild.channels.fetch(id)`.

### Thread routing pattern

`/progress`, `/rate`, and `/finish` route to the correct book by looking up `ReadingLog` by `threadId = interaction.channelId`. Members run these commands from inside the relevant book thread — no book argument needed.

```js
const log = await db.readingLog.findUnique({
  where: { threadId: interaction.channelId },
  include: { book: true },
});
if (!log) {
  await interaction.reply({ content: 'Run this from inside one of your book threads.', flags: MessageFlags.Ephemeral });
  return;
}
```

### Adding a new slash command

1. Create `commands/<name>.js` exporting `{ data, execute }`.
2. Run `node deploy-commands.js` to register it with Discord.
No changes to `index.js` or `deploy-commands.js` are needed.

## Database

Prisma 5 + SQLite. Schema lives in `prisma/schema.prisma`. The client is generated into `node_modules/@prisma/client`.

After any schema change:
```bash
npx prisma db push --accept-data-loss  # dev
npx prisma generate
```

### Models

| Model | Purpose |
|---|---|
| `Book` | Canonical book record scraped from Goodreads. `genres` is stored as a JSON string. |
| `NominationPeriod` | Admin-configured record for a month: `active` flag, `openToAll` flag, optional `nominatorId`/`nominatorName`. Unique on `(month, year)`. |
| `Nomination` | A book nomination submitted by a member. One per user per month in open periods; overwritten on re-nomination. Unlimited in restricted periods. |
| `Poll` / `PollVote` | Legacy polling models (pre-ranked voting). Present in schema on this branch. |
| `CurrentBook` | The active book the club is reading. One row per book (`bookId` unique). |
| `ReadingProgress` | A member's page progress through the current book (legacy model). |
| `MemberChannel` | Maps a Discord user (snowflake) to their personal forum channel ID. Set by `/register`. `userId` and `channelId` are both `@unique`. |
| `ReadingLog` | One entry per member per book thread. `threadId` is `@unique` and routes `/progress`, `/rate`, `/finish`. Stores `progress` (Float, 0–100), `rating` (Float?, 1–5), `status` ("reading"\|"finished"), `startedAt`, `finishedAt`. |
| `ClubBook` | Marks a book as a community club read. Stores `progressMessageId` — the Discord message ID of the #progress post for that book. One record per book (`bookId @unique`). |

### Nomination logic

- `/nominations-start` sets `NominationPeriod.active = true` for the current month.
- `/nominate` checks `active` before accepting nominations.
- Open-to-all: one nomination per user per month. Re-nominating overwrites the existing record.
- Restricted: only the designated `nominatorId` may nominate, no cap.

### Voting logic

- `/voting-start` deduplicates nominations by `bookId` (ordered by `createdAt asc`), stores the ordered list in `VotingPeriod.bookIds`, and creates the period.
- `/vote` maps the user's 1-based choices to `bookIds`, validates all three are distinct and in range, then upserts a `RankedVote`.
- `/voting-end` tallies `firstBookId`, `secondBookId`, `thirdBookId` counts per book, sorts by `first DESC → second DESC → third DESC`, and announces the winner.

### Reading tracker logic

- `/register` upserts `MemberChannel` for a user. Channel must be `ChannelType.GuildForum`.
- `/read` validates the Goodreads URL, scrapes the book, looks up the member's `MemberChannel`, creates a forum thread, upserts `Book`, creates `ReadingLog`, then calls `updateProgressPost` (no-op if not a club book).
- `/progress` accepts `page` (Integer) or `percentage` (Number), exactly one required. Page is converted to percentage using `book.pages`. Stored as `ReadingLog.progress` (Float 0–100).
- `/rate` accepts a Number 1–5 (decimals allowed). Stored as `ReadingLog.rating` (Float).
- `/finish` sets `status = "finished"`, `finishedAt = now()`, `progress = 100`, posts a completion embed, then calls `updateProgressPost`.
- `/club-start` upserts `ClubBook`, creates threads in all member channels (falls back to no tags if tag application fails), creates `ReadingLog` entries for members who don't have one, then calls `updateProgressPost`.
- `updateProgressPost` in `lib/progressPost.js` fetches all `ReadingLog` entries for the book, renders an ASCII bar per member, and edits the stored #progress message (or creates a new one and saves its ID).

## Notes

- All ephemeral replies use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`).
- Discord user IDs are stored as `String` — they are snowflakes that exceed JS integer range.
- Prisma 7 was tried and reverted — it requires driver adapters for SQLite and is incompatible with this plain CommonJS setup. Stay on Prisma 5.
- Jest is configured (`"testMatch": ["**/tests/**/*.test.js"]`) to ignore `commands/test.js`.
- `npx prisma migrate dev` may fail non-interactively — use `npx prisma db push --accept-data-loss` in dev instead.
