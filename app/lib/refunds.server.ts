import { alias, type BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { RunResult } from "better-sqlite3";
import * as schema from "~/db/schema";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

/**
 * Anything that can run a query: the app's `db`, a test database, or a
 * transaction. Every function here takes one so tests can pass an in-memory
 * database.
 */
export type Db = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

// ─── Calendar days ───
// The Refund Window is counted in whole days, not hours: someone who buys at
// 23:00 still gets the whole of their fourteenth day.

function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / (24 * 60 * 60 * 1000);
}

export function lastDayOfRefundWindow(purchasedAtIso: string): string {
  const deadline = new Date(purchasedAtIso);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

/**
 * Whole days from `today` to the last day of the Refund Window. Zero on the
 * last day itself, negative once the window has closed.
 */
export function daysLeftInRefundWindow(
  purchasedAtIso: string,
  today: Date
): number {
  return (
    dayNumber(lastDayOfRefundWindow(purchasedAtIso)) -
    dayNumber(calendarDay(today))
  );
}

// ─── Progress ───

export type CourseProgress = {
  completedLessons: number;
  totalLessons: number;
  secondsWatched: number;
};

function getLessonIdsForCourse(db: Db, courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

export function getCourseProgress(
  db: Db,
  userId: number,
  courseId: number
): CourseProgress {
  const lessonIds = getLessonIdsForCourse(db, courseId);

  if (lessonIds.length === 0) {
    return { completedLessons: 0, totalLessons: 0, secondsWatched: 0 };
  }

  const completed = db
    .select({ count: sql<number>`count(distinct ${lessonProgress.lessonId})` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  // Hours watched is the furthest point reached in each lesson, added up, so
  // rewatching a lesson does not count twice.
  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return {
    completedLessons: completed?.count ?? 0,
    totalLessons: lessonIds.length,
    secondsWatched: furthestPerLesson.reduce(
      (total, row) => total + row.furthest,
      0
    ),
  };
}

// ─── Refund Eligibility ───

export type RefundEligibilityProblem =
  | "outside-refund-window"
  | "completed-too-much"
  | "watched-too-much"
  | "claimed-team-seat";

export const REFUND_ELIGIBILITY_PROBLEM_LABELS: Record<
  RefundEligibilityProblem,
  string
> = {
  "outside-refund-window": `Outside the ${REFUND_WINDOW_DAYS}-day Refund Window`,
  "completed-too-much": `Completed ${REFUND_COMPLETION_LIMIT * 100}% or more of the lessons`,
  "watched-too-much": `Watched ${REFUND_WATCH_LIMIT_SECONDS / 3600} hours or more`,
  "claimed-team-seat": "A claimed team seat",
};

export type RefundEligibility = {
  eligible: boolean;
  problems: RefundEligibilityProblem[];
  lastDayInWindow: string;
  progress: CourseProgress;
};

/**
 * Whether a learner may make a Refund Request for a Purchase, and if not, every
 * rule it fails. The Refund Window is judged on `asOf`; progress is as it is
 * now.
 */
export function checkRefundEligibility(
  db: Db,
  purchase: {
    id: number;
    userId: number;
    courseId: number;
    createdAt: string;
  },
  asOf: Date
): RefundEligibility {
  const problems: RefundEligibilityProblem[] = [];

  const purchasedDay = calendarDay(new Date(purchase.createdAt));
  const lastDayInWindow = lastDayOfRefundWindow(purchase.createdAt);
  const day = calendarDay(asOf);
  if (day < purchasedDay || day > lastDayInWindow) {
    problems.push("outside-refund-window");
  }

  const progress = getCourseProgress(db, purchase.userId, purchase.courseId);

  if (
    progress.totalLessons > 0 &&
    progress.completedLessons / progress.totalLessons >= REFUND_COMPLETION_LIMIT
  ) {
    problems.push("completed-too-much");
  }

  if (progress.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    problems.push("watched-too-much");
  }

  const claimedSeat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchase.id), isNotNull(coupons.redeemedAt))
    )
    .get();

  if (claimedSeat) {
    problems.push("claimed-team-seat");
  }

  return {
    eligible: problems.length === 0,
    problems,
    lastDayInWindow,
    progress,
  };
}

// ─── Purchases ───

/** A Purchase with seat coupons is a team licence, not an Individual Purchase. */
export function isTeamLicencePurchase(db: Db, purchaseId: number): boolean {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
}

/** A Refunded Purchase is one with an Approved Refund Request (ADR 0002). */
function isRefundedPurchase(db: Db, purchaseId: number): boolean {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Approved)
      )
    )
    .get();
}

/**
 * Whether the learner still has a place on the course from something other
 * than a Refunded Purchase: another Individual Purchase that isn't Refunded,
 * or a claimed team seat. A team-licence Purchase they bought themselves does
 * not count; it never gave them a place.
 */
function hasOtherCourseAccess(
  db: Db,
  userId: number,
  courseId: number
): boolean {
  const ownPurchases = db
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .all();

  const coveredByIndividualPurchase = ownPurchases.some(
    (purchase) =>
      !isTeamLicencePurchase(db, purchase.id) &&
      !isRefundedPurchase(db, purchase.id)
  );

  if (coveredByIndividualPurchase) return true;

  const claimedSeats = db
    .select({ purchaseId: coupons.purchaseId })
    .from(coupons)
    .where(
      and(
        eq(coupons.courseId, courseId),
        eq(coupons.redeemedByUserId, userId),
        isNotNull(coupons.redeemedAt)
      )
    )
    .all();

  return claimedSeats.some((seat) => !isRefundedPurchase(db, seat.purchaseId));
}

// ─── Deciding a Refund Request ───

export type RefundDecisionFailure =
  | "not-found"
  | "already-decided"
  | "team-licence";

export class RefundDecisionError extends Error {
  constructor(readonly failure: RefundDecisionFailure) {
    super(
      {
        "not-found": "Refund Request not found.",
        "already-decided": "This Refund Request has already been decided.",
        "team-licence":
          "Refund Requests on team-licence Purchases cannot be Approved yet.",
      }[failure]
    );
    this.name = "RefundDecisionError";
  }
}

export type RefundEmail = { to: string; subject: string; body: string };

function getRefundRequestContext(db: Db, refundId: number) {
  return db
    .select({
      refund: refunds,
      purchase: purchases,
      learner: { name: users.name, email: users.email },
      course: { title: courses.title },
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundId))
    .get();
}

/**
 * Marks a Requested Refund Request as decided. The status check is in the
 * UPDATE itself, so when two Platform Admins decide at once only one wins.
 */
function resolveRequested(
  db: Db,
  refundId: number,
  values: {
    status: RefundStatus.Approved | RefundStatus.Declined;
    amountRefunded: number | null;
    resolvedByUserId: number;
    resolvedAt: string;
  }
) {
  const resolved = db
    .update(refunds)
    .set(values)
    .where(
      and(eq(refunds.id, refundId), eq(refunds.status, RefundStatus.Requested))
    )
    .returning()
    .get();

  if (!resolved) throw new RefundDecisionError("already-decided");

  return resolved;
}

/**
 * Support Approves a Refund Request. The Refund Amount is what the learner
 * paid. Their enrollment is removed unless something else still covers them;
 * their progress, watch history and quiz attempts are kept (ADR 0001).
 */
export function approveRefundRequest(
  db: Db,
  input: { refundId: number; supportUserId: number; now?: Date }
) {
  const now = input.now ?? new Date();

  return db.transaction((tx) => {
    const context = getRefundRequestContext(tx, input.refundId);

    if (!context) throw new RefundDecisionError("not-found");
    if (context.refund.status !== RefundStatus.Requested) {
      throw new RefundDecisionError("already-decided");
    }
    if (isTeamLicencePurchase(tx, context.purchase.id)) {
      throw new RefundDecisionError("team-licence");
    }

    const refund = resolveRequested(tx, input.refundId, {
      status: RefundStatus.Approved,
      amountRefunded: context.purchase.amountPaid,
      resolvedByUserId: input.supportUserId,
      resolvedAt: now.toISOString(),
    });

    const { userId, courseId } = context.purchase;
    const accessRemoved = !hasOtherCourseAccess(tx, userId, courseId);

    if (accessRemoved) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, userId),
            eq(enrollments.courseId, courseId)
          )
        )
        .run();
    }

    const email: RefundEmail = {
      to: context.learner.email,
      subject: `Refund approved — ${context.course.title}`,
      body: [
        `Hi ${context.learner.name},`,
        "",
        `We have approved your refund request for "${context.course.title}".`,
        `We are giving back ${formatPrice(context.purchase.amountPaid)}, the amount you paid.`,
        accessRemoved
          ? "You no longer have access to the course. Your progress is saved, so if you buy it again you will pick up where you left off."
          : "You still have access to the course through another purchase or a team seat.",
        "",
        "— The Cadence team",
      ].join("\n"),
    };

    return { refund, accessRemoved, email };
  });
}

/**
 * Support Declines a Refund Request. No money is given back and access does
 * not change. An optional note from Support goes into the learner's email.
 */
export function declineRefundRequest(
  db: Db,
  input: {
    refundId: number;
    supportUserId: number;
    note?: string | null;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();

  return db.transaction((tx) => {
    const context = getRefundRequestContext(tx, input.refundId);

    if (!context) throw new RefundDecisionError("not-found");
    if (context.refund.status !== RefundStatus.Requested) {
      throw new RefundDecisionError("already-decided");
    }

    const refund = resolveRequested(tx, input.refundId, {
      status: RefundStatus.Declined,
      amountRefunded: null,
      resolvedByUserId: input.supportUserId,
      resolvedAt: now.toISOString(),
    });

    const note = input.note?.trim();

    const email: RefundEmail = {
      to: context.learner.email,
      subject: `Refund request declined — ${context.course.title}`,
      body: [
        `Hi ${context.learner.name},`,
        "",
        `We have looked at your refund request for "${context.course.title}" and have declined it. You keep your access to the course.`,
        ...(note ? ["", "A note from our team:", note] : []),
        "",
        "— The Cadence team",
      ].join("\n"),
    };

    return { refund, email };
  });
}

// ─── The Support screen ───

/**
 * Every Refund Request, Requested ones first (oldest first), then resolved
 * ones (most recently decided first), with what Support needs to decide.
 */
export function listRefundRequests(db: Db, now: Date = new Date()) {
  const resolver = alias(users, "resolver");
  const learner = alias(users, "learner");

  const rows = db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      amountRefunded: refunds.amountRefunded,
      resolvedByName: resolver.name,
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      amountPaid: purchases.amountPaid,
      userId: learner.id,
      learnerName: learner.name,
      learnerEmail: learner.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(learner, eq(purchases.userId, learner.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(resolver, eq(refunds.resolvedByUserId, resolver.id))
    .orderBy(
      sql`case when ${refunds.status} = ${RefundStatus.Requested} then 0 else 1 end`,
      // Requested: oldest first. Resolved: most recently decided first.
      sql`case when ${refunds.status} = ${RefundStatus.Requested} then ${refunds.requestedAt} end asc`,
      desc(refunds.resolvedAt),
      asc(refunds.id)
    )
    .all();

  return rows.map((row) => {
    const eligibility = checkRefundEligibility(
      db,
      {
        id: row.purchaseId,
        userId: row.userId,
        courseId: row.courseId,
        createdAt: row.purchasedAt,
      },
      // The window is judged on the day the learner asked, not the day
      // Support gets to it.
      new Date(row.requestedAt)
    );

    return {
      ...row,
      progress: eligibility.progress,
      eligibilityProblems: eligibility.problems,
      daysLeftInWindow: daysLeftInRefundWindow(row.purchasedAt, now),
      isTeamLicence: isTeamLicencePurchase(db, row.purchaseId),
    };
  });
}
