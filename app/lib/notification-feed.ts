import type { LucideIcon } from "lucide-react";
import { z } from "zod";
import {
  NOTIFICATION_KINDS,
  notificationKindSchema,
  type DescribedNotification,
} from "~/lib/notification-kinds";

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
  // The workflow key, which is the Notification kind.
  source: z.object({ key: notificationKindSchema }),
  data: z.record(z.unknown()).nullable(),
  actors: z.array(
    z.object({ id: z.string().optional(), name: z.string().nullish() })
  ),
});

const feedSchema = z.object({
  // An entry this Cadence can't read, such as a kind it doesn't know yet, is
  // left out rather than failing the whole page.
  entries: z.array(z.unknown()).transform((entries) =>
    entries.flatMap((entry) => {
      const item = feedItemSchema.safeParse(entry);
      return item.success ? [item.data] : [];
    })
  ),
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

/**
 * The row's title and where clicking it goes, worked out from the kind and
 * the Notification's data (app/lib/notification-kinds.ts).
 */
export function describeFeedItem(item: FeedItem): DescribedNotification {
  return NOTIFICATION_KINDS[item.source.key].describe({
    data: item.data ?? {},
    actorName: item.actors[0]?.name || "Someone",
  });
}

export function feedItemIcon(item: FeedItem): LucideIcon {
  return NOTIFICATION_KINDS[item.source.key].icon;
}

// ─── Excerpts and decision notes ───
// Knock never holds text a person wrote. The drawer asks Cadence for the
// Discussion excerpts and decision notes on a loaded page, in one request,
// at render time (app/lib/feed-details.server.ts).

const commentDetailSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("text"), text: z.string() }),
  z.object({ status: z.literal("removed") }),
  z.object({ status: z.literal("unavailable") }),
]);

/** Only the user who raised the Refund Request ever gets its note. */
const decisionNoteDetailSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("note"), text: z.string() }),
  z.object({ status: z.literal("unavailable") }),
]);

const feedDetailsSchema = z.object({
  comments: z.record(commentDetailSchema),
  decisionNotes: z.record(decisionNoteDetailSchema),
});

export type CommentDetail = z.infer<typeof commentDetailSchema>;
export type DecisionNoteDetail = z.infer<typeof decisionNoteDetailSchema>;
/** Keyed by comment id and Refund Request id. */
export type FeedDetails = z.infer<typeof feedDetailsSchema>;

export type FeedDetailIds = {
  commentIds: number[];
  refundRequestIds: number[];
};

export const FEED_DETAILS_URL = "/api/notification-details";
const FEED_DETAILS_TIMEOUT_MS = 5_000;

function idFrom(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** The comment or Refund Request a row's detail line is about, if any. */
function detailRef(
  item: FeedItem
): { source: "comment" | "decision-note"; id: number } | null {
  const source = NOTIFICATION_KINDS[item.source.key].detail;
  if (source === null) return null;
  const id = idFrom(
    source === "comment" ? item.data?.commentId : item.data?.refundRequestId
  );
  return id ? { source, id } : null;
}

function detailIds(items: FeedItem[]): FeedDetailIds {
  const commentIds = new Set<number>();
  const refundRequestIds = new Set<number>();
  for (const item of items) {
    const ref = detailRef(item);
    if (ref?.source === "comment") commentIds.add(ref.id);
    if (ref?.source === "decision-note") refundRequestIds.add(ref.id);
  }
  return {
    commentIds: [...commentIds],
    refundRequestIds: [...refundRequestIds],
  };
}

export function emptyFeedDetails(): FeedDetails {
  return { comments: {}, decisionNotes: {} };
}

/**
 * The excerpts and decision notes for one loaded page, in a single request.
 * Fail-open: an error, a timeout or a bad answer gives no details, never throws.
 */
export async function fetchFeedDetails(
  items: FeedItem[]
): Promise<FeedDetails> {
  const ids = detailIds(items);
  if (ids.commentIds.length === 0 && ids.refundRequestIds.length === 0) {
    return emptyFeedDetails();
  }
  try {
    const response = await fetch(FEED_DETAILS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
      signal: AbortSignal.timeout(FEED_DETAILS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Feed details request failed: ${response.status}`);
    }
    return feedDetailsSchema.parse(await response.json());
  } catch (error) {
    console.error(error);
    return emptyFeedDetails();
  }
}

export type RowDetail =
  | { kind: "quote"; text: string }
  | { kind: "removed" }
  | { kind: "note"; text: string };

/** The excerpt or decision note line under a row, or null for none. */
export function feedRowDetail(
  item: FeedItem,
  details: FeedDetails
): RowDetail | null {
  const ref = detailRef(item);
  if (ref?.source === "comment") {
    const comment = details.comments[ref.id];
    if (comment?.status === "text")
      return { kind: "quote", text: comment.text };
    if (comment?.status === "removed") return { kind: "removed" };
    return null;
  }
  if (ref?.source === "decision-note") {
    const note = details.decisionNotes[ref.id];
    return note?.status === "note" ? { kind: "note", text: note.text } : null;
  }
  return null;
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
