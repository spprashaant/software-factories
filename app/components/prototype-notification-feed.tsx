// PROTOTYPE, never merge. "What does the Notification Feed look like in Cadence?"
// (https://github.com/spprashaant/software-factories/issues/22)
//
// Three variants of the Notification Feed, mounted in the real app layout and
// reading the DevUI user's real Knock feed (headless API, signed user token),
// switchable via `?variant=` and the floating bottom bar:
//   A  Bell + popover: bell in the sidebar header, badge = UNSEEN count,
//      opening marks all seen, clicking a row marks it read and navigates.
//   B  Sidebar item + drawer: "Notifications" nav item, badge = UNREAD count,
//      right-hand slide-over with Unread/All tabs, Today/Earlier groups,
//      excerpts, per-row read/unread toggle.
//   C  Inbox page: "Notifications" nav item with a dot only (no number), goes to
//      /notifications: category filters, list + detail pane, "Open" button.
//   D  Bell + drawer, "Load more": A's bell (badge = UNSEEN) opens B's drawer;
//      20 per page with a "Load more" button.
//   E  Same as D, but infinite scroll (next page loads as you near the bottom).
// Polls every 15s plus on window focus (no websocket yet). The poll refetches
// the first page only and keeps older pages already loaded.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useFetcher, useNavigate } from "react-router";
import {
  Bell,
  CheckCheck,
  GraduationCap,
  MessageSquare,
  Receipt,
  UserPlus,
  UsersRound,
  X,
  Inbox,
  Circle,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import { PrototypeSwitcher, usePrototypeVariant } from "~/components/prototype-switcher";

export const VARIANTS = [
  { key: "A", name: "Bell + popover" },
  { key: "B", name: "Sidebar item + drawer" },
  { key: "C", name: "Inbox page" },
  { key: "D", name: "Bell + drawer, load more" },
  { key: "E", name: "Bell + drawer, infinite scroll" },
];

type FeedConfig = { knockUserId: string; token: string; publicKey: string; channelId: string };

export type Entry = {
  id: string;
  inserted_at: string;
  seen_at: string | null;
  read_at: string | null;
  data: Record<string, unknown>;
  actors: Array<{ id?: string; name?: string }>;
};
type Meta = { unread_count: number; unseen_count: number; total_count: number };

// ---------- feed state (shared by sidebar + page) ----------

type Feed = {
  ready: boolean;
  error: string | null;
  entries: Entry[];
  meta: Meta;
  refresh: () => Promise<void>;
  mark: (status: "seen" | "read" | "unread", ids: string[]) => Promise<void>;
  /** Every message for this user, not just the loaded pages (Knock bulk op). */
  markAll: (status: "seen" | "read") => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
};

const PAGE = 20;

const FeedContext = createContext<Feed | null>(null);
export const useFeed = () => useContext(FeedContext);

export function NotificationFeedProvider({ config, children }: { config: FeedConfig | null; children: React.ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMeta] = useState<Meta>({ unread_count: 0, unseen_count: 0, total_count: 0 });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedOlder = useRef(false);

  const headers = useMemo(
    () =>
      config && {
        Authorization: `Bearer ${config.publicKey}`,
        "X-Knock-User-Token": config.token,
        "Content-Type": "application/json",
      },
    [config?.token]
  );

  const refresh = useCallback(async () => {
    if (!config || !headers) return;
    const r = await fetch(
      `https://api.knock.app/v1/users/${config.knockUserId}/feeds/${config.channelId}?page_size=${PAGE}`,
      { headers }
    );
    const body = await r.json();
    if (!r.ok) {
      setError(`${r.status} ${JSON.stringify(body)}`);
      return;
    }
    setError(null);
    const first: Entry[] = body.entries;
    if (loadedOlder.current) {
      // Keep the older pages already loaded; replace the first page.
      setEntries((es) => {
        const ids = new Set(first.map((e) => e.id));
        const lastFirst = first[first.length - 1];
        const older = es.filter((e) => !ids.has(e.id) && (!lastFirst || e.inserted_at < lastFirst.inserted_at));
        return [...first, ...older];
      });
    } else {
      setEntries(first);
      setAfter(body.page_info?.after ?? null);
    }
    setMeta(body.meta);
    setReady(true);
  }, [config?.knockUserId, headers]);

  const mark = useCallback(
    async (status: "seen" | "read" | "unread", ids: string[]) => {
      if (!headers || !ids.length) return;
      // optimistic
      const now = new Date().toISOString();
      setEntries((es) =>
        es.map((e) =>
          ids.includes(e.id)
            ? status === "seen"
              ? { ...e, seen_at: e.seen_at ?? now }
              : status === "read"
                ? { ...e, read_at: now, seen_at: e.seen_at ?? now }
                : { ...e, read_at: null }
            : e
        )
      );
      await fetch(`https://api.knock.app/v1/messages/batch/${status}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message_ids: ids }),
      });
      if (status === "read") {
        // Knock's read doesn't imply seen; keep them consistent.
        await fetch(`https://api.knock.app/v1/messages/batch/seen`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message_ids: ids }),
        });
      }
      await refresh();
    },
    [headers, refresh]
  );

  const loadMore = useCallback(async () => {
    if (!config || !headers || !after || loadingMore) return;
    setLoadingMore(true);
    const r = await fetch(
      `https://api.knock.app/v1/users/${config.knockUserId}/feeds/${config.channelId}?page_size=${PAGE}&after=${encodeURIComponent(after)}`,
      { headers }
    );
    const body = await r.json();
    if (r.ok) {
      loadedOlder.current = true;
      setEntries((es) => {
        const ids = new Set(es.map((e) => e.id));
        return [...es, ...(body.entries as Entry[]).filter((e) => !ids.has(e.id))];
      });
      setAfter(body.page_info?.after ?? null);
    }
    setLoadingMore(false);
  }, [config?.knockUserId, headers, after, loadingMore]);

  const markAll = useCallback(
    async (status: "seen" | "read") => {
      if (!config || !headers) return;
      const now = new Date().toISOString();
      setEntries((es) => es.map((e) => (status === "seen" ? { ...e, seen_at: e.seen_at ?? now } : { ...e, read_at: e.read_at ?? now, seen_at: e.seen_at ?? now })));
      setMeta((m) => (status === "seen" ? { ...m, unseen_count: 0 } : { ...m, unread_count: 0, unseen_count: 0 }));
      const statuses = status === "read" ? ["seen", "read"] : ["seen"];
      for (const st of statuses) {
        await fetch(`https://api.knock.app/v1/channels/${config.channelId}/messages/bulk/${st}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ user_ids: [config.knockUserId], engagement_status: st === "seen" ? "unseen" : "unread" }),
        });
      }
      // Bulk ops are async in Knock; give it a moment before re-reading counts.
      setTimeout(refresh, 2000);
    },
    [config?.knockUserId, headers, refresh]
  );

  useEffect(() => {
    setEntries([]);
    setReady(false);
    loadedOlder.current = false;
    refresh();
    const t = setInterval(refresh, 15_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const value = { ready, error, entries, meta, refresh, mark, markAll, hasMore: !!after, loadingMore, loadMore };
  return <FeedContext.Provider value={config ? value : null}>{children}</FeedContext.Provider>;
}

// ---------- how a Notification reads ----------

type Described = {
  icon: React.ReactNode;
  category: "Refunds" | "Discussions" | "Team" | "Enrollments";
  title: React.ReactNode;
  plainTitle: string;
  body?: string;
  quote?: string;
  context?: string;
  chip?: string;
  url: string;
};

export function describe(e: Entry): Described {
  const d = e.data as Record<string, string | undefined>;
  const actor = e.actors[0]?.name ?? "Someone";
  const course = d.course_title ?? "a course";
  const b = (s: string) => <b className="font-semibold">{s}</b>;
  const url = d.url ?? "/";
  switch (d.kind) {
    case "refund-opened":
      return { icon: <Receipt className="size-4" />, category: "Refunds", title: <>{b(actor)} asked for a refund on {b(course)}</>, plainTitle: `${actor} asked for a refund on ${course}`, chip: d.resolved, url };
    case "refund-received":
      return { icon: <Receipt className="size-4" />, category: "Refunds", title: <>We've got your refund request for {b(course)}</>, plainTitle: `We've got your refund request for ${course}`, body: "A Platform Admin will review it. You'll get a Notification when it's decided.", url };
    case "refund-approved":
      return { icon: <Receipt className="size-4" />, category: "Refunds", title: <>Your refund for {b(course)} was approved</>, plainTitle: `Your refund for ${course} was approved`, body: d.note, url };
    case "refund-declined":
      return { icon: <Receipt className="size-4" />, category: "Refunds", title: <>Your refund for {b(course)} was declined</>, plainTitle: `Your refund for ${course} was declined`, body: d.note, url };
    case "seat-claimed":
      return { icon: <UsersRound className="size-4" />, category: "Team", title: <>{b(actor)} claimed a Seat on {b(course)}</>, plainTitle: `${actor} claimed a Seat on ${course}`, url };
    case "enrollment":
      return { icon: <UserPlus className="size-4" />, category: "Enrollments", title: <>{b(actor)} enrolled on {b(course)}</>, plainTitle: `${actor} enrolled on ${course}`, url };
    case "question-asked":
      return { icon: <MessageSquare className="size-4" />, category: "Discussions", title: <>{b(actor)} asked on {b(d.lesson_title ?? "a lesson")}</>, plainTitle: `${actor} asked on ${d.lesson_title}`, quote: d.excerpt, context: course, url };
    case "reply-posted":
      return { icon: <MessageSquare className="size-4" />, category: "Discussions", title: <>{b(actor)} replied on {b(d.lesson_title ?? "a lesson")}</>, plainTitle: `${actor} replied on ${d.lesson_title}`, quote: d.excerpt, context: course, url };
    default:
      return { icon: <Bell className="size-4" />, category: "Team", title: <>{String(d.message ?? "Notification")}</>, plainTitle: String(d.message ?? "Notification"), url };
  }
}

const sentAt = (e: Entry) => new Date(String(e.data.sent_at ?? e.inserted_at));

function ago(e: Entry) {
  const mins = Math.round((Date.now() - sentAt(e).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 60 / 24)}d`;
}

function Avatar({ e, className }: { e: Entry; className?: string }) {
  const name = e.actors[0]?.name;
  if (!name)
    return (
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary", className)}>
        <GraduationCap className="size-4" />
      </div>
    );
  return <UserAvatar name={name} avatarUrl={null} className={cn("shrink-0", className)} />;
}

function NoKnock() {
  return <div className="p-4 text-sm text-muted-foreground">Knock isn't configured (no KNOCK_API_KEY), or no user is selected.</div>;
}

// ---------- the dev seed bar ----------

function SeedControls() {
  const f = useFetcher<{ sent?: number; archived?: number }>();
  const feed = useFeed();
  useEffect(() => {
    if (f.state === "idle" && f.data) feed?.refresh();
  }, [f.state, f.data]);
  return (
    <f.Form method="post" action="/prototype/notifications/seed" className="ml-2 flex items-center gap-1 border-l border-white/30 pl-2">
      <button name="intent" value="send" className="rounded-full px-2 py-0.5 text-xs hover:bg-white/20" disabled={f.state !== "idle"}>
        {f.state !== "idle" ? "sending…" : "Send me samples"}
      </button>
      <button name="intent" value="send100" className="rounded-full px-2 py-0.5 text-xs hover:bg-white/20" disabled={f.state !== "idle"}>
        Send 100
      </button>
      <button name="intent" value="clear" className="rounded-full px-2 py-0.5 text-xs hover:bg-white/20" disabled={f.state !== "idle"}>
        Clear feed
      </button>
      {feed && (
        <span className="text-xs text-white/60">
          unread {feed.meta.unread_count} · unseen {feed.meta.unseen_count}
        </span>
      )}
    </f.Form>
  );
}

export function NotificationFeedSwitcher() {
  const v = usePrototypeVariant(VARIANTS.map((x) => x.key));
  return <PrototypeSwitcher variants={VARIANTS} current={v} extra={<SeedControls />} />;
}

// ---------- slots the sidebar renders ----------

/** Rendered in the sidebar header, next to "Cadence". */
export function SidebarHeaderSlot() {
  const v = usePrototypeVariant(VARIANTS.map((x) => x.key));
  if (v === "A") return <BellPopover />;
  if (v === "D") return <BellDrawer paging="load-more" />;
  if (v === "E") return <BellDrawer paging="infinite" />;
  return null;
}

/** Rendered as the first nav item. */
export function SidebarNavSlot() {
  const v = usePrototypeVariant(VARIANTS.map((x) => x.key));
  if (v === "B") return <DrawerNavItem />;
  if (v === "C") return <InboxNavItem />;
  return null;
}

// ---------- Variant A: bell + popover ----------

function BellPopover() {
  const feed = useFeed();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Opening the popover = you've seen everything in it.
    if (next && feed && feed.meta.unseen_count > 0) feed.markAll("seen");
  }

  const unseen = feed?.meta.unseen_count ?? 0;

  return (
    <div className="relative ml-auto">
      <button onClick={toggle} className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent" aria-label="Notifications">
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-full top-0 z-50 ml-3 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">Notifications</span>
              {feed && feed.meta.unread_count > 0 && (
                <button
                  onClick={() => feed.mark("read", feed.entries.filter((e) => !e.read_at).map((e) => e.id))}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all as read
                </button>
              )}
            </div>
            {!feed ? (
              <NoKnock />
            ) : feed.entries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">You're all caught up.</div>
            ) : (
              <ul className="max-h-[28rem] overflow-y-auto">
                {feed.entries.map((e) => {
                  const d = describe(e);
                  return (
                    <li key={e.id}>
                      <button
                        onClick={() => {
                          feed.mark("read", [e.id]);
                          setOpen(false);
                          navigate(d.url);
                        }}
                        className={cn("flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent", !e.read_at && "bg-primary/5")}
                      >
                        <Avatar e={e} className="size-7" />
                        <span className={cn("flex-1 line-clamp-2", e.read_at && "text-muted-foreground")}>{d.title}</span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-xs text-muted-foreground">{ago(e)}</span>
                          {!e.read_at && <span className="size-2 rounded-full bg-primary" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Variant B: sidebar item + drawer ----------

function DrawerNavItem() {
  const feed = useFeed();
  const [open, setOpen] = useState(false);
  const unread = feed?.meta.unread_count ?? 0;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          open ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Bell className="size-4" />
        Notifications
        {unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{unread}</span>}
      </button>
      {open && <Drawer onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------- Variants D/E: A's bell opening B's drawer ----------

function BellDrawer({ paging }: { paging: "load-more" | "infinite" }) {
  const feed = useFeed();
  const [open, setOpen] = useState(false);
  const unseen = feed?.meta.unseen_count ?? 0;
  return (
    <div className="ml-auto">
      <button onClick={() => setOpen(true)} className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent" aria-label="Notifications">
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>
      {open && <Drawer onClose={() => setOpen(false)} paging={paging} />}
    </div>
  );
}

function Pager({ paging }: { paging: "load-more" | "infinite" }) {
  const feed = useFeed();
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paging !== "infinite" || !sentinel.current) return;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) feed?.loadMore();
    }, { rootMargin: "200px" });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [paging, feed?.loadMore]);
  if (!feed) return null;
  const shown = `${feed.entries.length} of ${feed.meta.total_count}`;
  if (!feed.hasMore)
    return <div className="py-4 text-center text-xs text-muted-foreground">That's everything ({shown}).</div>;
  if (paging === "infinite")
    return (
      <div ref={sentinel} className="py-4 text-center text-xs text-muted-foreground">
        {feed.loadingMore ? "Loading…" : `Showing ${shown}`}
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-1 py-4">
      <button onClick={feed.loadMore} disabled={feed.loadingMore} className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent">
        {feed.loadingMore ? "Loading…" : "Load more"}
      </button>
      <span className="text-xs text-muted-foreground">Showing {shown}</span>
    </div>
  );
}

function Drawer({ onClose, paging }: { onClose: () => void; paging?: "load-more" | "infinite" }) {
  const feed = useFeed();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"unread" | "all">("unread");

  useEffect(() => {
    if (feed && feed.meta.unseen_count > 0) feed.markAll("seen");
  }, []);

  const list = (feed?.entries ?? []).filter((e) => tab === "all" || !e.read_at);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(startOfToday.getTime() - 6 * 24 * 3600_000);
  const groups = (
    paging
      ? [
          { label: "Today", items: list.filter((e) => sentAt(e) >= startOfToday) },
          { label: "This week", items: list.filter((e) => sentAt(e) < startOfToday && sentAt(e) >= weekAgo) },
          { label: "Older", items: list.filter((e) => sentAt(e) < weekAgo) },
        ]
      : [
          { label: "Today", items: list.filter((e) => sentAt(e) >= startOfToday) },
          { label: "Earlier", items: list.filter((e) => sentAt(e) < startOfToday) },
        ]
  ).filter((g) => g.items.length);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[28rem] flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-accent" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-b px-5 py-2 text-sm">
          {(["unread", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1 capitalize", tab === t ? "bg-accent font-medium" : "text-muted-foreground")}>
              {t}
              {t === "unread" && feed ? ` (${feed.meta.unread_count})` : ""}
            </button>
          ))}
          {feed && feed.meta.unread_count > 0 && (
            <button
              onClick={() => feed.markAll("read")}
              className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-72">
          {!feed ? (
            <NoKnock />
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
              <Inbox className="size-8" />
              {tab === "unread" ? "No unread Notifications." : "Nothing here yet."}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label}>
                <div className="sticky top-0 bg-background/95 px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                {g.items.map((e) => {
                  const d = describe(e);
                  return (
                    <div key={e.id} className={cn("group relative flex gap-3 border-b px-5 py-3", !e.read_at && "bg-primary/5")}>
                      {!e.read_at && <span className="absolute left-1.5 top-5 size-2 rounded-full bg-primary" />}
                      <Avatar e={e} />
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => {
                            feed.mark("read", [e.id]);
                            onClose();
                            navigate(d.url);
                          }}
                          className="text-left text-sm hover:underline"
                        >
                          {d.title}
                        </button>
                        {d.quote && <blockquote className="mt-1 line-clamp-2 border-l-2 pl-2 text-sm text-muted-foreground">{d.quote}</blockquote>}
                        {d.body && <p className="mt-1 text-sm text-muted-foreground">{d.body}</p>}
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {d.icon}
                          {d.context && <span>{d.context} ·</span>}
                          <span>{ago(e)}</span>
                          {d.chip && <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-100">{d.chip}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => feed.mark(e.read_at ? "unread" : "read", [e.id])}
                        title={e.read_at ? "Mark as unread" : "Mark as read"}
                        className="self-start rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
                      >
                        {e.read_at ? <Circle className="size-4" /> : <CheckCheck className="size-4" />}
                      </button>
                    </div>
                  );
                })}
              </section>
            ))
          )}
          {feed && paging && groups.length > 0 && <Pager paging={paging} />}
        </div>
      </aside>
    </>
  );
}

// ---------- Variant C: inbox page ----------

function InboxNavItem() {
  const feed = useFeed();
  const hasUnread = (feed?.meta.unread_count ?? 0) > 0;
  return (
    <NavLink
      to="/notifications?variant=C"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Inbox className="size-4" />
      Notifications
      {hasUnread && <span className="ml-auto size-2 rounded-full bg-primary" />}
    </NavLink>
  );
}

export function InboxPage() {
  const feed = useFeed();
  const [filter, setFilter] = useState<string>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Visiting the inbox = you've seen everything.
  useEffect(() => {
    if (feed?.ready) feed.mark("seen", feed.entries.filter((e) => !e.seen_at).map((e) => e.id));
  }, [feed?.ready]);

  if (!feed) return <NoKnock />;

  const cats = ["All", ...Array.from(new Set(feed.entries.map((e) => describe(e).category)))];
  const list = feed.entries.filter((e) => filter === "All" || describe(e).category === filter);
  const selected = feed.entries.find((e) => e.id === selectedId) ?? null;
  const sd = selected && describe(selected);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <div className="flex gap-1">
          {cats.map((c) => (
            <button key={c} onClick={() => setFilter(c)} className={cn("rounded-full border px-3 py-1 text-sm", filter === c ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {c}
            </button>
          ))}
        </div>
        {feed.meta.unread_count > 0 && (
          <button onClick={() => feed.mark("read", feed.entries.filter((e) => !e.read_at).map((e) => e.id))} className="ml-auto text-sm text-primary hover:underline">
            Mark all as read
          </button>
        )}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul className="overflow-y-auto border-r">
          {list.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">Nothing here.</li>}
          {list.map((e) => {
            const d = describe(e);
            return (
              <li key={e.id}>
                <button
                  onClick={() => {
                    setSelectedId(e.id);
                    if (!e.read_at) feed.mark("read", [e.id]);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 border-b px-4 py-3 text-left",
                    selectedId === e.id ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", e.read_at ? "bg-transparent" : "bg-primary")} />
                  <span className="mt-0.5 text-muted-foreground">{d.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", !e.read_at ? "font-medium" : "text-muted-foreground")}>{d.plainTitle}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.category} · {ago(e)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="overflow-y-auto p-8">
          {!selected || !sd ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Inbox className="size-10" />
              Select a Notification
            </div>
          ) : (
            <article className="max-w-xl space-y-4">
              <div className="flex items-center gap-3">
                <Avatar e={selected} className="size-10" />
                <div>
                  <div className="font-medium">{selected.actors[0]?.name ?? "Cadence"}</div>
                  <div className="text-xs text-muted-foreground">{sentAt(selected).toLocaleString()}</div>
                </div>
                <button onClick={() => feed.mark("unread", [selected.id])} className="ml-auto text-xs text-muted-foreground hover:underline">
                  Mark as unread
                </button>
              </div>
              <h2 className="text-lg">{sd.title}</h2>
              {sd.context && <div className="text-sm text-muted-foreground">{sd.context}</div>}
              {sd.quote && <blockquote className="rounded-md border-l-4 bg-muted/50 p-3 text-sm">{sd.quote}</blockquote>}
              {sd.body && <p className="text-sm">{sd.body}</p>}
              {sd.chip && <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-sm text-green-800">{sd.chip}</span>}
              <Link to={sd.url} className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Open
              </Link>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
