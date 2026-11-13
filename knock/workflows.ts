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

export type NotificationCategory = "refund-requests" | "my-refunds";

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
    key: "refund-received",
    name: "Refund Request received",
    category: "my-refunds",
    markdownBody:
      "We've got your refund request for **{{ data.courseTitle }}**",
    actionUrl:
      "{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}",
  },
  {
    key: "refund-approved",
    name: "Refund Request approved",
    category: "my-refunds",
    markdownBody: "Your refund for **{{ data.courseTitle }}** was approved",
    actionUrl:
      "{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}",
  },
  {
    key: "refund-declined",
    name: "Refund Request declined",
    category: "my-refunds",
    markdownBody: "Your refund for **{{ data.courseTitle }}** was declined",
    actionUrl:
      "{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}",
  },
];
