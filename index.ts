import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import cron = require('node-cron');
import db = require('./db');
import { users } from './schema';
import { sendReminders } from './lib/reminders';
import { botLog } from './lib/botLog';

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

// Deduplicate interactions — Discord can replay unacknowledged events on reconnect,
// causing the same interaction to fire twice. IDs are evicted after 60 s.
const seenInteractions = new Set<string>();
function isDuplicate(id: string): boolean {
  if (seenInteractions.has(id)) return true;
  seenInteractions.add(id);
  setTimeout(() => seenInteractions.delete(id), 60_000);
  return false;
}

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
    sendReminders(client).catch((err: unknown) => {
      const guild = client.guilds.cache.first();
      if (guild) botLog(guild, `[reminders] Cron error: ${(err as Error)?.message ?? String(err)}`);
    });
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (isDuplicate(interaction.id)) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  // Fire-and-forget: keep a userId → username record, updated on every interaction
  try {
    db.insert(users)
      .values({ userId: interaction.user.id, username: interaction.user.username })
      .onConflictDoUpdate({ target: users.userId, set: { username: interaction.user.username } })
      .run();
  } catch { /* non-critical */ }

  try {
    await command.execute(interaction);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (interaction.guild) botLog(interaction.guild, `[error] /${interaction.commandName} by ${interaction.user.username}: ${msg}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'Something went wrong.' });
    } else {
      await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(process.env.TOKEN);
