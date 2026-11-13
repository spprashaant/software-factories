import { and, eq } from "drizzle-orm";
import { UserRole, courses, enrollments, purchases, users } from "~/db/schema";
import { checkPppAccess } from "~/lib/ppp";
import type { Db } from "~/lib/refunds.server";

// ─── Course access, db-first ───
// What a signed-in user may do with one course. `getAccess` (access.server.ts)
// wraps this with the session and request country for the routes; the
// Notification Feed's lookup calls it directly, so both answer "can they see
// this course?" the same way the lesson page does.
//
// Uses positional parameters (project convention).

export type CourseAccess = {
  user: typeof users.$inferSelect | undefined;
  isAdmin: boolean;
  /** The instructor who owns this specific course. */
  isOwningInstructor: boolean;
  /** Owning instructor or admin — the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * Staff always can. Students need an enrollment that isn't PPP-blocked.
   */
  canViewContent: boolean;
};

export function resolveCourseAccess(
  db: Db,
  userId: number,
  courseId: number,
  currentCountry: string | null
): CourseAccess {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const isAdmin = user?.role === UserRole.Admin;
  const isOwningInstructor = !!user && course?.instructorId === userId;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled =
    !!user &&
    !!db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
      )
      .get();

  // PPP only restricts students who bought at a discount — staff are exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isStaff && course) {
    const purchase = db
      .select()
      .from(purchases)
      .where(
        and(eq(purchases.userId, userId), eq(purchases.courseId, courseId))
      )
      .get();
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      currentCountry
    );
  }

  return {
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}
