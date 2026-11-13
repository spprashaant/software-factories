// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?"
// (https://github.com/spprashaant/software-factories/issues/23). Never merge.
//
// Proves, against the real Knock Development environment:
//   1. A server-signed RS256 user token for whichever user the DevUI selects.
//   2. A route action triggering a Notification via @knocklabs/node.
//   3. The headless feed API (called from the browser with that token) returning
//      it, with unread/unseen counts that move when it's marked seen/read.
//   4. Category preferences: muting the category suppresses the Notification.
//
//   5. Catalogue check: `new-enrollment` (category `enrollment`) is opt-in. Sync
//      writes enrollment:false into the user's prefs (merged, and only if the
//      user has no enrollment setting yet), so Instructors get nothing until
//      they opt in.
//
// Needs Knock workflows `prototype-spike` (category `prototype-spike`) and
// `new-enrollment` (category `enrollment`), each with one in-app feed step,
// committed in Development. `scripts/knock-enrollment-workflow.sh` walks it.
import { useCallback, useEffect, useState } from "react";
import { data, useFetcher } from "react-router";
import Knock, { signUserToken } from "@knocklabs/node";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, users, UserRole } from "~/db/schema";
import { Button } from "~/components/ui/button";

const WORKFLOW = "prototype-spike";
const CATEGORY = "prototype-spike";
const ENROLL_WORKFLOW = "new-enrollment";
const ENROLL_CATEGORY = "enrollment";

// PROTOTYPE: load .env ourselves so the spike doesn't depend on how dev is started.
try {
  process.loadEnvFile?.();
} catch {}

const knock = () => new Knock(); // reads KNOCK_API_KEY

async function currentUser(request: Request) {
  const id = await getCurrentUserId(request);
  if (!id) throw data("Select a user from the DevUI panel.", { status: 401 });
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw data("User not found.", { status: 404 });
  return user;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await currentUser(request);
  const knockUserId = String(user.id);
  const sync = await syncUser(user);
  const prefs = await knock().users.getPreferences(knockUserId, "default");
  const token = await signUserToken(knockUserId, { expiresInSeconds: 60 * 60 });
  const others = db.select({ id: users.id, name: users.name, role: users.role }).from(users).all();
  const courseList = db
    .select({ id: courses.id, title: courses.title, instructorId: courses.instructorId, instructorName: users.name })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.instructorId))
    .all();
  return {
    user: { id: user.id, name: user.name, role: user.role },
    knockUserId,
    token,
    publicKey: process.env.KNOCK_PUBLIC_API_KEY!,
    channelId: process.env.KNOCK_FEED_CHANNEL_ID!,
    prefs,
    others,
    courseList,
    sync,
  };
}

// PROTOTYPE stand-in for real user sync. Identify the user, then default the
// opt-in `enrollment` category to off, but only when it's unset, so a later
// sync never overwrites an opt-in. `merge` keeps every other category.
async function syncUser(user: { id: number; name: string; email: string }) {
  const k = knock();
  const id = String(user.id);
  await k.users.update(id, { name: user.name, email: user.email });
  const existing = await k.users.getPreferences(id, "default");
  const cats = (existing.categories ?? {}) as Record<string, unknown>;
  if (ENROLL_CATEGORY in cats) return { wroteDefault: false, before: cats };
  await k.users.setPreferences(id, "default", {
    __persistence_strategy__: "merge",
    categories: { [ENROLL_CATEGORY]: false },
  });
  return { wroteDefault: true, before: cats };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await currentUser(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const k = knock();
  if (intent === "trigger") {
    const recipientId = String(form.get("recipientId"));
    const recipient = db.select().from(users).where(eq(users.id, Number(recipientId))).get();
    const res = await k.workflows.trigger(WORKFLOW, {
      recipients: [{ id: recipientId, name: recipient?.name, email: recipient?.email }],
      actor: { id: String(user.id), name: user.name, email: user.email },
      data: { message: String(form.get("message") || "Hello from the spike"), sent_at: new Date().toISOString() },
    });
    return { intent, result: res };
  }
  if (intent === "mute" || intent === "unmute") {
    const result = await k.users.setPreferences(String(user.id), "default", {
      __persistence_strategy__: "merge",
      categories: { [CATEGORY]: intent === "unmute" },
    });
    return { intent, result };
  }
  if (intent === "enroll-opt-in" || intent === "enroll-opt-out") {
    const result = await k.users.setPreferences(String(user.id), "default", {
      __persistence_strategy__: "merge",
      categories: { [ENROLL_CATEGORY]: intent === "enroll-opt-in" },
    });
    return { intent, result };
  }
  if (intent === "enroll") {
    // PROTOTYPE: simulates the Enrollment moment. No enrollment row is written;
    // only the Knock trigger is under test.
    const courseId = Number(form.get("courseId"));
    const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!course) throw data("Course not found", { status: 404 });
    const instructor = db.select().from(users).where(eq(users.id, course.instructorId)).get();
    if (!instructor) throw data("Instructor not found", { status: 404 });
    // The real sync would already have run for the Instructor; run it here too
    // so a never-visited Instructor still gets the off-by-default.
    await syncUser(instructor);
    const res = await k.workflows.trigger(ENROLL_WORKFLOW, {
      recipients: [String(instructor.id)],
      actor: { id: String(user.id), name: user.name, email: user.email },
      data: { course_title: course.title, course_id: course.id, student_name: user.name },
    });
    return { intent, result: { ...res, instructor: instructor.name, course: course.title } };
  }
  return { intent, result: null };
}

type FeedResponse = {
  entries: Array<{ id: string; inserted_at: string; seen_at: string | null; read_at: string | null; data: Record<string, unknown>; actors: Array<{ name?: string }> }>;
  meta: { unread_count: number; unseen_count: number; total_count: number };
};

export default function KnockPrototype({ loaderData }: Route.ComponentProps) {
  const { user, knockUserId, token, publicKey, channelId, prefs, others, courseList, sync } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [feed, setFeed] = useState<FeedResponse | { error: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const headers = { Authorization: `Bearer ${publicKey}`, "X-Knock-User-Token": token, "Content-Type": "application/json" };
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 30));

  // Browser → Knock directly: this is the real client path the Feed UI would use.
  const loadFeed = useCallback(async () => {
    const r = await fetch(`https://api.knock.app/v1/users/${knockUserId}/feeds/${channelId}?page_size=20`, { headers });
    const body = await r.json();
    setFeed(r.ok ? body : { error: `${r.status} ${JSON.stringify(body)}` });
    note(`GET feed → ${r.status}${r.ok ? ` unread=${body.meta.unread_count} unseen=${body.meta.unseen_count}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knockUserId, token]);

  const markStatus = async (status: "seen" | "read" | "unread", ids: string[]) => {
    const r = await fetch(`https://api.knock.app/v1/messages/batch/${status}`, { method: "POST", headers, body: JSON.stringify({ message_ids: ids }) });
    note(`POST batch/${status} (${ids.length}) → ${r.status}`);
    await loadFeed();
  };

  const tryOtherUsersFeed = async () => {
    const other = others.find((o) => o.id !== user.id);
    if (!other) return;
    const r = await fetch(`https://api.knock.app/v1/users/${other.id}/feeds/${channelId}`, { headers });
    note(`GET ${other.name}'s feed with MY token → ${r.status} (expect 401/403)`);
  };

  useEffect(() => {
    setFeed(null);
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (fetcher.data) {
      note(`${fetcher.data.intent} → ${JSON.stringify(fetcher.data.result)}`);
      setTimeout(loadFeed, 1500); // workflow runs are async
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const entries = feed && "entries" in feed ? feed.entries : [];
  const muted = (prefs.categories as Record<string, unknown> | null)?.[CATEGORY] === false;
  const enrollPref = (prefs.categories as Record<string, unknown> | null)?.[ENROLL_CATEGORY];
  const enrollOn = enrollPref === true || (typeof enrollPref === "object" && enrollPref !== null);
  const messageOf = (e: { data: Record<string, unknown> }) =>
    e.data.message !== undefined
      ? String(e.data.message)
      : `${String(e.data.student_name)} enrolled in ${String(e.data.course_title)}`;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-sm">
        PROTOTYPE — Knock spike. Signed in as <b>{user.name}</b> ({user.role}), Knock user id <code>{knockUserId}</code>. Switch users in the DevUI panel.
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">1. Signed user token</h2>
        <pre className="text-xs bg-muted p-2 overflow-x-auto">{JSON.stringify(JSON.parse(atob(token.split(".")[1])), null, 2)}</pre>
        <Button variant="outline" onClick={tryOtherUsersFeed}>Try reading someone else's feed with my token</Button>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">2. Trigger via route action</h2>
        <fetcher.Form method="post" className="flex gap-2 items-center flex-wrap">
          <input type="hidden" name="intent" value="trigger" />
          <select name="recipientId" defaultValue={user.id} className="border rounded px-2 py-1">
            {others.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.role}){o.id === user.id ? " — me" : ""}</option>
            ))}
          </select>
          <input name="message" placeholder="message" className="border rounded px-2 py-1" />
          <Button type="submit" disabled={fetcher.state !== "idle"}>Trigger {WORKFLOW}</Button>
        </fetcher.Form>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">3. Headless feed</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="outline" onClick={loadFeed}>Refresh</Button>
          <Button variant="outline" onClick={() => markStatus("seen", entries.map((e) => e.id))} disabled={!entries.length}>Mark all seen</Button>
          {feed && "meta" in feed && (
            <span className="text-sm">unread <b>{feed.meta.unread_count}</b> · unseen <b>{feed.meta.unseen_count}</b> · total <b>{feed.meta.total_count}</b></span>
          )}
        </div>
        {feed && "error" in feed && <pre className="text-xs text-red-600">{feed.error}</pre>}
        <ul className="divide-y border rounded">
          {entries.map((e) => (
            <li key={e.id} className="p-2 text-sm flex justify-between gap-2">
              <span className={e.read_at ? "text-muted-foreground" : "font-medium"}>
                {messageOf(e)} — from {e.actors[0]?.name ?? "?"} · {new Date(e.inserted_at).toLocaleTimeString()}
                {!e.seen_at && " · unseen"}{!e.read_at && " · unread"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => markStatus(e.read_at ? "unread" : "read", [e.id])}>
                {e.read_at ? "Mark unread" : "Mark read"}
              </Button>
            </li>
          ))}
          {!entries.length && <li className="p-2 text-sm text-muted-foreground">No entries</li>}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">4. Category preference</h2>
        <fetcher.Form method="post" className="flex gap-2 items-center">
          <input type="hidden" name="intent" value={muted ? "unmute" : "mute"} />
          <span className="text-sm">Category <code>{CATEGORY}</code> is <b>{muted ? "MUTED" : "on"}</b> for me.</span>
          <Button type="submit" variant="outline">{muted ? "Unmute" : "Mute"}</Button>
        </fetcher.Form>
        <pre className="text-xs bg-muted p-2 overflow-x-auto">{JSON.stringify(prefs, null, 2)}</pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">5. Enrollment Notification (opt-in)</h2>
        <p className="text-sm">
          Sync on this page load: {sync.wroteDefault ? <b>wrote enrollment: false (was unset)</b> : "left enrollment alone (already set)"}.
          Category <code>{ENROLL_CATEGORY}</code> is <b>{enrollOn ? "OPTED IN" : "off"}</b> for me.
        </p>
        {user.role === UserRole.Instructor && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={enrollOn ? "enroll-opt-out" : "enroll-opt-in"} />
            <Button type="submit">{enrollOn ? "Opt out of Enrollment Notifications" : "Opt in to Enrollment Notifications"}</Button>
          </fetcher.Form>
        )}
        {user.role === UserRole.Student && (
          <fetcher.Form method="post" className="flex gap-2 items-center flex-wrap">
            <input type="hidden" name="intent" value="enroll" />
            <select name="courseId" className="border rounded px-2 py-1">
              {courseList.map((c) => (
                <option key={c.id} value={c.id}>{c.title} (Instructor: {c.instructorName})</option>
              ))}
            </select>
            <Button type="submit" disabled={fetcher.state !== "idle"}>Simulate enrolling</Button>
          </fetcher.Form>
        )}
        {user.role !== UserRole.Instructor && user.role !== UserRole.Student && (
          <p className="text-sm text-muted-foreground">Switch to a Student to enroll, or an Instructor to opt in.</p>
        )}
      </section>

      <section>
        <h2 className="font-semibold">Log</h2>
        <pre className="text-xs bg-muted p-2 h-48 overflow-y-auto">{log.join("\n")}</pre>
      </section>
    </div>
  );
}
