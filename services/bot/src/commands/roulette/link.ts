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
const STEAM_REALM = process.env.STEAM_REALM ?? process.env.API_ORIGIN ?? API_BASE_URL;

function buildSteamLoginUrl(discordUserId: string) {
  const returnTo = new URL(STEAM_RETURN_URL);
  returnTo.searchParams.set('state', discordUserId);

  const steamUrl = new URL('https://steamcommunity.com/openid/login');
  steamUrl.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
  steamUrl.searchParams.set('openid.mode', 'checkid_setup');
  steamUrl.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select');
  steamUrl.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select');
  steamUrl.searchParams.set('openid.return_to', returnTo.toString());
  steamUrl.searchParams.set('openid.realm', STEAM_REALM);
  return steamUrl;
}

export const linkSubcommand = new SlashCommandSubcommandBuilder()
  .setName('link')
  .setDescription('Link your Steam account to participate in roulette sessions.');

export async function handleLink(interaction: ChatInputCommandInteraction) {
  const steamLoginUrl = buildSteamLoginUrl(interaction.user.id);
  debugLog('Generated Steam OpenID login URL', steamLoginUrl.toString());

  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Sign in with Steam').setURL(steamLoginUrl.toString());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await interaction.reply({
    content:
      'Steam linking opens a browser window powered by Steam OpenID. Once you confirm, the library cache will refresh automatically.',
    components: [row],
    ephemeral: true,
  });
}
