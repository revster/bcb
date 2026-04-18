import 'dotenv/config';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_COMMANDS = new Set(['register', 'unregister', 'club-start', 'reminders', 'checkup', 'club-stats']);

const commands = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter((file: string) => file.endsWith('.ts') || file.endsWith('.js'))
  .map((file: string) => {
    const name = file.replace(/\.(ts|js)$/, '');
    const json = require(`./commands/${name}`).data.toJSON();
    if (ADMIN_COMMANDS.has(name)) {
      json.default_member_permissions = PermissionFlagsBits.Administrator.toString();
    }
    return json;
  });

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
