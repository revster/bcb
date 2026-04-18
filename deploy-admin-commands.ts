/**
 * deploy-admin-commands.ts — Register a subset of commands, all admin-only.
 * Use this before public launch.
 *
 * Registered (all restricted to admins via default_member_permissions):
 *   /register, /unregister, /checkup, /test, /stats, /leaderboard, /club-stats
 *
 * Run with: npx tsx deploy-admin-commands.ts
 */

import 'dotenv/config';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';

const ALL_COMMANDS = ['register', 'unregister', 'checkup', 'test', 'stats', 'leaderboard', 'club-stats'];

const allCommands = ALL_COMMANDS.map(name => {
  const json = require(`./commands/${name}`).data.toJSON();
  json.default_member_permissions = PermissionFlagsBits.Administrator.toString();
  return json;
});

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    console.log(`Registering commands: ${ALL_COMMANDS.join(', ')}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
      { body: allCommands }
    );
    console.log('Commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
