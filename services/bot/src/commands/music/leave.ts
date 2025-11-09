import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getMusic } from '../../music.js';

export const command = {
  data: new SlashCommandBuilder().setName('leave').setDescription('Disconnect the bot from the voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
      return;
    }

    const music = getMusic();

    try {
      const disconnected = await music.destroyPlayer(interaction.guildId);
      if (disconnected) {
        await interaction.reply('Left the voice channel.');
      } else {
        await interaction.reply({ content: 'I am not connected to any voice channel.', ephemeral: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to leave the voice channel.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
