import {
  MessageCircleQuestion,
  MessageSquareReply,
  Receipt,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import type { NotificationCategory } from "~/lib/notification-categories";

// ─── Notification kinds ───
// One entry per row of the v1 catalogue. Each kind is also the key of the
// Knock workflow that delivers it (knock/workflows.ts), tagged with the
// kind's category. Everything Cadence needs to know about a
// kind lives here: its category, how its feed row reads and where it links,
// its icon, and which detail line the feed looks up for it.
//
// Adding a kind: add it to the list below, to NOTIFICATION_KINDS and to
// knock/workflows.ts (the type checker insists), return it from a service,
// and run `npm run knock:push-workflows`.

export const notificationKindSchema = z.enum([
  "refund-opened",
  "refund-approved",
  "refund-declined",
  "seat-claimed",
  "enrollment",
  "discussion-question",
  "discussion-reply",
  "refund-received",
]);

export type NotificationKind = z.infer<typeof notificationKindSchema>;

export type TitlePart = { text: string; bold: boolean };

export type DescribedNotification = {
  title: TitlePart[];
  /** Shown before the time on the row's meta line, e.g. the course. */
  meta?: string;
  url: string;
};

/**
 * The line under a feed row, looked up from Cadence at render time because
 * Knock never holds text a person wrote: a Discussion comment's excerpt, or a
 * Refund Request's decision note.
 */
export type DetailSource = "comment" | "decision-note";

/** What a feed row has to go on: the Notification's data and its actor. */
export type FeedFacts = { data: Record<string, unknown>; actorName: string };

type KindDefinition = {
  category: NotificationCategory;
  icon: LucideIcon;
  detail: DetailSource | null;
  describe(facts: FeedFacts): DescribedNotification;
};

/** The value when it is a non-empty string, otherwise the fallback. */
function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const courseTitle = (data: Record<string, unknown>) =>
  stringOr(data.courseTitle, "a course");

/** Where a Purchase is managed: /team for a Team Licence, else /settings. */
function purchaseUrl(data: Record<string, unknown>) {
  return data.purchaseKind === "team_licence" ? "/team" : "/settings";
}

function refundDecided(decision: "approved" | "declined"): KindDefinition {
  return {
    category: "my-refunds",
    icon: Receipt,
    detail: "decision-note",
    describe: ({ data }) => ({
      title: [
        { text: "Your refund for ", bold: false },
        { text: courseTitle(data), bold: true },
        { text: ` was ${decision}`, bold: false },
      ],
      url: purchaseUrl(data),
    }),
  };
}

function discussion(
  category: NotificationCategory,
  icon: LucideIcon,
  verb: string
): KindDefinition {
  return {
    category,
    icon,
    detail: "comment",
    describe: ({ data, actorName }) => ({
      title: [
        { text: actorName, bold: true },
        { text: ` ${verb} on `, bold: false },
        { text: stringOr(data.lessonTitle, "a lesson"), bold: true },
      ],
      meta: courseTitle(data),
      url: `/courses/${encodeURIComponent(stringOr(data.courseSlug, ""))}/lessons/${String(data.lessonId)}#comment-${String(data.commentId)}`,
    }),
  };
}

export const NOTIFICATION_KINDS: Record<NotificationKind, KindDefinition> = {
  "refund-opened": {
    category: "refund-requests",
    icon: Receipt,
    detail: null,
    describe: ({ data, actorName }) => ({
      title: [
        { text: actorName, bold: true },
        { text: " asked for a refund on ", bold: false },
        { text: courseTitle(data), bold: true },
      ],
      url: "/admin/refunds",
    }),
  },
  "refund-approved": refundDecided("approved"),
  "refund-declined": refundDecided("declined"),
  "seat-claimed": {
    category: "seat-claims",
    icon: UsersRound,
    detail: null,
    describe: ({ data, actorName }) => ({
      title: [
        { text: actorName, bold: true },
        { text: " claimed a Seat on ", bold: false },
        { text: courseTitle(data), bold: true },
      ],
      url: "/team",
    }),
  },
  enrollment: {
    category: "enrollment",
    icon: UserPlus,
    detail: null,
    describe: ({ data, actorName }) => ({
      title: [
        { text: actorName, bold: true },
        { text: " enrolled on ", bold: false },
        { text: courseTitle(data), bold: true },
      ],
      url:
        typeof data.courseId === "number" || typeof data.courseId === "string"
          ? `/instructor/${data.courseId}/students`
          : "/instructor",
    }),
  },
  "discussion-question": discussion(
    "discussion-questions",
    MessageCircleQuestion,
    "asked"
  ),
  "discussion-reply": discussion(
    "discussion-replies",
    MessageSquareReply,
    "replied"
  ),
  "refund-received": {
    category: "my-refunds",
    icon: Receipt,
    detail: null,
    describe: ({ data }) => ({
      title: [
        { text: "We've got your refund request for ", bold: false },
        { text: courseTitle(data), bold: true },
      ],
      url: purchaseUrl(data),
    }),
  },
};

export function categoryOf(kind: NotificationKind): NotificationCategory {
  return NOTIFICATION_KINDS[kind].category;
}
