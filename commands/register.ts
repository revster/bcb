/**
 * commands/register.js — /register <user> <channel>
 *
 * Admin-only command that maps a Discord member to their personal reading forum
 * channel. Must be run before that member can use /read to start a book.
 *
 * Re-running /register for the same user overwrites the channel mapping,
 * so admins can correct mistakes.
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../db');
const { botLog } = require('../lib/botLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription("Register a member's personal reading forum channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o =>
      o.setName('user').setDescription('The member to register').setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('channel').setDescription('Their personal forum channel').setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const channel = interaction.options.getChannel('channel');

    if (channel.type !== ChannelType.GuildForum) {
      await interaction.reply({
        content: `<#${channel.id}> is not a forum channel. Please select a forum channel.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.memberChannel.upsert({
      where: { userId: user.id },
      update: { channelId: channel.id, username: user.displayName ?? user.username },
      create: { userId: user.id, username: user.displayName ?? user.username, channelId: channel.id },
    });

    await interaction.reply({
      content: `Registered <@${user.id}>'s reading channel as <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
    await botLog(interaction.guild, `[register] ${user.username} → #${channel.name}`);
  },
};
