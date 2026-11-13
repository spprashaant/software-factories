import type { NotificationKind } from "~/lib/notifications.server";

// ─── Knock workflows, as code ───
// One workflow per catalogue row, keyed by the Notification kind. Each sends
// to the in-app feed channel only and is tagged with its category, which is
// what /settings mutes. `npm run knock:push-workflows` upserts and commits
// them in Knock's Development environment. Promoting them to Production is a
// dashboard step: see docs/knock-setup.md.
//
// The feed renders its own titles (app/lib/notification-feed.ts), so the
// template body here is what Knock's dashboard and previews show.

export type NotificationCategory =
  | "refund-requests"
  | "discussion-questions"
  | "discussion-replies";

export type KnockWorkflow = {
  key: NotificationKind;
  name: string;
  category: NotificationCategory;
  markdownBody: string;
  actionUrl: string;
};

export const workflows: KnockWorkflow[] = [
  {
    key: "refund-opened",
    name: "Refund Request opened",
    category: "refund-requests",
    markdownBody:
      "**{{ actor.name }}** asked for a refund on **{{ data.courseTitle }}**",
    actionUrl: "/admin/refunds",
  },
  {
    key: "discussion-question",
    name: "Discussion Question asked",
    category: "discussion-questions",
    markdownBody:
      "**{{ actor.name }}** asked on **{{ data.lessonTitle }}** in {{ data.courseTitle }}",
    actionUrl:
      "/courses/{{ data.courseSlug }}/lessons/{{ data.lessonId }}#comment-{{ data.commentId }}",
  },
  {
    key: "discussion-reply",
    name: "Discussion Reply posted",
    category: "discussion-replies",
    markdownBody:
      "**{{ actor.name }}** replied on **{{ data.lessonTitle }}** in {{ data.courseTitle }}",
    actionUrl:
      "/courses/{{ data.courseSlug }}/lessons/{{ data.lessonId }}#comment-{{ data.commentId }}",
  },
];
