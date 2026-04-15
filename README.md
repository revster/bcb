# BCB — Book Club Bot

[![CI](https://github.com/revster/bcb/actions/workflows/ci.yml/badge.svg)](https://github.com/revster/bcb/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20+-brightgreen)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2)](https://discord.js.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/revster/bcb/blob/main/LICENSE)

A Discord bot for managing a book club server. Members can track their personal reading and participate in monthly club reads, all from inside Discord.

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

## Commands

### Admin
| Command | Description |
|---|---|
| `/register <user> <channel>` | Map a member to their personal forum channel |
| `/unregister <user>` | Remove a member from club tracking (threads/logs kept) |
| `/club-start <url> [month] [year]` | Start a club read — creates threads for all members, opens epilogue thread, initialises `#progress` |

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
| `/stats [user]` | Personal reading summary — all reads + club read breakdown |
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
TOKEN=your_bot_token
CLIENT_ID=your_application_client_id
GUILD_ID=your_discord_server_id
DATABASE_URL=file:./dev.db
```

### Database

```bash
npx prisma db push --accept-data-loss
npx prisma generate
```

### Register slash commands

```bash
node deploy-commands.js
```

### Run the bot

```bash
node index.js
```

## Discord server setup

The bot looks up channels by name, not ID. Create these channels before running club commands:

| Channel | Purpose |
|---|---|
| `#progress` | Live club read progress board (managed by bot) |
| `#epilogue` | Spoiler discussion — one thread per club book |
| `#bot-log` | Admin event log — restrict to admins + bot role |

Each registered member also needs a **Forum channel** that the bot will create threads in. Pass that channel to `/register`.

## Deploying to a new server

1. Deploy code, copy `.env` with new `GUILD_ID`
2. `npx prisma db push --accept-data-loss` — initialise schema
3. `node deploy-commands.js` — register commands with the new guild
4. Admin runs `/register` for each member pointing at the new server's forum channels
5. Admin runs `/club-start` for the active book if one is in progress

Discord user IDs are global, so all reading history is portable across servers.

## Development

```bash
npm test                               # Run unit tests
npx prisma studio                      # Browse the database
node clear-global-commands.js          # Wipe globally-registered commands (fixes duplicates)
```

## Tech stack

- [discord.js](https://discord.js.org/) v14
- [Prisma](https://www.prisma.io/) 5 + SQLite
- [cheerio](https://cheerio.js.org/) for Goodreads scraping
- [Jest](https://jestjs.io/) for unit tests
