const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../db');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure nominations for a given month')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(option =>
      option
        .setName('month')
        .setDescription('Month to configure (1–12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    )
    .addIntegerOption(option =>
      option
        .setName('year')
        .setDescription('Year (e.g. 2025)')
        .setRequired(true)
        .setMinValue(2020)
    )
    .addUserOption(option =>
      option
        .setName('nominator')
        .setDescription('Restrict nominations to a single user (omit to allow everyone)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const month = interaction.options.getInteger('month');
    const year = interaction.options.getInteger('year');
    const nominatorUser = interaction.options.getUser('nominator');

    const period = await db.nominationPeriod.upsert({
      where: { month_year: { month, year } },
      update: {
        openToAll: !nominatorUser,
        nominatorId: nominatorUser?.id ?? null,
        nominatorName: nominatorUser ? (nominatorUser.displayName ?? nominatorUser.username) : null,
      },
      create: {
        month,
        year,
        openToAll: !nominatorUser,
        nominatorId: nominatorUser?.id ?? null,
        nominatorName: nominatorUser ? (nominatorUser.displayName ?? nominatorUser.username) : null,
      },
    });

    const monthName = MONTHS[month - 1];

    const summary = period.openToAll
      ? `Nominations for **${monthName} ${year}** are open to everyone.`
      : `Nominations for **${monthName} ${year}** are restricted to <@${period.nominatorId}>.`;

    await interaction.reply({ content: summary, flags: MessageFlags.Ephemeral });
  },
};
