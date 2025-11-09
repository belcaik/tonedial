import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { handleLink, linkSubcommand } from './link.js';
import { handleReroll, rerollSubcommand } from './reroll.js';
import { handleSettings, settingsSubcommand } from './settings.js';
import { handleStart, startSubcommand } from './start.js';
import { handleStatus, statusSubcommand } from './status.js';

const subcommandMap: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>> = {
  link: handleLink,
  start: handleStart,
  status: handleStatus,
  reroll: handleReroll,
  settings: handleSettings,
};

export const command = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('ToneDial roulette commands')
    .addSubcommand(linkSubcommand)
    .addSubcommand(startSubcommand)
    .addSubcommand(statusSubcommand)
    .addSubcommand(rerollSubcommand)
    .addSubcommand(settingsSubcommand),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(false);
    if (!sub) {
      await interaction.reply({ content: 'Missing roulette subcommand.', ephemeral: true });
      return;
    }

    const handler = subcommandMap[sub];
    if (!handler) {
      await interaction.reply({ content: `Unsupported roulette subcommand: ${sub}`, ephemeral: true });
      return;
    }

    await handler(interaction);
  },
};
