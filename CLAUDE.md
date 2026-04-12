# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A Discord bot for managing a book club server. Core features (planned or in progress):

- **Monthly nominations** — members nominate books each month; an admin configures each month via `/setup`
- **Polls** — vote on nominated books to pick the monthly read
- **Current book tracking** — bot knows what the active book is
- **Reading progress** — members can update and share their progress through the current book

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
- `lib/scrapeBook.js` — Fetches a Goodreads book page and extracts metadata (title, author, rating, pages, image, genres) from the JSON-LD script tag and HTML. Used by the `/read` command.

### Commands (`commands/`)

Each file exports `{ data, execute }` — `data` is a `SlashCommandBuilder` and `execute` is the async handler.

| Command | Description |
|---|---|
| `/ping` | Health check |
| `/read <url>` | Looks up a Goodreads book URL and displays title, author, rating, pages, and genres in an embed |
| `/setup <month> <year> [nominator]` | Admin-only. Configures nominations for a month. Omit `nominator` for open-to-all; provide a user to restrict nominations to that person. |

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
| `NominationPeriod` | Admin-configured record for a month: `openToAll` flag, optional `nominatorId`/`nominatorName`. Unique on `(month, year)`. |
| `Nomination` | A book nomination submitted by a member. No unique constraint — enforcement is done in application code based on the period's `openToAll` flag. |
| `Poll` | A monthly vote. Has an `open` flag. Unique on `(month, year)`. |
| `PollVote` | One vote per user per poll. References `bookId` directly for easy tallying. |
| `CurrentBook` | The active book the club is reading. One row per book (`bookId` unique). |
| `ReadingProgress` | A member's page progress through the current book. One entry per user per book, updated in-place. |

### Nomination logic (not yet implemented)

When a nomination is submitted, the handler must:
1. Look up the `NominationPeriod` for the current month.
2. If `openToAll` → reject if the user already has a nomination that month.
3. If not `openToAll` → only allow the designated `nominatorId`, no cap on submissions.

## Notes

- All ephemeral replies use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`).
- Discord user IDs are stored as `String` — they are snowflakes that exceed JS integer range.
- Prisma 7 was tried and reverted — it requires driver adapters for SQLite and is incompatible with this plain CommonJS setup. Stay on Prisma 5.
