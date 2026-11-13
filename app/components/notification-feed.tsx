import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  CheckCheck,
  Circle,
  GraduationCap,
  Inbox,
  X,
} from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  badgeLabel,
  describeFeedItem,
  emptyFeedDetails,
  feedItemIcon,
  feedRowDetail,
  fetchFeed,
  fetchFeedDetails,
  groupFeedItems,
  markAllRead,
  markAllSeen,
  markRead,
  markUnread,
  mergeFirstPage,
  type FeedConfig,
  type FeedDetails,
  type FeedItem,
  type FeedMeta,
  type FeedTab,
} from "~/lib/notification-feed";

// ─── Notification Feed ───
// The bell in the sidebar header and the right-hand drawer it opens. Our own
// UI over Knock's headless feed API, not Knock's React components. Rebuilt
// from prototype D on `prototype/notification-feed`.

const POLL_MS = 15_000;
// Knock's bulk seen/read run async; re-read the counts after a moment.
const BULK_SETTLE_MS = 2_000;

const EMPTY_META: FeedMeta = {
  unseen_count: 0,
  unread_count: 0,
  total_count: 0,
};

/**
 * The signed-in user's feed for one tab. Polls the first page and the counts
 * every 15 seconds and on window focus, keeping older pages already loaded.
 */
function useFeed(config: FeedConfig) {
  const [tab, setTab] = useState<FeedTab>("unread");
  const [entries, setEntries] = useState<FeedItem[]>([]);
  const [meta, setMeta] = useState<FeedMeta>(EMPTY_META);
  const [after, setAfter] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Excerpts and decision notes, read from Cadence once per loaded page.
  const [details, setDetails] = useState<FeedDetails>(emptyFeedDetails);
  // Older pages loaded on this tab, so a refresh merges instead of replacing.
  const loadedOlder = useRef(false);
  // Bumped on every tab switch, so a slow response for the old tab is dropped.
  const generation = useRef(0);

  // Fail-open: rows without details still render their title and link.
  const loadDetails = useCallback(async (items: FeedItem[]) => {
    const page = await fetchFeedDetails(items);
    setDetails((known) => ({
      comments: { ...known.comments, ...page.comments },
      decisionNotes: { ...known.decisionNotes, ...page.decisionNotes },
    }));
  }, []);

  const refresh = useCallback(async () => {
    const asked = generation.current;
    try {
      const page = await fetchFeed(config, { status: tab });
      if (asked !== generation.current) return;
      setMeta(page.meta);
      loadDetails(page.entries);
      if (loadedOlder.current) {
        setEntries((loaded) => mergeFirstPage(loaded, page.entries));
      } else {
        setEntries(page.entries);
        setAfter(page.after);
      }
    } catch (error) {
      // The feed is a side panel: a failed read leaves the bell as it was.
      console.error(error);
    }
  }, [config, tab, loadDetails]);

  const loadMore = useCallback(async () => {
    if (!after || loadingMore) return;
    const asked = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(config, { status: tab, after });
      if (asked !== generation.current) return;
      loadedOlder.current = true;
      loadDetails(page.entries);
      setEntries((loaded) => {
        const ids = new Set(loaded.map((item) => item.id));
        return [...loaded, ...page.entries.filter((item) => !ids.has(item.id))];
      });
      setAfter(page.after);
      setMeta(page.meta);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMore(false);
    }
  }, [config, tab, after, loadingMore, loadDetails]);

  // A new tab starts from its first page.
  useEffect(() => {
    generation.current += 1;
    loadedOlder.current = false;
    setEntries([]);
    setAfter(null);
  }, [tab]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const settle = useCallback(() => {
    window.setTimeout(refresh, BULK_SETTLE_MS);
  }, [refresh]);

  const markAllAsSeen = useCallback(async () => {
    const now = new Date().toISOString();
    setMeta((m) => ({ ...m, unseen_count: 0 }));
    setEntries((loaded) =>
      loaded.map((item) => ({ ...item, seen_at: item.seen_at ?? now }))
    );
    await markAllSeen(config);
    settle();
  }, [config, settle]);

  const markAllAsRead = useCallback(async () => {
    const now = new Date().toISOString();
    setMeta((m) => ({ ...m, unseen_count: 0, unread_count: 0 }));
    setEntries((loaded) =>
      loaded.map((item) => ({
        ...item,
        seen_at: item.seen_at ?? now,
        read_at: item.read_at ?? now,
      }))
    );
    await markAllRead(config);
    settle();
  }, [config, settle]);

  const setRead = useCallback(
    async (item: FeedItem, read: boolean) => {
      const now = new Date().toISOString();
      setEntries((loaded) =>
        loaded.map((each) =>
          each.id === item.id
            ? {
                ...each,
                seen_at: each.seen_at ?? now,
                read_at: read ? (each.read_at ?? now) : null,
              }
            : each
        )
      );
      setMeta((m) => ({
        ...m,
        unread_count: Math.max(0, m.unread_count + (read ? -1 : 1)),
      }));
      if (read) {
        await markRead(config, [item.id]);
      } else {
        await markUnread(config, [item.id]);
      }
      await refresh();
    },
    [config, refresh]
  );

  return {
    tab,
    setTab,
    entries,
    details,
    meta,
    hasMore: after !== null,
    loadingMore,
    loadMore,
    markAllAsSeen,
    markAllAsRead,
    setRead,
  };
}

type Feed = ReturnType<typeof useFeed>;

export function NotificationBell({ config }: { config: FeedConfig }) {
  const feed = useFeed(config);
  const [open, setOpen] = useState(false);
  const unseen = feed.meta.unseen_count;
  const badge = badgeLabel(unseen);

  function openDrawer() {
    setOpen(true);
    // Opening the drawer = the user has seen every Notification, not just
    // the loaded page.
    if (unseen > 0) feed.markAllAsSeen();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        aria-label={badge ? `Notifications, ${badge} unseen` : "Notifications"}
      >
        <Bell className="size-5" />
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer feed={feed} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function NotificationDrawer({
  feed,
  onClose,
}: {
  feed: Feed;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const now = new Date();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const groups = groupFeedItems(feed.entries, now);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 animate-in fade-in-0"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Notifications"
        className="fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-full flex-col border-l bg-background text-foreground shadow-2xl animate-in slide-in-from-right duration-200"
      >
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 hover:bg-accent"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-b px-5 py-2 text-sm">
          {(["unread", "all"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => feed.setTab(tab)}
              aria-pressed={feed.tab === tab}
              className={cn(
                "rounded-md px-3 py-1",
                feed.tab === tab
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {tab === "unread" ? `Unread (${feed.meta.unread_count})` : "All"}
            </button>
          ))}
          {feed.meta.unread_count > 0 && (
            <button
              type="button"
              onClick={feed.markAllAsRead}
              className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          )}
        </div>
        <div
          className={cn(
            "flex-1 overflow-y-auto",
            // Clear the DevUI panel floating bottom-right in development.
            import.meta.env.DEV ? "pb-72" : "pb-6"
          )}
        >
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
              <Inbox className="size-8" />
              {feed.tab === "unread"
                ? "No unread Notifications."
                : "Nothing here yet."}
            </div>
          ) : (
            <>
              {groups.map((group) => (
                <section key={group.label}>
                  {/* Solid and its own row height, so it never covers a row. */}
                  <h3 className="sticky top-0 z-10 flex h-8 items-center border-b bg-background px-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </h3>
                  <ul>
                    {group.items.map((item) => (
                      <FeedRow
                        key={item.id}
                        item={item}
                        details={feed.details}
                        now={now}
                        onOpen={(url) => {
                          onClose();
                          navigate(url);
                          if (!item.read_at) feed.setRead(item, true);
                        }}
                        onToggleRead={() => feed.setRead(item, !item.read_at)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              <Pager feed={feed} />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function FeedRow({
  item,
  details,
  now,
  onOpen,
  onToggleRead,
}: {
  item: FeedItem;
  details: FeedDetails;
  now: Date;
  onOpen: (url: string) => void;
  onToggleRead: () => void;
}) {
  const described = describeFeedItem(item);
  const KindIcon = feedItemIcon(item);
  const unread = !item.read_at;
  const detail = feedRowDetail(item, details);

  return (
    <li
      className={cn(
        "group relative flex gap-3 border-b px-5 py-3",
        unread && "bg-primary/5"
      )}
    >
      {unread && (
        <span className="absolute left-1.5 top-5 size-2 rounded-full bg-primary" />
      )}
      <ActorAvatar item={item} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(described.url)}
          className="text-left text-sm hover:underline"
        >
          {described.title.map((part, index) =>
            part.bold ? (
              <b key={index} className="font-semibold">
                {part.text}
              </b>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </button>
        {detail?.kind === "quote" && (
          <blockquote className="mt-1 line-clamp-2 border-l-2 pl-2 text-sm text-muted-foreground">
            {detail.text}
          </blockquote>
        )}
        {detail?.kind === "removed" && (
          <p className="mt-1 border-l-2 pl-2 text-sm italic text-muted-foreground">
            This comment was removed
          </p>
        )}
        {detail?.kind === "note" && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {detail.text}
          </p>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <KindIcon className="size-3.5" aria-hidden />
          {described.meta && <span>{described.meta} ·</span>}
          <span>{formatRelativeTime(item.inserted_at, now)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleRead}
        title={unread ? "Mark as read" : "Mark as unread"}
        aria-label={unread ? "Mark as read" : "Mark as unread"}
        className="self-start rounded p-1 text-muted-foreground opacity-0 hover:bg-accent focus:opacity-100 group-hover:opacity-100"
      >
        {unread ? (
          <CheckCheck className="size-4" />
        ) : (
          <Circle className="size-4" />
        )}
      </button>
    </li>
  );
}

function Pager({ feed }: { feed: Feed }) {
  const shown = `Showing ${feed.entries.length} of ${feed.meta.total_count}`;
  if (!feed.hasMore) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">{shown}</p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1 py-4">
      <button
        type="button"
        onClick={feed.loadMore}
        disabled={feed.loadingMore}
        className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
      >
        {feed.loadingMore ? "Loading…" : "Load more"}
      </button>
      <span className="text-xs text-muted-foreground">{shown}</span>
    </div>
  );
}

function ActorAvatar({ item }: { item: FeedItem }) {
  const name = item.actors[0]?.name;
  if (!name) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <GraduationCap className="size-4" />
      </span>
    );
  }
  return <UserAvatar name={name} avatarUrl={null} className="shrink-0" />;
}
