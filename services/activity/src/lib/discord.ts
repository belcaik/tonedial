const DISCORD_SDK_URL = 'https://cdn.discordapp.com/embedded-app-sdk/embedded-app-sdk.min.js';

export type DiscordContext = {
  guild?: { id: string };
  channel?: { id: string };
  user?: { id: string };
};

export type DiscordClient = {
  ready: () => Promise<void>;
  commands: {
    getContext: () => Promise<DiscordContext>;
    authorize?: (options: { client_id: string; scope: string[] }) => Promise<void>;
  };
};

let discordInstance: DiscordClient | null = null;

export async function initDiscord() {
  if (typeof window === 'undefined') {
    throw new Error('Discord SDK is only available in the browser.');
  }

  if (discordInstance) {
    const ctx = await discordInstance.commands.getContext();
    return { sdk: discordInstance, ctx };
  }

  await ensureSdkLoaded();
  const DiscordSDKConstructor = (window as typeof window & { DiscordSDK?: new (id: string) => DiscordClient }).DiscordSDK;
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;

  if (!DiscordSDKConstructor || !clientId) {
    throw new Error('Discord Embedded App SDK unavailable or missing VITE_DISCORD_CLIENT_ID.');
  }

  discordInstance = new DiscordSDKConstructor(clientId);
  await discordInstance.ready();
  const ctx = await discordInstance.commands.getContext();
  return { sdk: discordInstance, ctx };
}

async function ensureSdkLoaded() {
  if ((window as typeof window & { DiscordSDK?: unknown }).DiscordSDK) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = DISCORD_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Discord Embedded App SDK'));
    document.head.appendChild(script);
  });
}

declare global {
  interface Window {
    DiscordSDK?: new (clientId: string) => DiscordClient;
  }
}
