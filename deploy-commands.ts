import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';

const commands = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter((file: string) => file.endsWith('.ts') || file.endsWith('.js'))
  .map((file: string) => require(`./commands/${file.replace(/\.(ts|js)$/, '')}`).data.toJSON());

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
