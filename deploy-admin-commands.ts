import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const ADMIN_COMMANDS = ['register', 'unregister'];

const commands = ADMIN_COMMANDS.map(name => require(`./commands/${name}`).data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    console.log(`Registering admin commands: ${ADMIN_COMMANDS.join(', ')}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
      { body: commands }
    );
    console.log('Admin commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
