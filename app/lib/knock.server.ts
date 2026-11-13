import { signUserToken } from "@knocklabs/node";
import type { FeedConfig } from "~/lib/notification-feed";

// ─── Knock configuration ───
// Knock keys come from the environment. React Router's dev server doesn't load
// .env into process.env, so it is loaded here once, when present.
// docs/knock-setup.md lists every key and where it comes from.

let loaded = false;

function loadEnvOnce() {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: use whatever the environment already has.
  }
}

export function knockEnv() {
  loadEnvOnce();
  return {
    /** Server secret. Without it, Notifications go to .outbox/notifications/. */
    apiKey: process.env.KNOCK_API_KEY || null,
    /** RS256 private key for user tokens. */
    signingKey: process.env.KNOCK_SIGNING_KEY || null,
    /** Sent to the browser. */
    publicApiKey: process.env.KNOCK_PUBLIC_API_KEY || null,
    /** Sent to the browser. */
    feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID || null,
  };
}

// ─── The Notification Feed ───

const USER_TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * A short-lived RS256 user token for the signed-in user (`sub` = user id).
 * Knock's enhanced security rejects it for any other user's feed. Null when
 * Knock isn't configured, which hides the bell.
 */
export async function feedConfigFor(
  userId: number
): Promise<FeedConfig | null> {
  const { apiKey, signingKey, publicApiKey, feedChannelId } = knockEnv();
  if (!apiKey || !signingKey || !publicApiKey || !feedChannelId) return null;

  const knockUserId = String(userId);
  try {
    const userToken = await signUserToken(knockUserId, {
      signingKey,
      expiresInSeconds: USER_TOKEN_LIFETIME_SECONDS,
    });
    return { knockUserId, userToken, publicApiKey, feedChannelId };
  } catch (error) {
    console.error("Could not sign a Knock user token:", error);
    return null;
  }
}
