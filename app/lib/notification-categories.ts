import { UserRole } from "~/db/schema";

// ─── Notification categories ───
// The code-side category list. Each key is also a Knock category, tagged on
// the workflows in knock/workflows.ts, so this list must match the Knock
// dashboard. /settings uses it to decide which toggles a user sees and what
// they show before the user has ever chosen (Knock answers 404 for a user it
// doesn't know yet).

export type NotificationCategory =
  | "refund-requests"
  | "my-refunds"
  | "seat-claims"
  | "enrollment"
  | "discussion-questions"
  | "discussion-replies";

export type NotificationCategoryInfo = {
  key: NotificationCategory;
  /** Shown on /settings, in glossary wording. */
  label: string;
  /** Roles that can receive it. Buyers and Team Admins are Students. */
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
    roles: [UserRole.Student],
    defaultEnabled: true,
  },
  {
    key: "seat-claims",
    label: "Seat claims",
    roles: [UserRole.Student],
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

export const notificationCategoryKeys = notificationCategories.map(
  (category) => category.key
) as [NotificationCategory, ...NotificationCategory[]];

/** What a user has chosen. A missing category means they haven't chosen. */
export type CategoryPreferences = Partial<Record<NotificationCategory, boolean>>;

export type NotificationSetting = {
  category: NotificationCategory;
  label: string;
  enabled: boolean;
};

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
