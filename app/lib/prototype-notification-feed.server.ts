// PROTOTYPE, never merge. Server side of "What does the Notification Feed look
// like in Cadence?" (https://github.com/spprashaant/software-factories/issues/22).
//
// Signs a Knock user token for the DevUI user (so the browser can read its own
// feed headlessly), and sends sample Notifications from the catalogue to that
// user through the existing `prototype-spike` workflow (one in-app feed step,
// committed in Development by the Knock spike). The real workflows don't exist
// yet; every sample carries its own `kind` so the Feed UI renders it like the
// real Notification would.
import Knock, { signUserToken } from "@knocklabs/node";
import { UserRole } from "~/db/schema";

try {
  process.loadEnvFile?.();
} catch {}

const WORKFLOW = "prototype-spike";
const CATEGORY = "prototype-spike";

export type FeedConfig = {
  knockUserId: string;
  token: string;
  publicKey: string;
  channelId: string;
};

export async function feedConfigFor(userId: number): Promise<FeedConfig | null> {
  if (!process.env.KNOCK_API_KEY || !process.env.KNOCK_SIGNING_KEY) return null;
  const knockUserId = String(userId);
  return {
    knockUserId,
    token: await signUserToken(knockUserId, { expiresInSeconds: 60 * 60 }),
    publicKey: process.env.KNOCK_PUBLIC_API_KEY!,
    channelId: process.env.KNOCK_FEED_CHANNEL_ID!,
  };
}

// The catalogue rows, as the data payload a real workflow would carry.
// `minutes_ago` fakes age for display only (Knock stamps inserted_at itself).
type Sample = {
  kind: string;
  actor: { id: string; name: string } | null;
  data: Record<string, unknown>;
};

const emma = { id: "5", name: "Emma Wilson" };
const james = { id: "6", name: "James Park" };
const olivia = { id: "7", name: "Olivia Martinez" };
const sarah = { id: "2", name: "Sarah Chen" };
const marcus = { id: "3", name: "Marcus Johnson" };
const ava = { id: "11", name: "Ava Nakamura" };
const alex = { id: "1", name: "Alex Rivera" };

const lessonUrl = (lessonId: number, commentId: number) =>
  `/courses/introduction-to-typescript/lessons/${lessonId}#comment-${commentId}`;

function samplesFor(role: UserRole, isTeamAdmin: boolean): Sample[] {
  const s: Sample[] = [];
  if (role === UserRole.Admin) {
    s.push(
      { kind: "refund-opened", actor: james, data: { course_title: "Building REST APIs with Node.js", url: "/admin/refunds", minutes_ago: 4 } },
      { kind: "refund-opened", actor: olivia, data: { course_title: "Design Systems with Tailwind", url: "/admin/refunds", minutes_ago: 95 } },
      { kind: "refund-opened", actor: emma, data: { course_title: "Introduction to TypeScript", url: "/admin/refunds", minutes_ago: 60 * 26 } },
    );
  }
  if (role === UserRole.Instructor) {
    s.push(
      { kind: "question-asked", actor: emma, data: { course_title: "Introduction to TypeScript", lesson_title: "Your First TypeScript Program", excerpt: "I'm getting `tsc: command not found` when I run the compile step. I installed TypeScript with npm install typescript, so I'm not sure what's missing…", url: lessonUrl(3, 1), minutes_ago: 7 } },
      { kind: "enrollment", actor: ava, data: { course_title: "Introduction to TypeScript", url: "/instructor/1/students", minutes_ago: 50 } },
      { kind: "question-asked", actor: olivia, data: { course_title: "Introduction to TypeScript", lesson_title: "Generics", excerpt: "Why does this fail to infer? I expected `T` to come out as `string` but it's `unknown`.", url: lessonUrl(8, 4), minutes_ago: 60 * 5 } },
      { kind: "enrollment", actor: james, data: { course_title: "Introduction to TypeScript", url: "/instructor/1/students", minutes_ago: 60 * 30 } },
    );
  }
  if (role === UserRole.Student) {
    s.push(
      { kind: "reply-posted", actor: sarah, data: { course_title: "Introduction to TypeScript", lesson_title: "Your First TypeScript Program", excerpt: "That usually means TypeScript is installed locally but not on your PATH. Try `npx tsc` instead.", url: lessonUrl(3, 2), minutes_ago: 3 } },
      { kind: "refund-received", actor: null, data: { course_title: "Practical Data Visualisation", url: "/settings", minutes_ago: 20 } },
      { kind: "refund-approved", actor: alex, data: { course_title: "Building REST APIs with Node.js", note: "Refunded in full. Sorry it wasn't the right fit.", url: "/settings", minutes_ago: 60 * 3 } },
      { kind: "refund-declined", actor: alex, data: { course_title: "Design Systems with Tailwind", note: "You've completed over half the course, which is past the refund window.", url: "/settings", minutes_ago: 60 * 50 } },
      { kind: "reply-posted", actor: marcus, data: { course_title: "Building REST APIs with Node.js", lesson_title: "Routing basics", excerpt: "Good catch, the order of middleware matters here. Move the auth check above the router.", url: lessonUrl(2, 2), minutes_ago: 60 * 28 } },
    );
  }
  if (isTeamAdmin) {
    s.push(
      { kind: "seat-claimed", actor: olivia, data: { course_title: "Introduction to TypeScript", url: "/team", minutes_ago: 12 } },
      { kind: "seat-claimed", actor: james, data: { course_title: "Introduction to TypeScript", url: "/team", minutes_ago: 60 * 4 } },
    );
  }
  return s;
}

export async function sendSamples(user: { id: number; name: string; email: string; role: UserRole }, isTeamAdmin: boolean) {
  const k = new Knock();
  const id = String(user.id);
  await k.users.update(id, { name: user.name, email: user.email });
  // Make sure an earlier spike session didn't leave the category muted.
  await k.users.setPreferences(id, "default", {
    __persistence_strategy__: "merge",
    categories: { [CATEGORY]: true },
  });
  // Oldest first, so Knock's inserted_at order matches the fake ages.
  const samples = samplesFor(user.role, isTeamAdmin).sort(
    (a, b) => Number(b.data.minutes_ago) - Number(a.data.minutes_ago)
  );
  for (const s of samples) {
    await k.workflows.trigger(WORKFLOW, {
      recipients: [id],
      actor: s.actor ?? undefined,
      data: {
        ...s.data,
        kind: s.kind,
        message: s.kind, // the spike's template renders `message`; we render ourselves
        sent_at: new Date(Date.now() - Number(s.data.minutes_ago) * 60_000).toISOString(),
      },
    });
  }
  // Row 8 (your refund request was received) is a receipt: deliver it already
  // read and seen so it never bumps the badge.
  await new Promise((r) => setTimeout(r, 3000));
  const receipts: string[] = [];
  for await (const m of k.users.listMessages(id, { channel_id: process.env.KNOCK_FEED_CHANNEL_ID, page_size: 50 })) {
    const data = (m.data ?? {}) as Record<string, unknown>;
    if (data.kind === "refund-received" && !m.read_at) receipts.push(m.id!);
  }
  if (receipts.length) {
    await k.messages.batch.markAsSeen({ message_ids: receipts });
    await k.messages.batch.markAsRead({ message_ids: receipts });
  }
  return { sent: samples.length, receiptsMarkedRead: receipts.length };
}

// "Send 100": many Notifications for this role, ages spread over ~30 days,
// sent oldest first so Knock's order matches the fake ages.
export async function sendMany(user: { id: number; name: string; email: string; role: UserRole }, isTeamAdmin: boolean, n = 100) {
  const k = new Knock();
  const id = String(user.id);
  await k.users.update(id, { name: user.name, email: user.email });
  await k.users.setPreferences(id, "default", { __persistence_strategy__: "merge", categories: { [CATEGORY]: true } });
  const pool = samplesFor(user.role, isTeamAdmin).filter((s) => s.kind !== "refund-received");
  const ages = Array.from({ length: n }, (_, i) => Math.round(((n - i) / n) * 60 * 24 * 30));
  let sent = 0;
  for (const minutes_ago of ages) {
    const s = pool[Math.floor(Math.random() * pool.length)];
    await k.workflows.trigger(WORKFLOW, {
      recipients: [id],
      actor: s.actor ?? undefined,
      data: { ...s.data, minutes_ago, kind: s.kind, message: s.kind, sent_at: new Date(Date.now() - minutes_ago * 60_000).toISOString() },
    });
    sent++;
  }
  return { sent };
}

export async function archiveAll(userId: number) {
  const k = new Knock();
  const ids: string[] = [];
  for await (const m of k.users.listMessages(String(userId), { channel_id: process.env.KNOCK_FEED_CHANNEL_ID, page_size: 50 })) {
    ids.push(m.id!);
  }
  for (let i = 0; i < ids.length; i += 50) await k.messages.batch.archive({ message_ids: ids.slice(i, i + 50) });
  return { archived: ids.length };
}
