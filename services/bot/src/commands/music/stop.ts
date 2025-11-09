import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getMusic } from '../../music.js';

export const command = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop the current track.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
      return;
    }

    const music = getMusic();

    try {
      await music.stop(interaction.guildId);
      await interaction.reply('Playback stopped.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop playback.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
