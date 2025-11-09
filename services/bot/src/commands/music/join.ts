import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getMusic } from '../../music.js';

export const command = {
  data: new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
      return;
    }

    const music = getMusic();

    try {
      const channel = await music.ensureVoice(interaction);
      await music.join(channel, interaction.guildId);
      await interaction.reply(`Joined **${channel.name}**.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join your voice channel.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
