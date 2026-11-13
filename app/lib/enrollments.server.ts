import { and, eq } from "drizzle-orm";
import { coupons, courses, enrollments, purchases, users } from "~/db/schema";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";
import type {
  Notification,
  NotificationPerson,
} from "~/lib/notifications.server";

// ─── Enrollments ───
// The two ways a Student gets an Enrollment: claiming a Seat on a Team Licence,
// or making an Individual Purchase.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Enrollment = typeof enrollments.$inferSelect;
type Purchase = typeof purchases.$inferSelect;

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

function findEnrollment(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

export type ClaimResult =
  | { ok: true; enrollment: Enrollment; notifications: Notification[] }
  | { ok: false; error: string };

/**
 * Claims the Seat with this code for a Student and gives them an Enrollment.
 * The Seat must be unclaimed and available (not on hold during an Open Refund
 * Request, not refunded), the Student must not already be enrolled, and they
 * must be in the same country as the Team Licence's buyer.
 */
export function claimSeat(
  db: Db,
  code: string,
  studentId: number,
  studentCountry: string
): ClaimResult {
  const seat = db.select().from(coupons).where(eq(coupons.code, code)).get();
  if (!seat) {
    return { ok: false, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, error: SEAT_REFUNDED };
  }

  if (findEnrollment(db, studentId, seat.courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== studentCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  const enrollment = db.transaction((tx) => {
    tx.update(coupons)
      .set({
        redeemedByUserId: studentId,
        redeemedAt: new Date().toISOString(),
      })
      .where(eq(coupons.id, seat.id))
      .run();

    return tx
      .insert(enrollments)
      .values({ userId: studentId, courseId: seat.courseId })
      .returning()
      .get();
  });

  return {
    ok: true,
    enrollment,
    notifications: [
      seatClaimedNotification(
        db,
        seat.id,
        purchase?.userId ?? null,
        enrollment
      ),
      enrollmentNotification(db, enrollment),
    ].filter((notification) => notification !== null),
  };
}

export type IndividualPurchaseResult =
  | {
      ok: true;
      purchase: Purchase;
      enrollment: Enrollment;
      notifications: Notification[];
    }
  | { ok: false; error: string };

/**
 * Records an Individual Purchase and gives the buyer an Enrollment. A Student
 * has at most one Enrollment per course, so a buyer already enrolled is
 * refused.
 */
export function makeIndividualPurchase(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null
): IndividualPurchaseResult {
  if (findEnrollment(db, buyerId, courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const { purchase, enrollment } = db.transaction((tx) => {
    const purchase = tx
      .insert(purchases)
      .values({ userId: buyerId, courseId, amountPaid, country })
      .returning()
      .get();

    const enrollment = tx
      .insert(enrollments)
      .values({ userId: buyerId, courseId })
      .returning()
      .get();

    return { purchase, enrollment };
  });

  return {
    ok: true,
    purchase,
    enrollment,
    notifications: [enrollmentNotification(db, enrollment)].filter(
      (notification) => notification !== null
    ),
  };
}

// ─── Notifications ───

function findPerson(db: Db, id: number): NotificationPerson | undefined {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .get();
}

function findCourse(db: Db, id: number) {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.id, id))
    .get();
}

/**
 * "{Student} claimed a Seat on {course}", to the Team Admin who bought the
 * Team Licence, unless they claimed it themselves.
 */
function seatClaimedNotification(
  db: Db,
  seatId: number,
  buyerId: number | null,
  enrollment: Enrollment
): Notification | null {
  if (buyerId === null || buyerId === enrollment.userId) return null;

  const teamAdmin = findPerson(db, buyerId);
  const student = findPerson(db, enrollment.userId);
  const course = findCourse(db, enrollment.courseId);
  if (!teamAdmin || !student || !course) return null;

  return {
    kind: "seat-claimed",
    recipients: [teamAdmin],
    actor: student,
    data: { seatId, courseId: course.id, courseTitle: course.title },
    idempotencyKey: `seat-claimed:${seatId}`,
    arrivesRead: false,
  };
}

/**
 * "{Student} enrolled on {course}", to the course's Instructor, unless the
 * Instructor is the Student. Instructors only receive it once they opt in:
 * Knock's environment default turns the `enrollment` category off.
 */
function enrollmentNotification(
  db: Db,
  enrollment: Enrollment
): Notification | null {
  const course = findCourse(db, enrollment.courseId);
  if (!course || course.instructorId === enrollment.userId) return null;

  const instructor = findPerson(db, course.instructorId);
  const student = findPerson(db, enrollment.userId);
  if (!instructor || !student) return null;

  return {
    kind: "enrollment",
    recipients: [instructor],
    actor: student,
    data: {
      enrollmentId: enrollment.id,
      courseId: course.id,
      courseTitle: course.title,
    },
    idempotencyKey: `enrollment:${enrollment.id}`,
    arrivesRead: false,
  };
}
