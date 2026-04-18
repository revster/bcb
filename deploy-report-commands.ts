/**
 * deploy-report-commands.ts — Register /stats and /leaderboard as admin-only commands.
 *
 * Sets default_member_permissions to Administrator so only admins can use them
 * by default. Server admins can override this in Discord's server settings.
 *
 * Run with: npx tsx deploy-report-commands.ts
 */

import 'dotenv/config';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';

const REPORT_COMMANDS = ['stats', 'leaderboard'];

const commands = REPORT_COMMANDS.map(name => {
  const json = require(`./commands/${name}`).data.toJSON();
  json.default_member_permissions = PermissionFlagsBits.Administrator.toString();
  return json;
});

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    console.log(`Registering report commands as admin-only: ${REPORT_COMMANDS.join(', ')}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
      { body: commands }
    );
    console.log('Report commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
