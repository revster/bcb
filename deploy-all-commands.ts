/**
 * deploy-all-commands.ts — Register all bot commands for public use.
 *
 * Admin-only (restricted by default_member_permissions):
 *   /register, /unregister, /club-start, /reminders, /checkup
 *
 * Available to all members:
 *   /read, /progress, /rate, /abandon, /stats, /leaderboard,
 *   /finishers, /abandoners, /abandoned, /ping, /test
 *
 * Run with: npx tsx deploy-all-commands.ts
 */

import 'dotenv/config';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';

const ADMIN_COMMANDS  = ['register', 'unregister', 'club-start', 'reminders', 'checkup'];
const MEMBER_COMMANDS = ['read', 'progress', 'rate', 'abandon', 'stats', 'leaderboard', 'finishers', 'abandoners', 'abandoned', 'ping', 'test'];

const adminCommands = ADMIN_COMMANDS.map(name => {
  const json = require(`./commands/${name}`).data.toJSON();
  json.default_member_permissions = PermissionFlagsBits.Administrator.toString();
  return json;
});

const memberCommands = MEMBER_COMMANDS.map(name =>
  require(`./commands/${name}`).data.toJSON()
);

const allCommands = [...adminCommands, ...memberCommands];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    console.log(`Registering ${allCommands.length} commands...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
      { body: allCommands }
    );
    console.log('All commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
