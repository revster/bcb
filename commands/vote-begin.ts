import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import db = require('../db');
import { polls } from '../schema';
import { botLog } from '../lib/botLog';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const data = new SlashCommandBuilder()
  .setName('vote-begin')
  .setDescription('Open voting for a month')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption(o => o
    .setName('month')
    .setDescription('Month to open voting for (default: current month)')
    .setMinValue(1).setMaxValue(12))
  .addIntegerOption(o => o
    .setName('year')
    .setDescription('Year to open voting for (default: current year)')
    .setMinValue(2020).setMaxValue(2100));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const now = new Date();
  const month = interaction.options.getInteger('month') ?? now.getMonth() + 1;
  const year  = interaction.options.getInteger('year')  ?? now.getFullYear();

  const openPoll = db.select().from(polls).where(eq(polls.open, true)).get();
  if (openPoll) {
    const name = `${MONTH_NAMES[openPoll.month - 1]} ${openPoll.year}`;
    await interaction.reply({
      content: `A poll is already open (${name}). Run \`/vote-end\` first.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = db.select().from(polls)
    .where(and(eq(polls.month, month), eq(polls.year, year)))
    .get();
  if (existing) {
    await interaction.reply({
      content: `A poll already exists for ${MONTH_NAMES[month - 1]} ${year}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  db.insert(polls).values({ month, year, open: true }).run();

  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  await botLog(interaction.guild!, `Voting opened for ${label} by ${interaction.user.username}`);
  await interaction.reply({ content: `Voting is now open for **${label}**.`, flags: MessageFlags.Ephemeral });
}
