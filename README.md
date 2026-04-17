# BCB — Book Club Bot

[![CI](https://github.com/revster/bcb/actions/workflows/ci.yml/badge.svg)](https://github.com/revster/bcb/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20+-brightgreen)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2)](https://discord.js.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/revster/bcb/blob/main/LICENSE)

A Discord bot and admin web panel for managing a book club server. Members can track their personal reading and participate in monthly club reads, all from inside Discord. Admins can manage reading logs through a web interface with Discord OAuth2 login.

## Features

### Personal reading tracker
Each registered member has a personal forum channel. Use `/read` to start a new book thread — the bot scrapes Goodreads for metadata and creates a thread with the cover, rating, and genre info. From inside that thread, use `/progress` to log how far you've gotten and `/rate` to leave a star rating. Use `/abandon` if a book isn't working out.

### Club read tracking
An admin uses `/club-start` to designate the monthly pick. The bot creates a reading thread for every registered member, opens a spoiler discussion thread in `#epilogue`, and maintains a live progress board in `#progress` showing every member's reading bar at a glance. The board updates automatically as members log progress.

```
alice    ████████████░░░░░░░░   62%
bob      ████████████████████  100% ✓
carol    ██████░░░░░░░░░░░░░░   31%
```

When a member finishes (progress hits 100%), the bot posts a completion embed in their thread and links to the `#epilogue` spoiler channel. Ratings posted via `/rate` are also shared in `#epilogue` so everyone who's finished can see them.

### Reports
A suite of commands for reviewing reading history across the club:

- `/stats` — personal reading summary (finished/reading/abandoned counts, total pages, avg rating, favourite genre, and a separate breakdown for club reads). Pass a user to look up someone else.
- `/leaderboard` — all-time club read completion ranking. Add a year for a grid showing who finished each month's pick.
- `/finishers` — ranks members by club reads completed, with enrolled count and completion rate.
- `/abandoners` — ranks members by club reads abandoned, with abandonment rate.
- `/abandoned` — ranks club books by how many members abandoned them.

All report commands handle re-runs of `/club-start` correctly — a member who has a `finished` log for a book is never double-counted as also `reading` it.

### Admin web panel
A browser-based admin interface at `http://localhost:3000` (or your deployed URL). Login is via Discord OAuth2 — only members with an admin role in the server are granted access. Admins can:

- View all reading logs with filtering by member and status
- Add historical reads (with Goodreads URL lookup)
- Edit or delete any log
- Mark books as Book of the Month with an optional month/year
- Manage the reminder quip library (add or remove quips)

### Weekly reading reminders
The bot pings members who haven't logged progress on the current month's Book of the Month in 7+ days, using a randomly selected quip from the admin-managed quip library. Reminders are idempotent — each member is pinged at most once every 7 days. Admins can toggle reminders on or off with `/reminders enable` / `/reminders disable`.

## Commands

### Admin
| Command | Description |
|---|---|
| `/register <user> <channel>` | Map a member to their personal forum channel |
| `/unregister <user>` | Remove a member from club tracking (threads/logs kept) |
| `/club-start <url> [month] [year]` | Start a club read — creates threads for all members, opens epilogue thread, initialises `#progress`. Providing `month` and `year` designates it as an official Book of the Month (appears in stats/leaderboard). Without them it's an informal club read — threads and progress tracking still work, but it won't count in BOTM reports. |
| `/reminders enable` | Enable weekly reading reminder pings |
| `/reminders disable` | Disable weekly reading reminder pings |
| `/reminders status` | Check whether reminders are currently enabled |
| `/checkup` | Verify every registered member has a valid forum channel with the required Bot and Book of the Month tags |

### Member
| Command | Description |
|---|---|
| `/read <url>` | Start tracking a personal book — creates a thread in your forum channel |
| `/progress [page] [percentage]` | Log reading progress from inside your book thread |
| `/rate <rating>` | Rate the book 1–5 stars (decimals allowed) from inside your book thread |
| `/abandon` | Mark the current book as abandoned |

### Reports
| Command | Description |
|---|---|
| `/stats [user]` | Personal reading summary — progress bars for current reads, this year vs all-time counts, total pages, avg rating, favourite genre, longest book finished, and a separate BOTM breakdown with completion streak |
| `/leaderboard [year]` | Club read completion ranking; year shows a month-by-month grid |
| `/finishers [year]` | Members ranked by club reads completed |
| `/abandoners [year]` | Members ranked by club reads abandoned |
| `/abandoned` | Club books ranked by how many members abandoned them |

### Utility
| Command | Description |
|---|---|
| `/ping` | Health check |
| `/test <url>` | Preview Goodreads metadata for a URL (dev tool) |

## Setup

### Prerequisites
- Node.js 20+
- A Discord application with a bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Installation

```bash
git clone https://github.com/revster/bcb.git
cd bcb
npm install
```

### Configuration

Create a `.env` file in the project root:

```
# Bot
TOKEN=your_bot_token
CLIENT_ID=your_application_client_id
GUILD_ID=your_discord_server_id
DATABASE_URL=file:./dev.db

# Web panel
SESSION_SECRET=a_long_random_string
DISCORD_CLIENT_SECRET=your_oauth2_client_secret
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
```

For the web panel, enable the OAuth2 redirect URI in your Discord application under **OAuth2 → Redirects**.

### Database

```bash
rm -f dev.db && npx drizzle-kit push   # Create the SQLite schema from scratch
npx tsx seed.ts                         # Seed initial quips (run once after pushing schema)
```

### Register slash commands

```bash
npx tsx deploy-commands.ts   # Register guild-scoped commands with Discord
```

### Run

```bash
npm run bot        # Start the Discord bot
npm run website    # Start the admin web panel (http://localhost:3000)
npm run typecheck  # Type-check the whole project
```

Both can run independently or together.

## Discord server setup

The bot looks up channels by name, not ID. Create these channels before running club commands:

| Channel | Purpose |
|---|---|
| `#progress` | Live club read progress board (managed by bot) |
| `#epilogue` | Spoiler discussion — one thread per club book |
| `#bot-log` | Admin event log — restrict to admins + bot role |

Each registered member also needs a **Forum channel** that the bot will create threads in. Pass that channel to `/register`.

## Deploying to a new server

1. Deploy code, copy `.env` with new `GUILD_ID` and production `DISCORD_REDIRECT_URI`
2. `rm -f dev.db && npx drizzle-kit push` — initialise schema
3. `npx tsx deploy-commands.ts` — register commands with the new guild
4. Admin runs `/register` for each member pointing at the new server's forum channels
5. Admin runs `/club-start` for the active book if one is in progress

Discord user IDs are global, so all reading history is portable across servers.

## Development

```bash
npm test                               # Run unit tests
npm run typecheck                      # Type-check without emitting
npx drizzle-kit studio                 # Browse the database in a web UI
npx tsx clear-global-commands.ts       # Wipe globally-registered commands (fixes duplicates)
```

## Tech stack

- [TypeScript](https://www.typescriptlang.org/) — full codebase; executed directly via [tsx](https://github.com/privatenumber/tsx) (no compile step)
- [discord.js](https://discord.js.org/) v14
- [Drizzle ORM](https://orm.drizzle.team/) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for synchronous SQLite access
- [cheerio](https://cheerio.js.org/) for Goodreads scraping
- [Jest](https://jestjs.io/) + [ts-jest](https://kulshekhar.github.io/ts-jest/) for unit tests
- [Express](https://expressjs.com/) v5 + EJS for the admin web panel
- [Helmet](https://helmetjs.github.io/) + CSRF middleware for web security
