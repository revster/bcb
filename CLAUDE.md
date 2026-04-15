# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A Discord bot for managing a book club server. Core features:

- **Personal reading tracker** — each member has a personal forum channel; `/read` starts a book thread, `/progress` and `/rate` are run from inside the thread
- **Club read tracking** — `/club-start` designates the community-voted book, creates threads for all members, maintains a live progress post in `#progress`, and opens a spoiler discussion thread in `#epilogue`
- **Report commands** — `/stats`, `/leaderboard`, `/finishers`, `/abandoners`, `/abandoned`
- **Admin web panel** — Express/EJS site at `website/`; Discord OAuth2 login restricted to admin roles; admins can view, create, edit, and delete reading logs
- **Monthly nominations & ranked voting** — on the `features/voting` branch

## Branches

- `main` — stable; contains all merged features to date
- `features/voting` — nominations and ranked voting system (not yet merged)
- `features/reading-tracker` — personal reading tracker + club read tracking (merged into main)
- `features/reports` — report commands /stats, /leaderboard, /finishers, /abandoners, /abandoned (merged into main)
- `features/website` — admin web panel with Discord OAuth2 (merged into main)

**The `dev.db` file is not tracked by git.** Its schema reflects whichever migrations have been run locally, regardless of which branch is checked out. If the live database is out of sync with the checked-out branch's `prisma/schema.prisma`, run `npx prisma db push --accept-data-loss` (dev) or `npx prisma migrate dev` (prod-safe) to bring it in line.

## Environment

Requires a `.env` file with:
- `TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application/client ID
- `GUILD_ID` — Discord server (guild) ID for registering guild-scoped commands
- `DATABASE_URL` — SQLite connection string (e.g. `file:./dev.db`)
- `SESSION_SECRET` — secret for Express session signing (web panel only)
- `DISCORD_CLIENT_SECRET` — OAuth2 client secret (web panel only)
- `DISCORD_REDIRECT_URI` — OAuth2 redirect URI, e.g. `http://localhost:3000/auth/discord/callback` (web panel only)

## Dev Commands

```bash
npm install                            # Install dependencies
npm run bot                            # Start the Discord bot (node index.js)
npm run website                        # Start the admin web panel (http://localhost:3000)
node deploy-commands.js                # Register slash commands with Discord (re-run after any command schema changes)
node clear-global-commands.js          # Wipe globally-registered commands (fixes duplicate commands from old deployments)
npm test                               # Run unit tests (Jest)
npx prisma studio                      # Browse the database in a web UI
npx prisma db push --accept-data-loss  # Apply schema changes in dev (data loss ok)
npx prisma migrate dev                 # Apply schema changes and create a migration (production-safe)
npx prisma generate                    # Regenerate the Prisma client after schema changes
```

## Architecture

- `index.js` — Bot entry point. Loads all commands from `commands/` into a Collection at startup, then dispatches incoming interactions by command name. Wraps every command in a try/catch and replies with an ephemeral error if it throws.
- `deploy-commands.js` — One-off script to register guild-scoped slash commands via REST. Auto-discovers all files in `commands/` so new commands are picked up automatically.
- `clear-global-commands.js` — One-off script to wipe globally-registered slash commands. Run this if duplicate commands appear in Discord (caused by old global registrations alongside guild-scoped ones).
- `db.js` — Exports a singleton `PrismaClient` instance. Import this wherever database access is needed.
- `lib/scrapeBook.js` — Fetches a Goodreads book page and extracts metadata (title, author, rating, pages, image, genres) from the JSON-LD script tag and HTML. HTML entities in titles/authors are decoded via cheerio.
- `lib/buildBookEmbed.js` — Single source of truth for the book info embed. Used by `/read`, `/club-start` (member threads + epilogue), `/abandon`, and `progressPost.js`. Accepts genres as either an array (scraped data) or a JSON string (DB record).
- `lib/progressPost.js` — Maintains the two-message `#progress` post for club books. Message 1 is the book embed; message 2 is the monospace progress bar block. Both message IDs are stored on `ClubBook` and edited in-place; if either is missing both are recreated. Deduplicates by user (most recent log per user). Called after any command that changes reading status or progress.
- `lib/botLog.js` — Posts a timestamped (`HH:MM:SS UTC`) event to `#bot-log` (looked up by name in guild cache). Swallows errors silently so logging never breaks a command. Imported by every command.
- `lib/resolveUsernames.js` — Merges `User` and `MemberChannel` tables to map Discord user IDs to display names. `User` table wins (more recent). Used by `/leaderboard`, `/finishers`, `/abandoners`.

### Commands (`commands/`)

Each file exports `{ data, execute }` — `data` is a `SlashCommandBuilder` and `execute` is the async handler.

| Command | Description |
|---|---|
| `/ping` | Health check. |
| `/test <url>` | Scrapes a Goodreads URL and displays a metadata embed. Dev tool for verifying the scraper. |
| `/register <user> <channel>` | Admin. Maps a member to their personal forum channel (must be a forum channel). Safe to re-run to update. |
| `/unregister <user>` | Admin. Removes a member's forum channel registration. Existing threads and logs are untouched. |
| `/read <url>` | Starts tracking a book. Scrapes Goodreads, creates a thread in the member's forum channel (with "Bot" tag), upserts the `Book` record, and opens a `ReadingLog`. |
| `/progress [page] [percentage]` | Logs reading progress from inside a bot-managed thread. Exactly one of `page` or `percentage` required. At 100% automatically marks the book finished (posts completion embed, links to epilogue if club read). Logging progress on an abandoned book resumes it. |
| `/rate <rating>` | Rates the book 1–5 stars (decimals allowed). Works at any status (reading, finished, abandoned). Posts rating in thread and, if a club read, in the epilogue thread. |
| `/abandon` | Marks the book as abandoned at current progress. Shows `✗` in `#progress`. |
| `/club-start <url> [month] [year]` | Admin. Designates a book as the active club read. Always creates a new thread per registered member with "Bot" and "Book of the Month" tags (errors if tags fail). Optional `month`/`year` displayed in `#progress`. Creates a spoiler discussion thread in `#epilogue` once per club book. |
| `/stats [user]` | Personal reading summary. Defaults to caller; pass a user to look up someone else. Two sections: All Reads (finished/reading/abandoned counts, total pages, avg rating, favourite genre) and Book of the Month (completion rate, avg rating for club reads). Omits BOTM section if user has no club logs. Deduplicates by bookId using status priority: finished > reading > abandoned. |
| `/leaderboard [year]` | Without year: ranked list of members by total BOTM completions (all time). With year: monospace grid of members × months showing who finished each club read. |
| `/finishers [year]` | Ranks members by number of club reads completed. Shows finished count, enrolled count, completion rate. Optional year filter. Competition ranking (1,1,3). |
| `/abandoners [year]` | Ranks members by number of club reads abandoned. Shows abandoned count, enrolled count, abandonment rate. Optional year filter. Competition ranking. |
| `/abandoned` | Ranks club books by how many members abandoned them. Shows title, author, month/year, abandoned/enrolled ratio. Competition ranking. |

### Discord channels (all looked up by name, never stored by ID)

| Channel | Name constant | Purpose |
|---|---|---|
| `#progress` | `'progress'` | Two-message club read progress post. Managed by `lib/progressPost.js`. |
| `#epilogue` | `'epilogue'` | Spoiler discussion. One thread per club book created by `/club-start`. `/progress` (at 100%) links here. `/rate` posts ratings here for club reads. |
| `#bot-log` | `'bot-log'` | Admin-only event log. All commands post here on success. Create in Discord and restrict to admins + bot role. |

### Bot-managed thread guard

`/progress`, `/rate`, and `/abandon` check at the top of `execute` that the current thread has the "Bot" tag applied (looked up by name on the parent forum channel's `availableTags`). If the tag is missing the command rejects ephemerally. This ensures commands only run in bot-created threads.

### Ownership guard

`/progress`, `/rate`, and `/abandon` check that `log.userId === interaction.user.id`. Users can only modify their own reading logs.

### Thread routing pattern

`/progress`, `/rate`, and `/abandon` route to the correct book by looking up `ReadingLog` by `threadId = interaction.channelId`. No book argument needed — members run these from inside the relevant thread.

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

### Report deduplication logic

`/club-start` re-runs create a new `ReadingLog` with `status='reading'` for the same book. All report commands handle this by grouping logs per `userId:bookId` and applying status priority: **finished > reading > abandoned**. A book counts as finished if *any* log for that user+book has `status='finished'`, regardless of log order. This prevents phantom inflation of reading/abandoned counts from re-run threads.

### Admin website (`website/`)

An Express 5 + EJS web panel for admins. Started with `npm run website` (port 3000 by default).

**Entry point:** `website/server.js` — mounts Helmet (CSP, etc.), sessions (SQLite via `connect-sqlite3`), CSRF middleware, rate limiting on auth routes, and the three routers.

**Routers:**
- `website/routes/auth.js` — Discord OAuth2 flow (`/auth/discord` → callback → session), logout
- `website/routes/admin.js` — HTML pages: dashboard, log list (with member/status filter), create/edit/delete log
- `website/routes/api.js` — JSON API: `/api/books/scrape` (Goodreads lookup), `/api/members`, `/api/logs`

**Middleware:**
- `website/middleware/requireAdmin.js` — redirects to `/auth/login` if no session user; sets `res.locals.user`
- `website/middleware/csrf.js` — per-session CSRF token; validates `_csrf` field on all mutating requests; skips `/auth/discord/callback`

**Auth flow:** Discord OAuth2 with `identify` scope. After token exchange, `isAdmin()` in `website/lib/discord.js` checks the user's guild roles against `ADMIN_ROLE_NAMES`. Only matching roles get a session.

**CSP note:** Helmet sets `script-src-attr 'none'` by default, which blocks all inline `onclick`/`onchange` attributes. All event handlers in EJS templates must be wired with `addEventListener` in `<script>` blocks — never use inline handlers.

**Views:** EJS templates in `website/views/`. Partials: `head.ejs` (applies saved dark/light theme before render to prevent flash), `nav.ejs` (includes theme toggle script). Dark mode is toggled via `data-theme="dark"` on `<html>` and persisted in `localStorage`.

### Adding a new slash command

1. Create `commands/<name>.js` exporting `{ data, execute }`.
2. Run `node deploy-commands.js` to register it with Discord.

No changes to `index.js` or `deploy-commands.js` are needed — commands are auto-discovered.

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
| `Book` | Canonical book record scraped from Goodreads. `genres` stored as a JSON string. |
| `MemberChannel` | Maps a Discord user (`userId`, snowflake string) to their personal forum channel (`channelId`). Set by `/register`. Both fields are `@unique`. |
| `ReadingLog` | One entry per member per book thread. `threadId` is `@unique` and routes `/progress`, `/rate`, `/abandon`. Fields: `progress` (Float 0–100), `rating` (Float? 1–5), `status` (`"reading"` \| `"finished"` \| `"abandoned"`), `startedAt`, `finishedAt`. Multiple logs per user+book are allowed (re-reads). |
| `ClubBook` | Marks a book as a club read. Stores `progressMessageId` and `progressBarsMessageId` (the two `#progress` messages), `epilogueThreadId` (the `#epilogue` spoiler thread), and optional `month`/`year` for display. |

| `User` | Known Discord users. Upserted on every command interaction (`userId`, `username`, `updatedAt`). Used by report commands to resolve display names. |

### Models present in schema but unused on main

`NominationPeriod`, `Nomination`, `Poll`, `PollVote`, `CurrentBook`, `ReadingProgress` — these belong to `features/voting` or are legacy models. Do not remove them; they share the same schema file.

### Reading tracker logic

- `/register` upserts `MemberChannel`. Channel must be `ChannelType.GuildForum`.
- `/unregister` deletes the `MemberChannel` row. Existing `ReadingLog` entries and threads are untouched.
- `/read` scrapes the book, fetches the member's forum channel (gives a user-friendly error if the channel is gone), applies the "Bot" tag if available, creates the thread, upserts `Book`, creates `ReadingLog`, then calls `updateProgressPost`.
- `/progress` validates Bot tag + ownership + not-finished. Converts page → percentage using `book.pages`. If result ≥ 100: sets `status = "finished"`, `finishedAt = now()`, `progress = 100`, posts completion embed, links to epilogue if club read. Otherwise updates `progress` (and resets `status = "reading"` if previously abandoned). Calls `updateProgressPost`.
- `/rate` validates Bot tag + ownership. Saves rating at any status. Posts star display in thread. If club read, posts rating in epilogue thread.
- `/abandon` validates Bot tag + ownership + not-finished + not-already-abandoned. Sets `status = "abandoned"`. Posts embed showing progress at time of abandonment. Calls `updateProgressPost`.
- `/club-start` scrapes or reuses the `Book`; upserts `ClubBook` (with optional `month`/`year`); creates a new thread per registered member applying "Bot" and "Book of the Month" tags (propagates errors — no silent fallback); creates a `ReadingLog` per thread; creates the `#epilogue` spoiler thread once (skips on re-run if `epilogueThreadId` already set); calls `updateProgressPost`.
- `updateProgressPost` fetches all `ReadingLog` entries for the book, deduplicates by user (most recent log per user), pads usernames to equal width, renders a monospace bar block, then edits both stored `#progress` messages in-place (or sends fresh ones if missing).

## Production migration

When deploying to a new server:
1. Deploy code to VPS, copy `.env`.
2. Run `npx prisma db push --accept-data-loss` to initialise the schema.
3. Run `node deploy-commands.js` to register slash commands with the new guild.
4. Admin runs `/register` for each member pointing at the new server's forum channels.
5. Admin runs `/club-start` for the active book if one is in progress — this recreates the `#progress` post and `#epilogue` thread on the new server.

Discord user IDs are global (same across servers) so all `MemberChannel.userId` and `ReadingLog.userId` values are portable. Channel and message IDs are server-specific and will be re-established through the steps above.

## Notes

- All ephemeral replies use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`).
- Discord user IDs are stored as `String` — snowflakes exceed JS integer range.
- Prisma 7 was tried and reverted — it requires driver adapters for SQLite and is incompatible with this plain CommonJS setup. Stay on Prisma 5.
- Jest is configured (`"testMatch": ["**/tests/**/*.test.js"]`) to ignore `commands/test.js`.
- `npx prisma migrate dev` may fail non-interactively — use `npx prisma db push --accept-data-loss` in dev instead.
- `lib/scrapeBook.js` decodes HTML entities via `$('<textarea>').html(str).text()` (cheerio is already a dependency). Goodreads JSON-LD sometimes HTML-encodes strings like apostrophes.
