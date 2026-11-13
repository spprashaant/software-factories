// PROTOTYPE, never merge. Sends sample Notifications to (or clears) the DevUI
// user's Knock feed for the Notification Feed prototype.
import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/prototype.notifications-seed";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { teamMembers, TeamMemberRole, users } from "~/db/schema";
import { archiveAll, sendMany, sendSamples } from "~/lib/prototype-notification-feed.server";

export async function action({ request }: Route.ActionArgs) {
  const id = await getCurrentUserId(request);
  if (!id) throw data("Select a user from the DevUI panel.", { status: 401 });
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw data("User not found", { status: 404 });
  const form = await request.formData();
  if (form.get("intent") === "clear") return archiveAll(id);
  const isTeamAdmin = !!db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, id), eq(teamMembers.role, TeamMemberRole.Admin)))
    .get();
  if (form.get("intent") === "send100") return sendMany(user, isTeamAdmin, 100);
  return sendSamples(user, isTeamAdmin);
}
