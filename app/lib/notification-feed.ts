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
  // `categories` are the workflow's categories (knock/workflows.ts).
  source: z.object({
    key: z.string(),
    categories: z.array(z.string()).optional(),
  }),
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
  page_info: z.object({ after: z.string().nullable() }).optional(),
});

export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedMeta = z.infer<typeof feedSchema>["meta"];

/** One page of the feed, and the cursor for the next (null on the last). */
export type FeedPage = {
  entries: FeedItem[];
  meta: FeedMeta;
  after: string | null;
};

export type FeedTab = "unread" | "all";

function headers(config: FeedConfig) {
  return {
    Authorization: `Bearer ${config.publicApiKey}`,
    "X-Knock-User-Token": config.userToken,
    "Content-Type": "application/json",
  };
}

/**
 * One page of the feed, never `archived=include`. The Unread tab asks Knock
 * for `status=unread`, so unread Notifications past the first page still show.
 */
export async function fetchFeed(
  config: FeedConfig,
  options: { status?: FeedTab; after?: string | null } = {}
): Promise<FeedPage> {
  const params = new URLSearchParams({ page_size: String(FEED_PAGE_SIZE) });
  if (options.status === "unread") params.set("status", "unread");
  if (options.after) params.set("after", options.after);
  const response = await fetch(
    `${KNOCK_API}/users/${encodeURIComponent(config.knockUserId)}/feeds/${config.feedChannelId}?${params}`,
    { headers: headers(config) }
  );
  if (!response.ok) {
    throw new Error(`Knock feed request failed: ${response.status}`);
  }
  const feed = feedSchema.parse(await response.json());
  return {
    entries: feed.entries,
    meta: feed.meta,
    after: feed.page_info?.after ?? null,
  };
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

export async function markUnread(config: FeedConfig, messageIds: string[]) {
  await fetch(`${KNOCK_API}/messages/batch/unread`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

// Knock's bulk operations cover every one of the user's messages in the
// channel, not just the loaded pages. They run async on Knock's side.
async function bulkMark(config: FeedConfig, status: "seen" | "read") {
  await fetch(
    `${KNOCK_API}/channels/${config.feedChannelId}/messages/bulk/${status}`,
    {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        user_ids: [config.knockUserId],
        engagement_status: status === "seen" ? "unseen" : "unread",
      }),
    }
  );
}

/** Every one of the user's messages, not just the loaded page. */
export async function markAllSeen(config: FeedConfig) {
  await bulkMark(config, "seen");
}

/** Every one of the user's messages; read doesn't imply seen, so both. */
export async function markAllRead(config: FeedConfig) {
  await bulkMark(config, "seen");
  await bulkMark(config, "read");
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
    default:
      return null;
  }
}

export type FeedGroup = {
  label: "Today" | "This week" | "Older";
  items: FeedItem[];
};

/** Today, this week (the six days before today) and older. Empty groups go. */
export function groupFeedItems(items: FeedItem[], now: Date): FeedGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const groups: FeedGroup[] = [
    { label: "Today", items: [] },
    { label: "This week", items: [] },
    { label: "Older", items: [] },
  ];
  for (const item of items) {
    const at = new Date(item.inserted_at);
    const group =
      at >= startOfToday
        ? groups[0]
        : at >= startOfWeek
          ? groups[1]
          : groups[2];
    group.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/** The bell's badge: the unseen count, capped at "99+". Null when none. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/**
 * A refresh reloads only the first page. Swap it in and keep the older pages
 * already loaded: anything older than the first page's last row.
 */
export function mergeFirstPage(
  loaded: FeedItem[],
  firstPage: FeedItem[]
): FeedItem[] {
  const last = firstPage[firstPage.length - 1];
  if (!last) return [];
  const onFirstPage = new Set(firstPage.map((item) => item.id));
  const cutoff = new Date(last.inserted_at).getTime();
  const older = loaded.filter(
    (item) =>
      !onFirstPage.has(item.id) && new Date(item.inserted_at).getTime() < cutoff
  );
  return [...firstPage, ...older];
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
