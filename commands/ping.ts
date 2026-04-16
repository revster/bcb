const { SlashCommandBuilder } = require('discord.js');
const { botLog } = require('../lib/botLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive'),

  async execute(interaction) {
    await interaction.reply('Pong! 🏓');
    await botLog(interaction.guild, `[ping] ${interaction.user.username} checked bot health`);
  },
};
