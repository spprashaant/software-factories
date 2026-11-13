import { z } from "zod";

// ─── The Notification Feed, browser side ───
// The browser reads the signed-in user's feed straight from Knock's headless
// feed API, with the public key and a user token the app layout signs. Nothing
// here is secret: Knock's enhanced security limits the token to its own user.

/** What the browser needs to read one user's Notification Feed from Knock. */
export type FeedConfig = {
  knockUserId: string;
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
};

export const FEED_PAGE_SIZE = 20;

const KNOCK_API = "https://api.knock.app/v1";

// Knock's response is untrusted input: parse only what the drawer uses.
const feedItemSchema = z.object({
  id: z.string(),
  inserted_at: z.string(),
  seen_at: z.string().nullable(),
  read_at: z.string().nullable(),
  source: z.object({ key: z.string() }),
  data: z.record(z.unknown()).nullable(),
  actors: z.array(
    z.object({ id: z.string().optional(), name: z.string().nullish() })
  ),
});

const feedSchema = z.object({
  entries: z.array(feedItemSchema),
  meta: z.object({
    unseen_count: z.number(),
    unread_count: z.number(),
    total_count: z.number(),
  }),
});

export type FeedItem = z.infer<typeof feedItemSchema>;
export type Feed = z.infer<typeof feedSchema>;

function headers(config: FeedConfig) {
  return {
    Authorization: `Bearer ${config.publicApiKey}`,
    "X-Knock-User-Token": config.userToken,
    "Content-Type": "application/json",
  };
}

/** The first page of the feed. The default request, never `archived=include`. */
export async function fetchFeed(config: FeedConfig): Promise<Feed> {
  const response = await fetch(
    `${KNOCK_API}/users/${encodeURIComponent(config.knockUserId)}/feeds/${config.feedChannelId}?page_size=${FEED_PAGE_SIZE}`,
    { headers: headers(config) }
  );
  if (!response.ok) {
    throw new Error(`Knock feed request failed: ${response.status}`);
  }
  return feedSchema.parse(await response.json());
}

export async function markRead(config: FeedConfig, messageIds: string[]) {
  // Knock's read doesn't imply seen, so mark both.
  for (const status of ["seen", "read"] as const) {
    await fetch(`${KNOCK_API}/messages/batch/${status}`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ message_ids: messageIds }),
    });
  }
}

/** Every one of the user's messages, not just the loaded page. */
export async function markAllSeen(config: FeedConfig) {
  await fetch(
    `${KNOCK_API}/channels/${config.feedChannelId}/messages/bulk/seen`,
    {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        user_ids: [config.knockUserId],
        engagement_status: "unseen",
      }),
    }
  );
}

// ─── How a Notification reads ───

export type TitlePart = { text: string; bold: boolean };

export type DescribedNotification = {
  title: TitlePart[];
  url: string;
};

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Where a Purchase is managed: /team for a Team Licence, else /settings. */
function purchaseUrl(purchaseKind: unknown) {
  return purchaseKind === "team_licence" ? "/team" : "/settings";
}

/**
 * The row's title and where clicking it goes, worked out from the workflow
 * key and the Notification's data. Null for a kind this Cadence doesn't know.
 */
export function describeFeedItem(item: FeedItem): DescribedNotification | null {
  const data = item.data ?? {};
  const actor = text(item.actors[0]?.name, "Someone");
  const course = text(data.courseTitle, "a course");

  switch (item.source.key) {
    case "refund-opened":
      return {
        title: [
          { text: actor, bold: true },
          { text: " asked for a refund on ", bold: false },
          { text: course, bold: true },
        ],
        url: "/admin/refunds",
      };
    case "seat-claimed":
      return {
        title: [
          { text: actor, bold: true },
          { text: " claimed a Seat on ", bold: false },
          { text: course, bold: true },
        ],
        url: "/team",
      };
    case "enrollment": {
      const courseId = data.courseId;
      return {
        title: [
          { text: actor, bold: true },
          { text: " enrolled on ", bold: false },
          { text: course, bold: true },
        ],
        url:
          typeof courseId === "number" || typeof courseId === "string"
            ? `/instructor/${courseId}/students`
            : "/instructor",
      };
    }
    case "refund-received":
      return {
        title: [
          { text: "We've got your refund request for ", bold: false },
          { text: course, bold: true },
        ],
        url: purchaseUrl(data.purchaseKind),
      };
    case "refund-approved":
    case "refund-declined":
      return {
        title: [
          { text: "Your refund for ", bold: false },
          { text: course, bold: true },
          {
            text:
              item.source.key === "refund-approved"
                ? " was approved"
                : " was declined",
            bold: false,
          },
        ],
        url: purchaseUrl(data.purchaseKind),
      };
    default:
      return null;
  }
}

export function relativeTime(iso: string, now: Date) {
  const minutes = Math.round(
    (now.getTime() - new Date(iso).getTime()) / 60_000
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 60 / 24)}d ago`;
}
