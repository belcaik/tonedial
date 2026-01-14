import { DiscordSDK, type IDiscordSDK } from '@discord/embedded-app-sdk';

export type DiscordContext = {
  guild?: { id: string } | undefined;
  channel?: { id: string } | undefined;
  user?: { id: string; username?: string | undefined; discriminator?: string | undefined; avatar?: string | null | undefined } | undefined;
};

export type DiscordClient = IDiscordSDK;

let discordInstance: DiscordSDK | null = null;

/**
 * Initialize the Discord Embedded App SDK.
 * CRITICAL: This follows the proper initialization flow:
 * 1. Create SDK instance
 * 2. await ready() - MUST be called before any other SDK calls
 * 3. Optionally authorize() → authenticate() for user access
 */
export async function initDiscord(): Promise<{ sdk: DiscordSDK; ctx: DiscordContext }> {
  if (typeof window === 'undefined') {
    throw new Error('Discord SDK is only available in the browser.');
  }

  if (discordInstance) {
    const ctx = buildContextFromSdk(discordInstance);
    return { sdk: discordInstance, ctx };
  }

  const params = new URLSearchParams(window.location.search);
  const clientId = params.get('cid') ?? import.meta.env.VITE_DISCORD_CLIENT_ID;

  if (!clientId) {
    throw new Error('Missing VITE_DISCORD_CLIENT_ID environment variable or cid query parameter.');
  }

  // Create the SDK instance
  discordInstance = new DiscordSDK(clientId);

  // CRITICAL: await ready() before any other SDK calls
  await discordInstance.ready();

  // Build context from SDK instance properties
  const ctx = buildContextFromSdk(discordInstance);

  return { sdk: discordInstance, ctx };
}

/**
 * Authorize with Discord OAuth to get user identity.
 * Call this after initDiscord() if you need authenticated user info.
 *
 * Flow: authorize() → exchange code for token → authenticate()
 */
export async function authorizeDiscord(
  exchangeCodeForToken: (code: string) => Promise<string>,
): Promise<DiscordContext> {
  if (!discordInstance) {
    throw new Error('Discord SDK not initialized. Call initDiscord() first.');
  }

  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) {
    throw new Error('Missing VITE_DISCORD_CLIENT_ID for authorization.');
  }

  // Step 1: Authorize to get OAuth code
  const { code } = await discordInstance.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds'],
  });

  // Step 2: Exchange code for access token via backend
  const accessToken = await exchangeCodeForToken(code);

  // Step 3: Authenticate with the access token
  const authResponse = await discordInstance.commands.authenticate({
    access_token: accessToken,
  });

  // Return enriched context with user info
  return {
    guild: discordInstance.guildId ? { id: discordInstance.guildId } : undefined,
    channel: discordInstance.channelId ? { id: discordInstance.channelId } : undefined,
    user: authResponse.user
      ? {
          id: authResponse.user.id,
          username: authResponse.user.username,
          discriminator: authResponse.user.discriminator,
          avatar: authResponse.user.avatar,
        }
      : undefined,
  };
}

/**
 * Build a DiscordContext from SDK instance properties.
 * The SDK populates guildId and channelId after ready() completes.
 */
function buildContextFromSdk(sdk: DiscordSDK): DiscordContext {
  return {
    guild: sdk.guildId ? { id: sdk.guildId } : undefined,
    channel: sdk.channelId ? { id: sdk.channelId } : undefined,
    // User info is only available after authorize() + authenticate()
    user: undefined,
  };
}

/**
 * Get the current Discord SDK instance if initialized.
 */
export function getDiscordSdk(): DiscordSDK | null {
  return discordInstance;
}
