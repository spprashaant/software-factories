import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, GraduationCap, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  describeFeedItem,
  fetchFeed,
  markAllSeen,
  markRead,
  relativeTime,
  type Feed,
  type FeedConfig,
  type FeedItem,
} from "~/lib/notification-feed";

// ─── Notification Feed ───
// The bell in the sidebar header and the right-hand drawer it opens. Our own
// UI over Knock's headless feed API, not Knock's React components. Rebuilt
// from prototype D on `prototype/notification-feed`.

function useFeed(config: FeedConfig) {
  const [feed, setFeed] = useState<Feed | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFeed(await fetchFeed(config));
    } catch (error) {
      // The feed is a side panel: a failed read leaves the bell as it was.
      console.error(error);
    }
  }, [config]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { feed, refresh };
}

export function NotificationBell({ config }: { config: FeedConfig }) {
  const { feed, refresh } = useFeed(config);
  const [open, setOpen] = useState(false);
  const unseen = feed?.meta.unseen_count ?? 0;

  async function openDrawer() {
    setOpen(true);
    if (unseen > 0) {
      await markAllSeen(config);
    }
    await refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        aria-label={
          unseen > 0 ? `Notifications, ${unseen} unseen` : "Notifications"
        }
      >
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer
          config={config}
          items={feed?.entries ?? []}
          onClose={() => setOpen(false)}
          onChange={refresh}
        />
      )}
    </>
  );
}

function NotificationDrawer({
  config,
  items,
  onClose,
  onChange,
}: {
  config: FeedConfig;
  items: FeedItem[];
  onClose: () => void;
  onChange: () => Promise<void>;
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

  const rows = items.flatMap((item) => {
    const described = describeFeedItem(item);
    return described ? [{ item, ...described }] : [];
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-label="Notifications"
        className="fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-full flex-col border-l bg-background text-foreground shadow-2xl"
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
        <div className="flex-1 overflow-y-auto pb-24">
          {rows.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              Nothing here yet.
            </p>
          ) : (
            <ul>
              {rows.map(({ item, title, meta, url }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={async () => {
                      onClose();
                      navigate(url);
                      if (!item.read_at) {
                        await markRead(config, [item.id]);
                        await onChange();
                      }
                    }}
                    className={cn(
                      "relative flex w-full gap-3 border-b px-5 py-3 text-left hover:bg-accent",
                      !item.read_at && "bg-primary/5"
                    )}
                  >
                    {!item.read_at && (
                      <span className="absolute left-1.5 top-5 size-2 rounded-full bg-primary" />
                    )}
                    <ActorAvatar item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        {title.map((part, index) =>
                          part.bold ? (
                            <b key={index} className="font-semibold">
                              {part.text}
                            </b>
                          ) : (
                            <span key={index}>{part.text}</span>
                          )
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {meta && `${meta} · `}
                        {relativeTime(item.inserted_at, now)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
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
