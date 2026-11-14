import { z } from "zod";
import { UserRole } from "~/db/schema";

// ─── Notification categories ───
// The code-side category list. Each key is also a Knock category:
// `npm run knock:push-workflows` adds it to Knock's catalog and tags the
// workflows with it (knock/workflows.ts). Which kind is in which category lives in
// app/lib/notification-kinds.ts. /settings uses this list to decide which
// toggles a user sees and what they show before the user has ever chosen
// (Knock answers 404 for a user it doesn't know yet).

export const notificationCategorySchema = z.enum([
  "refund-requests",
  "my-refunds",
  "seat-claims",
  "enrollment",
  "discussion-questions",
  "discussion-replies",
]);

export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export type NotificationCategoryInfo = {
  key: NotificationCategory;
  /** Shown on /settings, in glossary wording. */
  label: string;
  /**
   * Roles that can receive it. Anyone can buy, so anyone can be a buyer or a
   * Team Admin and receive "Your refunds" and "Seat claims".
   */
  roles: UserRole[];
  defaultEnabled: boolean;
};

const everyone = [UserRole.Student, UserRole.Instructor, UserRole.Admin];

export const notificationCategories: NotificationCategoryInfo[] = [
  {
    key: "refund-requests",
    label: "Refund Requests to review",
    roles: [UserRole.Admin],
    defaultEnabled: true,
  },
  {
    key: "my-refunds",
    label: "Your refunds",
    roles: everyone,
    defaultEnabled: true,
  },
  {
    key: "seat-claims",
    label: "Seat claims",
    roles: everyone,
    defaultEnabled: true,
  },
  {
    key: "enrollment",
    label: "Enrollments",
    roles: [UserRole.Instructor],
    defaultEnabled: false,
  },
  {
    key: "discussion-questions",
    label: "Discussion Questions",
    roles: [UserRole.Instructor],
    defaultEnabled: true,
  },
  {
    key: "discussion-replies",
    label: "Discussion Replies",
    roles: everyone,
    defaultEnabled: true,
  },
];

/** What a user has chosen. A missing category means they haven't chosen. */
export const categoryPreferencesSchema = z.record(
  notificationCategorySchema,
  z.boolean()
);

export type CategoryPreferences = z.infer<typeof categoryPreferencesSchema>;

export type NotificationSetting = {
  category: NotificationCategory;
  label: string;
  enabled: boolean;
};

/** Whether a user gets this category: what they chose, else its default. */
export function receivesCategory(
  category: NotificationCategory,
  preferences: CategoryPreferences
): boolean {
  return preferences[category] ?? categoryInfo(category).defaultEnabled;
}

function categoryInfo(key: NotificationCategory): NotificationCategoryInfo {
  const info = notificationCategories.find((category) => category.key === key);
  if (!info) throw new Error(`Unknown notification category: ${key}`);
  return info;
}

/** One toggle per category the role can receive, chosen value over default. */
export function notificationSettingsFor(
  role: UserRole,
  preferences: CategoryPreferences
): NotificationSetting[] {
  return notificationCategories
    .filter((category) => category.roles.includes(role))
    .map((category) => ({
      category: category.key,
      label: category.label,
      enabled: preferences[category.key] ?? category.defaultEnabled,
    }));
}
