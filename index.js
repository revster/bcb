require('dotenv').config();
const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const db = require('./db');
const { sendReminders } = require('./lib/reminders');

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

client.commands = new Collection();

fs.readdirSync(path.join(__dirname, 'commands'))
  .filter(file => file.endsWith('.js'))
  .forEach(file => {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
  });

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Daily at 9:00 AM UTC — ping readers who haven't logged progress in 7 days
  cron.schedule('0 9 * * *', () => {
    sendReminders(client).catch(err => console.error('[reminders] Cron error:', err));
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
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
    const reply = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.TOKEN);
