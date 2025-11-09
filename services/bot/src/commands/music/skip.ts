import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getMusic } from '../../music.js';

export const command = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the currently playing track.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
      return;
    }

    const music = getMusic();

    try {
      const skipped = await music.skip(interaction.guildId);
      const nowPlaying = music.getNowPlaying(interaction.guildId);
      const skippedDescription = skipped.info.uri ? `[${skipped.info.title}](${skipped.info.uri})` : skipped.info.title;

      if (nowPlaying) {
        const currentDescription = nowPlaying.info.uri ? `[${nowPlaying.info.title}](${nowPlaying.info.uri})` : nowPlaying.info.title;
        await interaction.reply(`Skipped **${skippedDescription}**. Now playing **${currentDescription}**.`);
      } else {
        await interaction.reply(`Skipped **${skippedDescription}**. The queue is now empty.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to skip the current track.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
