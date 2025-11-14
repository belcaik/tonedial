import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandSubcommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getSteamLinkStatus } from '../../lib/api-client.js';
import { debugLog } from '../../lib/debug.js';

const PUBLIC_API_BASE_URL =
  process.env.API_PUBLIC_BASE_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.PUBLIC_API_URL ??
  process.env.API_ORIGIN ??
  process.env.PUBLIC_ORIGIN ??
  'http://localhost:8080';

const STEAM_RETURN_URL =
  process.env.STEAM_RETURN_URL ?? `${PUBLIC_API_BASE_URL.replace(/\/$/, '')}/auth/steam/callback`;

const derivedRealm = (() => {
  try {
    return new URL(STEAM_RETURN_URL).origin;
  } catch {
    return PUBLIC_API_BASE_URL;
  }
})();

const STEAM_REALM = process.env.STEAM_REALM ?? process.env.API_ORIGIN ?? derivedRealm;

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
  await interaction.deferReply({ ephemeral: true });
  const steamLoginUrl = buildSteamLoginUrl(interaction.user.id);
  debugLog('Generated Steam OpenID login URL', steamLoginUrl.toString());

  let statusText =
    'You are not linked yet. Use the button below to open the Steam login window, authorize ToneDial, and keep your Steam "Game details" privacy to public.';

  try {
    const status = await getSteamLinkStatus(interaction.user.id);
    if (status.linked) {
      const parts = [
        `✅ Linked to Steam ID **${status.steamId64}**${status.visibilityOk ? '' : ' (library hidden)'}.`,
      ];
      if (typeof status.totalGames === 'number') {
        const refreshedAt = status.cacheRefreshedAt
          ? ` · refreshed ${new Date(status.cacheRefreshedAt).toLocaleString()}`
          : '';
        parts.push(`Cached library: **${status.totalGames}** games${refreshedAt}.`);
      }
      if (!status.visibilityOk) {
        parts.push('⚠️ Steam privacy currently hides your game details. Set them to public and relink.');
      }
      parts.push('Use the button again if you need to refresh permissions.');
      statusText = parts.join('\n');
    }
  } catch (error) {
    debugLog('Failed to fetch Steam link status', error);
  }

  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Sign in with Steam').setURL(steamLoginUrl.toString());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await interaction.editReply({
    content: `${statusText}\n\nSteam linking opens a browser window powered by Steam OpenID.`,
    components: [row],
  });
}
