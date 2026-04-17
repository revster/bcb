# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- **Never add `Co-Authored-By` trailers to git commits.** The sole contributor on this repo is the human owner. Do not include any Claude co-author lines in commit messages.
- **Only push `main` to the remote.** Feature branches stay local only. Never run `git push` on a feature branch.

## Purpose

A Discord bot for managing a book club server. Core features:

- **Personal reading tracker** — each member has a personal forum channel; `/read` starts a book thread, `/progress` and `/rate` are run from inside the thread
- **Club read tracking** — `/club-start` designates the community-voted book, creates threads for all members, maintains a live progress post in `#progress`, and opens a spoiler discussion thread in `#epilogue`
- **Report commands** — `/stats`, `/leaderboard`, `/finishers`, `/abandoners`, `/abandoned`
- **Admin web panel** — Express/EJS site at `website/`; Discord OAuth2 login restricted to admin roles; admins can view, create, edit, and delete reading logs
- **Monthly nominations & ranked voting** — on the `features/voting` branch

## Branches

- `main` — stable; contains all merged features to date. **This is the only branch pushed to remote.**
- `features/voting` — nominations and ranked voting system (not yet merged)
- `features/reading-tracker` — personal reading tracker + club read tracking (merged into main)
- `features/reports` — report commands /stats, /leaderboard, /finishers, /abandoners, /abandoned (merged into main)
- `features/website` — admin web panel with Discord OAuth2 (merged into main)
- `features/reminder` — weekly reading reminders with quip management (merged into main)
- `features/typescript` — full TypeScript migration (merged into main via features/drizzle)
- `features/drizzle` — Prisma → Drizzle ORM migration, TypeScript, enhanced /stats, BOTM vs club read distinction, seed script (merged into main)

**The `dev.db` file is not tracked by git.** To recreate it from scratch: `rm -f dev.db && npx drizzle-kit push`. Schema is defined in `schema.ts`.

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
npm run bot                            # Start the Discord bot (tsx index.ts)
npm run website                        # Start the admin web panel (http://localhost:3000)
npx tsx deploy-commands.ts             # Register slash commands with Discord (re-run after any command schema changes)
npx tsx clear-global-commands.ts       # Wipe globally-registered commands (fixes duplicate commands from old deployments)
npx tsx seed.ts                        # Seed initial reminder quips (run once after drizzle-kit push on a fresh db)
npm test                               # Run unit tests (Jest via ts-jest)
npm run typecheck                      # Type-check the whole project without emitting (tsc --noEmit)
npx drizzle-kit studio                 # Browse the database in a web UI
rm -f dev.db && npx drizzle-kit push   # Recreate the SQLite schema from scratch (dev only — deletes all data)
```

## Architecture

- `index.ts` — Bot entry point. Loads all commands from `commands/` into a Collection at startup, then dispatches incoming interactions by command name. Wraps every command in a try/catch and replies with an ephemeral error if it throws.
- `deploy-commands.ts` — One-off script to register guild-scoped slash commands via REST. Auto-discovers all files in `commands/` so new commands are picked up automatically.
- `clear-global-commands.ts` — One-off script to wipe globally-registered slash commands. Run this if duplicate commands appear in Discord (caused by old global registrations alongside guild-scoped ones).
- `db.ts` — Creates a better-sqlite3 connection and exports a Drizzle ORM instance (with the full schema loaded for relational queries). Import with `import db = require('../db')` wherever database access is needed.
- `schema.ts` — Drizzle table definitions and inferred TypeScript types for all tables. All unique constraints use explicit `unique('name').on(col)` in the table constraints array (not inline `.unique()` on columns). Dates stored as ISO 8601 TEXT via a custom `timestamp` type.
- `lib/scrapeBook.ts` — Fetches a Goodreads book page and extracts metadata (title, author, rating, pages, image, genres) from the JSON-LD script tag and HTML. HTML entities in titles/authors are decoded via cheerio.
- `lib/buildBookEmbed.ts` — Single source of truth for the book info embed. Used by `/read`, `/club-start` (member threads + epilogue), `/abandon`, and `progressPost.ts`. Accepts genres as either an array (scraped data) or a JSON string (DB record).
- `lib/progressPost.ts` — Maintains the two-message `#progress` post for club books. Message 1 is the book embed; message 2 is the monospace progress bar block. Both message IDs are stored on `ClubBook` and edited in-place; if either is missing both are recreated. Deduplicates by user (most recent log per user). Called after any command that changes reading status or progress.
- `lib/botLog.ts` — Posts a timestamped (`HH:MM:SS UTC`) event to `#bot-log` (looked up by name in guild cache). Swallows errors silently so logging never breaks a command. Imported by every command.
- `lib/resolveUsernames.ts` — Merges `User` and `MemberChannel` tables to map Discord user IDs to display names. `User` table wins (more recent). Used by `/leaderboard`, `/finishers`, `/abandoners`.

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
| `/club-start <url> [month] [year]` | Admin. Designates a book as the active club read. Always creates threads for all registered members and opens an epilogue thread. If `month` and `year` are provided, applies the "Bot" and "Book of the Month" tags and the book counts as an official BOTM in all reports. Without month/year, only the "Bot" tag is applied and the book is excluded from BOTM stats (threads and progress tracking still work normally). Both or neither must be supplied — providing only one is rejected. |
| `/stats [user]` | Personal reading summary. Defaults to caller; pass a user to look up someone else. Sections: currently reading (mini progress bars), this year vs all-time finished/reading/abandoned counts, total pages, avg rating, favourite genre, longest book finished, and two BOTM subsections (This Year and All Time) with completion rate, avg rating, and longest streak. Only club books with both month and year set count as BOTM. Deduplicates by bookId using status priority: finished > reading > abandoned. |
| `/leaderboard [year]` | Without year: ranked list of members by total BOTM completions (all time). With year: monospace grid of members × months showing who finished each club read. |
| `/finishers [year]` | Ranks members by number of club reads completed. Shows finished count, enrolled count, completion rate. Optional year filter. Competition ranking (1,1,3). |
| `/abandoners [year]` | Ranks members by number of club reads abandoned. Shows abandoned count, enrolled count, abandonment rate. Optional year filter. Competition ranking. |
| `/abandoned` | Ranks club books by how many members abandoned them. Shows title, author, month/year, abandoned/enrolled ratio. Competition ranking. |

### Discord channels (all looked up by name, never stored by ID)

| Channel | Name constant | Purpose |
|---|---|---|
| `#progress` | `'progress'` | Two-message club read progress post. Managed by `lib/progressPost.ts`. |
| `#epilogue` | `'epilogue'` | Spoiler discussion. One thread per club book created by `/club-start`. `/progress` (at 100%) links here. `/rate` posts ratings here for club reads. |
| `#bot-log` | `'bot-log'` | Admin-only event log. All commands post here on success. Create in Discord and restrict to admins + bot role. |

### Bot-managed thread guard

`/progress`, `/rate`, and `/abandon` check at the top of `execute` that the current thread has the "Bot" tag applied (looked up by name on the parent forum channel's `availableTags`). If the tag is missing the command rejects ephemerally. This ensures commands only run in bot-created threads.

### Ownership guard

`/progress`, `/rate`, and `/abandon` check that `log.userId === interaction.user.id`. Users can only modify their own reading logs.

### Thread routing pattern

`/progress`, `/rate`, and `/abandon` route to the correct book by looking up `ReadingLog` by `threadId = interaction.channelId`. No book argument needed — members run these from inside the relevant thread.

```typescript
const log = await db.query.readingLogs.findFirst({
  where: (rl, { eq }) => eq(rl.threadId, interaction.channelId),
  with: { book: true },
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

**Entry point:** `website/server.ts` — mounts Helmet (CSP, etc.), sessions (SQLite via `connect-sqlite3`), CSRF middleware, rate limiting on auth routes, and the three routers.

**Routers:**
- `website/routes/auth.ts` — Discord OAuth2 flow (`/auth/discord` → callback → session), logout
- `website/routes/admin.ts` — HTML pages: dashboard, log list (with member/status filter), create/edit/delete log
- `website/routes/api.ts` — JSON API: `/api/books/scrape` (Goodreads lookup — validates URL against `GOODREADS_BOOK_RE` before scraping to prevent SSRF), `/api/members`, `/api/logs`

**Middleware:**
- `website/middleware/requireAdmin.ts` — redirects to `/auth/login` if no session user; sets `res.locals.user`
- `website/middleware/csrf.ts` — per-session CSRF token; validates `_csrf` field on all mutating requests; skips `/auth/discord/callback`

**Auth flow:** Discord OAuth2 with `identify` scope. After token exchange, `isAdmin()` in `website/lib/discord.ts` checks the user's guild roles against `ADMIN_ROLE_NAMES`. Only matching roles get a session. `website/lib/discord.ts` exports a `DiscordUser` interface (`id`, `username`, `global_name`, `avatar`) — use it instead of `any` when working with Discord user objects from the OAuth flow.

**CSP note:** Helmet sets `script-src-attr 'none'` by default, which blocks all inline `onclick`/`onchange` attributes. All event handlers in EJS templates must be wired with `addEventListener` in `<script>` blocks — never use inline handlers.

**Views:** EJS templates in `website/views/`. Partials: `head.ejs` (applies saved dark/light theme before render to prevent flash), `nav.ejs` (includes theme toggle script). Dark mode is toggled via `data-theme="dark"` on `<html>` and persisted in `localStorage`.

### Adding a new slash command

1. Create `commands/<name>.ts` exporting `data` and `execute` (named exports).
2. Run `npx tsx deploy-commands.ts` to register it with Discord.

No changes to `index.ts` or `deploy-commands.ts` are needed — commands are auto-discovered.

## Database

Drizzle ORM + better-sqlite3 (synchronous SQLite). Schema lives in `schema.ts`. Config in `drizzle.config.ts`.

To recreate the database from scratch (dev only):
```bash
rm -f dev.db && npx drizzle-kit push
```

`drizzle-kit push` is not idempotent — running it on an existing database with the same schema will fail with "index already exists". Always delete `dev.db` first.

### Tables

| Table | Purpose |
|---|---|
| `Book` | Canonical book record scraped from Goodreads. `genres` stored as a JSON string. |
| `MemberChannel` | Maps a Discord user (`userId`, snowflake string) to their personal forum channel (`channelId`). Set by `/register`. Both fields are unique. |
| `ReadingLog` | One entry per member per book thread. `threadId` is unique and routes `/progress`, `/rate`, `/abandon`. Fields: `progress` (real 0–100), `rating` (real? 1–5), `status` (`"reading"` \| `"finished"` \| `"abandoned"`), `startedAt`, `finishedAt`. Multiple logs per user+book are allowed (re-reads). |
| `ClubBook` | Marks a book as a club read. Stores `progressMessageId` and `progressBarsMessageId` (the two `#progress` messages), `epilogueThreadId`, and optional `month`/`year` for display. |
| `User` | Known Discord users. Upserted on every command interaction. Used by report commands to resolve display names. |
| `Setting` | Key/value store. Used for `reminders_enabled` flag. |
| `ReminderQuip` | Text quips used in weekly reminder pings. |

### Tables present in schema but unused on main

`NominationPeriod`, `Nomination`, `Poll`, `PollVote`, `CurrentBook`, `ReadingProgress` — these belong to `features/voting` or are legacy. Do not remove them; they share the same schema file.

### Drizzle query patterns

```typescript
import db = require('../db');
import { eq, inArray, asc } from 'drizzle-orm';
import { books, readingLogs, clubBooks } from '../schema';

// Synchronous select (.get() for one row, .all() for multiple)
const book = db.select().from(books).where(eq(books.id, id)).get();
const logs = db.select().from(readingLogs).where(eq(readingLogs.bookId, id)).all();

// Relational query (awaitable — returns a Promise)
const log = await db.query.readingLogs.findFirst({
  where: (rl, { eq }) => eq(rl.threadId, threadId),
  with: { book: true },
});

// Insert / update / delete (synchronous — use .run())
db.insert(books).values({ title, author, goodreadsUrl, genres, createdAt: new Date() }).run();
db.update(readingLogs).set({ progress: 75 }).where(eq(readingLogs.id, id)).run();
```

### TypeScript types

Types are inferred from the schema and exported from `schema.ts`:
```typescript
import type { Book, ReadingLog, ClubBook, LogWithBook } from '../schema';
```
`LogWithBook` is a convenience alias for `ReadingLog & { book: Book }`.

### Reading tracker logic

- `/register` upserts `MemberChannel`. Channel must be `ChannelType.GuildForum`.
- `/unregister` deletes the `MemberChannel` row. Existing `ReadingLog` entries and threads are untouched.
- `/read` scrapes the book, fetches the member's forum channel (gives a user-friendly error if the channel is gone), applies the "Bot" tag if available, creates the thread, upserts `Book`, creates `ReadingLog`, then calls `updateProgressPost`.
- `/progress` validates Bot tag + ownership + not-finished. Converts page → percentage using `book.pages`. If result ≥ 100: sets `status = "finished"`, `finishedAt = now()`, `progress = 100`, posts completion embed, links to epilogue if club read. Otherwise updates `progress` (and resets `status = "reading"` if previously abandoned). Calls `updateProgressPost`.
- `/rate` validates Bot tag + ownership. Saves rating at any status. Posts star display in thread. If club read, posts rating in epilogue thread.
- `/abandon` validates Bot tag + ownership + not-finished + not-already-abandoned. Sets `status = "abandoned"`. Posts embed showing progress at time of abandonment. Calls `updateProgressPost`.
- `/club-start` scrapes or reuses the `Book`; upserts `ClubBook` (with optional `month`/`year`); creates a new thread per registered member applying "Bot" and "Book of the Month" tags — if either tag is missing from a channel, posts a warning to `#bot-log` mentioning the admin user (`<@userId>`) and the affected channel, then continues (thread is still created); creates a `ReadingLog` per thread; creates the `#epilogue` spoiler thread once (skips on re-run if `epilogueThreadId` already set); calls `updateProgressPost`.
- `updateProgressPost` fetches all `ReadingLog` entries for the book, deduplicates by user (most recent log per user), pads usernames to equal width, renders a monospace bar block, then edits both stored `#progress` messages in-place (or sends fresh ones if missing).

## Production migration

When deploying to a new server:
1. Deploy code to VPS, copy `.env`.
2. Run `rm -f dev.db && npx drizzle-kit push` to initialise the schema.
3. Run `npx tsx seed.ts` to load the reminder quips.
4. Run `npx tsx deploy-commands.ts` to register slash commands with the new guild.
5. Admin runs `/register` for each member pointing at the new server's forum channels.
6. Admin runs `/club-start` for the active book if one is in progress — this recreates the `#progress` post and `#epilogue` thread on the new server.

Discord user IDs are global (same across servers) so all `MemberChannel.userId` and `ReadingLog.userId` values are portable. Channel and message IDs are server-specific and will be re-established through the steps above.

## TypeScript

The codebase is fully TypeScript (`features/typescript` branch). Key patterns:

### Module exports
- **`db.ts` and `lib/scrapeBook.ts`** use `export =` (CommonJS-compatible default export). Consumers use `import db = require('../db')` or `import scrapeBook from '../lib/scrapeBook'` (ts-jest handles the interop in tests).
- **All other files** (commands, lib, website) use named exports: `export const data`, `export async function execute(...)`, `export function myHelper(...)`.

### Drizzle type inference requires `import db = require()`
Using `const db = require('../db')` types `db` as `any`, which silently disables type checking on all Drizzle calls — including relational query callbacks like `where: (rl, { eq }) => ...`. Always use `import db = require('../db')` so TypeScript can infer the correct types. This applies to website routes as well as commands.

### Discord.js type casts
`ThreadChannel.parent` is a union that doesn't include `ForumChannel`. Cast where needed:
```typescript
const botTag = (channel.parent as ForumChannel | null)?.availableTags?.find(t => t.name === 'Bot');
const currentTags = channel.appliedTags as string[] ?? [];
```

### tsx runner
`tsx` executes TypeScript directly without a compile step. All `npm run` scripts use it. No `dist/` directory — the source files are the runtime files.

### ts-jest
Tests run via `ts-jest` with `diagnostics: false` (skips per-file type errors during test runs). Full type checking is done separately with `npm run typecheck`.

### tsconfig.json key settings
- `"moduleDetection": "force"` — treats every file as a module even without imports/exports
- `"moduleResolution": "node10"` — required for CommonJS `require()` interop
- `"ignoreDeprecations": "6.0"` — suppresses node10 deprecation warning
- `"noEmit": true` — typecheck-only; tsx handles execution directly

### Error handler in index.ts
`editReply` does not accept `MessageFlags.Ephemeral` (only `SuppressEmbeds | IsComponentsV2` are allowed). Split the error handler:
```typescript
if (interaction.deferred || interaction.replied) {
  await interaction.editReply({ content: 'Something went wrong.' });
} else {
  await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
}
```

### Thread tags (progress/abandon)
When a book is finished or abandoned, apply the matching forum tag if it exists on the parent channel. Silently swallow permissions errors:
```typescript
const completedTag = (channel.parent as ForumChannel | null)?.availableTags?.find(t => t.name === 'Completed');
if (completedTag) {
  const currentTags = channel.appliedTags as string[] ?? [];
  await channel.setAppliedTags([...new Set([...currentTags, completedTag.id])]).catch(() => null);
}
```
Same pattern for "Abandoned" tag in `commands/abandon.ts`. Tags are optional — the command succeeds regardless.

## Notes

- All ephemeral replies use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`).
- Discord user IDs are stored as `text` — snowflakes exceed JS integer range.
- `drizzle-kit push` is not idempotent for SQLite unique indexes in v0.31.x — always `rm -f dev.db` before pushing. This is a known drizzle-kit bug.
- Jest is configured (`"testMatch": ["**/tests/**/*.test.ts"]`) to pick up TypeScript test files; `commands/test.ts` is excluded by the pattern.
- Jest 30: `clearAllMocks()` does not reset `mockReturnValueOnce` queues. Tests must call `.mockReset()` on terminal mocks (`mockGet`, `mockAll`, `mockRun`, `mockFindFirst`, `mockFindMany`) in `afterEach` before calling `jest.clearAllMocks()`.
- `lib/scrapeBook.ts` decodes HTML entities via `$('<textarea>').html(str).text()` (cheerio is already a dependency). Goodreads JSON-LD sometimes HTML-encodes strings like apostrophes.
