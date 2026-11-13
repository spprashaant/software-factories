import { afterEach, describe, expect, it, vi } from "vitest";
import {
  badgeLabel,
  fetchFeed,
  markAllRead,
  markAllSeen,
  markUnread,
  mergeFirstPage,
  groupFeedItems,
  type FeedConfig,
  type FeedItem,
} from "~/lib/notification-feed";

const config: FeedConfig = {
  knockUserId: "7",
  userToken: "user-token",
  publicApiKey: "pk_test",
  feedChannelId: "in-app-feed",
};

/** Stands in for Knock's HTTP API: records requests, answers with `body`. */
function stubKnock(body: unknown = {}) {
  const requests: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
  return requests;
}

function feedResponse(ids: string[], after: string | null) {
  return {
    entries: ids.map((id) => item(id, "2026-11-13T09:00:00Z")),
    meta: { unseen_count: 3, unread_count: 25, total_count: 40 },
    page_info: { after, before: null, page_size: 20 },
  };
}

function item(id: string, insertedAt: string): FeedItem {
  return {
    id,
    inserted_at: insertedAt,
    seen_at: null,
    read_at: null,
    source: { key: "refund-opened" },
    data: {},
    actors: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("groupFeedItems", () => {
  it("groups Notifications into Today, This week and Older, dropping empty groups", () => {
    // Friday 13 Nov 2026, mid-afternoon local time.
    const now = new Date(2026, 10, 13, 15, 0);
    const groups = groupFeedItems(
      [
        item("today", new Date(2026, 10, 13, 9, 0).toISOString()),
        item("yesterday", new Date(2026, 10, 12, 23, 0).toISOString()),
        item("six-days", new Date(2026, 10, 7, 8, 0).toISOString()),
        item("eight-days", new Date(2026, 10, 5, 8, 0).toISOString()),
      ],
      now
    );

    expect(
      groups.map((g) => ({ label: g.label, ids: g.items.map((i) => i.id) }))
    ).toEqual([
      { label: "Today", ids: ["today"] },
      { label: "This week", ids: ["yesterday", "six-days"] },
      { label: "Older", ids: ["eight-days"] },
    ]);

    expect(
      groupFeedItems([item("old", "2020-01-01T00:00:00Z")], now).map(
        (g) => g.label
      )
    ).toEqual(["Older"]);
  });
});

describe("fetchFeed", () => {
  it("asks Knock for the first page of every Notification", async () => {
    const requests = stubKnock(feedResponse(["a", "b"], "cursor-1"));

    const page = await fetchFeed(config);

    expect(requests.map((r) => r.url)).toEqual([
      "https://api.knock.app/v1/users/7/feeds/in-app-feed?page_size=20",
    ]);
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(page.meta.unread_count).toBe(25);
    expect(page.after).toBe("cursor-1");
  });

  it("asks Knock for unread Notifications only, after a cursor", async () => {
    const requests = stubKnock(feedResponse(["u21"], null));

    const page = await fetchFeed(config, {
      status: "unread",
      after: "cursor/1",
    });

    expect(requests.map((r) => r.url)).toEqual([
      "https://api.knock.app/v1/users/7/feeds/in-app-feed?page_size=20&status=unread&after=cursor%2F1",
    ]);
    expect(page.after).toBeNull();
  });
});

describe("marking Notifications", () => {
  const bulk = (status: string) =>
    `https://api.knock.app/v1/channels/in-app-feed/messages/bulk/${status}`;

  it("opening the drawer marks every one of the user's messages seen", async () => {
    const requests = stubKnock();

    await markAllSeen(config);

    expect(requests).toEqual([
      {
        url: bulk("seen"),
        method: "POST",
        body: { user_ids: ["7"], engagement_status: "unseen" },
      },
    ]);
  });

  it("Mark all as read marks every one of the user's messages seen and read, not just a page", async () => {
    const requests = stubKnock();

    await markAllRead(config);

    expect(requests).toEqual([
      {
        url: bulk("seen"),
        method: "POST",
        body: { user_ids: ["7"], engagement_status: "unseen" },
      },
      {
        url: bulk("read"),
        method: "POST",
        body: { user_ids: ["7"], engagement_status: "unread" },
      },
    ]);
  });

  it("a row can be marked unread again", async () => {
    const requests = stubKnock();

    await markUnread(config, ["m1"]);

    expect(requests).toEqual([
      {
        url: "https://api.knock.app/v1/messages/batch/unread",
        method: "POST",
        body: { message_ids: ["m1"] },
      },
    ]);
  });
});

describe("badgeLabel", () => {
  it("shows the count, capped at 99+", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
    expect(badgeLabel(2500)).toBe("99+");
  });
});

describe("mergeFirstPage", () => {
  it("replaces the first page and keeps the older pages already loaded", () => {
    const loaded = [
      item("x", "2026-11-13T10:30:00Z"),
      item("b", "2026-11-13T10:00:00Z"),
      item("c", "2026-11-13T09:00:00Z"),
      item("d", "2026-11-12T09:00:00Z"),
      item("e", "2026-11-11T09:00:00Z"),
    ];
    // "a" arrived, "b" was read elsewhere, and "x" is no longer in the feed.
    const firstPage = [
      item("a", "2026-11-13T11:00:00Z"),
      { ...item("b", "2026-11-13T10:00:00Z"), read_at: "2026-11-13T11:30:00Z" },
      item("c", "2026-11-13T09:00:00Z"),
    ];

    const merged = mergeFirstPage(loaded, firstPage);

    expect(merged.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(merged[1].read_at).toBe("2026-11-13T11:30:00Z");
  });
});
