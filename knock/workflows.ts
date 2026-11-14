import {
  categoryOf,
  notificationKindSchema,
  type NotificationKind,
} from "~/lib/notification-kinds";
import type { NotificationCategory } from "~/lib/notification-categories";

// ─── Knock workflows, as code ───
// One workflow per catalogue row, keyed by the Notification kind. Each sends
// to the in-app feed channel only and is tagged with its kind's category
// (from app/lib/notification-kinds.ts), which is what /settings mutes.
// `npm run knock:push-workflows` upserts and commits them in Knock's
// Development environment; add `-- --production` to promote them. See
// docs/knock-setup.md.
//
// The feed renders its own titles and links (app/lib/notification-kinds.ts),
// so the template here is only what Knock's dashboard and previews show.

export type KnockWorkflow = {
  key: NotificationKind;
  name: string;
  category: NotificationCategory;
  markdownBody: string;
  actionUrl: string;
};

const purchaseUrl =
  "{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}";
const commentUrl =
  "/courses/{{ data.courseSlug }}/lessons/{{ data.lessonId }}#comment-{{ data.commentId }}";

// Keyed by kind so the type checker insists every kind has a workflow.
const templates: Record<
  NotificationKind,
  Omit<KnockWorkflow, "key" | "category">
> = {
  "refund-opened": {
    name: "Refund Request opened",
    markdownBody:
      "**{{ actor.name }}** asked for a refund on **{{ data.courseTitle }}**",
    actionUrl: "/admin/refunds",
  },
  "refund-approved": {
    name: "Refund Request approved",
    markdownBody: "Your refund for **{{ data.courseTitle }}** was approved",
    actionUrl: purchaseUrl,
  },
  "refund-declined": {
    name: "Refund Request declined",
    markdownBody: "Your refund for **{{ data.courseTitle }}** was declined",
    actionUrl: purchaseUrl,
  },
  "seat-claimed": {
    name: "Seat claimed",
    markdownBody:
      "**{{ actor.name }}** claimed a Seat on **{{ data.courseTitle }}**",
    actionUrl: "/team",
  },
  enrollment: {
    name: "Enrollment created",
    markdownBody: "**{{ actor.name }}** enrolled on **{{ data.courseTitle }}**",
    actionUrl: "/instructor/{{ data.courseId }}/students",
  },
  "discussion-question": {
    name: "Discussion Question asked",
    markdownBody:
      "**{{ actor.name }}** asked on **{{ data.lessonTitle }}** in {{ data.courseTitle }}",
    actionUrl: commentUrl,
  },
  "discussion-reply": {
    name: "Discussion Reply posted",
    markdownBody:
      "**{{ actor.name }}** replied on **{{ data.lessonTitle }}** in {{ data.courseTitle }}",
    actionUrl: commentUrl,
  },
  "refund-received": {
    name: "Refund Request received",
    markdownBody:
      "We've got your refund request for **{{ data.courseTitle }}**",
    actionUrl: purchaseUrl,
  },
};

export const workflows: KnockWorkflow[] = notificationKindSchema.options.map(
  (key) => ({ key, category: categoryOf(key), ...templates[key] })
);
