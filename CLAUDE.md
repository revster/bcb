# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A Discord bot for managing a book club server. Core features (planned or in progress):

- **Monthly nominations** — members nominate books each month
- **Polls** — vote on nominated books to pick the monthly read
- **Current book tracking** — bot knows what the active book is
- **Reading progress** — members can update and share their progress through the current book

## Environment

Requires a `.env` file with:
- `TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application/client ID
- `GUILD_ID` — Discord server (guild) ID for registering guild-scoped commands

## Dev Commands

```bash
npm install            # Install dependencies
node index.js          # Start the bot
node deploy-commands.js  # Register slash commands with Discord (re-run after any command changes)
```

## Architecture

- `index.js` — Bot entry point. Creates the Discord client with the required Gateway intents, listens for the `interactionCreate` event, and dispatches to command handlers.
- `deploy-commands.js` — One-off script to register slash commands with Discord's API via REST. Commands are registered guild-scoped (to `GUILD_ID`).

### Adding a new slash command

1. Define the command with `SlashCommandBuilder` in `deploy-commands.js`.
2. Add a handler branch in the `interactionCreate` listener in `index.js`.
3. Run `node deploy-commands.js` to push the updated command list to Discord.
