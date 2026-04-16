import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import cron = require('node-cron');
import db = require('./db');
import { sendReminders } from './lib/reminders';

interface Command {
  data: { name: string; toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildScheduledEvents,
  ]
});

const commands = new Collection<string, Command>();

fs.readdirSync(path.join(__dirname, 'commands'))
  .filter((file: string) => file.endsWith('.ts') || file.endsWith('.js'))
  .forEach((file: string) => {
    const command: Command = require(`./commands/${file.replace(/\.(ts|js)$/, '')}`);
    commands.set(command.data.name, command);
  });

client.once('clientReady', () => {
  console.log(`Logged in as ${(client.user as { tag: string }).tag}`);

  // Daily at 9:00 AM UTC — ping readers who haven't logged progress in 7 days
  cron.schedule('0 9 * * *', () => {
    sendReminders(client).catch((err: unknown) => console.error('[reminders] Cron error:', err));
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  // Fire-and-forget: keep a userId → username record, updated on every interaction
  db.user.upsert({
    where: { userId: interaction.user.id },
    update: { username: interaction.user.username },
    create: { userId: interaction.user.id, username: interaction.user.username },
  }).catch(() => {});

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'Something went wrong.' });
    } else {
      await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(process.env.TOKEN);
