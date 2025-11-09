import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandSubcommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { debugLog } from '../../lib/debug.js';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8080';
const STEAM_RETURN_URL = process.env.STEAM_RETURN_URL ?? `${API_BASE_URL.replace(/\/$/, '')}/auth/steam/callback`;

export const linkSubcommand = new SlashCommandSubcommandBuilder()
  .setName('link')
  .setDescription('Link your Steam account to participate in roulette sessions.');

export async function handleLink(interaction: ChatInputCommandInteraction) {
  const linkUrl = new URL(STEAM_RETURN_URL);
  linkUrl.searchParams.set('state', interaction.user.id);
  debugLog('Generated Steam link URL', linkUrl.toString());

  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Link Steam').setURL(linkUrl.toString());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await interaction.reply({
    content:
      'Steam linking opens a browser window powered by Steam OpenID. Once you confirm, the library cache will refresh automatically.',
    components: [row],
    ephemeral: true,
  });
}
