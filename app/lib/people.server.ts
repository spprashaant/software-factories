import { eq } from "drizzle-orm";
import { users } from "~/db/schema";
import type { Queryable } from "~/db/types";
import type { NotificationPerson } from "~/lib/notifications.server";

/** A user as a Notification names them: id and name, nothing else. */
export function findPerson(
  db: Queryable,
  userId: number
): NotificationPerson | undefined {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}
