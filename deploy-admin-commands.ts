/**
 * deploy-admin-commands.ts — Register all bot commands, with report commands
 * restricted to admins only.
 *
 * Admin-only (visible to all but restricted by default_member_permissions):
 *   /stats, /leaderboard
 *
 * Unrestricted admin commands:
 *   /register, /unregister, /checkup, /test
 *
 * Run with: npx tsx deploy-admin-commands.ts
 */

import 'dotenv/config';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';

const ADMIN_COMMANDS    = ['register', 'unregister', 'checkup', 'test'];
const REPORT_COMMANDS   = ['stats', 'leaderboard', 'club-stats'];

const adminCommands = ADMIN_COMMANDS.map(name =>
  require(`./commands/${name}`).data.toJSON()
);

const reportCommands = REPORT_COMMANDS.map(name => {
  const json = require(`./commands/${name}`).data.toJSON();
  json.default_member_permissions = PermissionFlagsBits.Administrator.toString();
  return json;
});

const allCommands = [...adminCommands, ...reportCommands];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    console.log(`Registering commands: ${[...ADMIN_COMMANDS, ...REPORT_COMMANDS].join(', ')}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
      { body: allCommands }
    );
    console.log('Commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
