import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  LessonProgressStatus,
  RefundStatus,
  TeamMemberRole,
  UserRole,
} from "~/db/schema";
import {
  approveRefundRequest,
  checkRefundEligibility,
  declineRefundRequest,
  listRefundRequests,
  RefundDecisionError,
} from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

// Local times, because the Refund Window is counted in the learner's
// calendar days.
const NOV_1 = new Date(2026, 10, 1, 23, 0);
const NOV_5 = new Date(2026, 10, 5, 10, 0);
const NOV_15 = new Date(2026, 10, 15, 22, 0);
const NOV_16 = new Date(2026, 10, 16, 0, 30);

let db: TestDb;
let learner: typeof schema.users.$inferSelect;
let support: typeof schema.users.$inferSelect;
let course: typeof schema.courses.$inferSelect;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  const base = seedBaseData(db);
  learner = base.user;
  course = db
    .update(schema.courses)
    .set({ price: 9900 })
    .where(eq(schema.courses.id, base.course.id))
    .returning()
    .get();

  support = db
    .insert(schema.users)
    .values({
      name: "Pat Platform",
      email: "pat@cadence.dev",
      role: UserRole.Admin,
    })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

// ─── Helpers ───

function buyCourse(
  userId: number,
  options: { amountPaid?: number; at?: Date } = {}
) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: course.id,
      amountPaid: options.amountPaid ?? 4900,
      createdAt: (options.at ?? NOV_1).toISOString(),
    })
    .returning()
    .get();

  db.insert(schema.enrollments)
    .values({ userId, courseId: course.id })
    .run();

  return purchase;
}

function requestRefund(purchaseId: number, at: Date = NOV_5) {
  return db
    .insert(schema.refunds)
    .values({
      purchaseId,
      reason: "It was not what I expected.",
      requestedAt: at.toISOString(),
    })
    .returning()
    .get();
}

/** Someone buys a team licence; returns the Purchase and its seat coupons. */
function buyTeamLicence(buyerId: number, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId: buyerId, role: TeamMemberRole.Admin })
    .run();

  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: buyerId,
      courseId: course.id,
      amountPaid: 9900 * seats,
      createdAt: NOV_1.toISOString(),
    })
    .returning()
    .get();

  const seatCoupons = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );

  return { purchase, seatCoupons };
}

function claimSeat(couponId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: NOV_1.toISOString() })
    .where(eq(schema.coupons.id, couponId))
    .run();
}

function isEnrolled(userId: number) {
  return !!db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, course.id)
      )
    )
    .get();
}

function getRefund(id: number) {
  return db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.id, id))
    .get();
}

function completeLessons(userId: number, count: number) {
  for (const lessonId of lessonIds.slice(0, count)) {
    db.insert(schema.lessonProgress)
      .values({
        userId,
        lessonId,
        status: LessonProgressStatus.Completed,
        completedAt: NOV_1.toISOString(),
      })
      .run();
  }
}

function expectDecisionError(fn: () => unknown, failure: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RefundDecisionError);
    if (error instanceof RefundDecisionError) {
      expect(error.failure).toBe(failure);
    }
    return;
  }
  throw new Error(`Expected a "${failure}" RefundDecisionError`);
}

// ─── Approve ───

describe("approveRefundRequest", () => {
  it("Approves with the amount paid as the Refund Amount, and records who and when", () => {
    const purchase = buyCourse(learner.id, { amountPaid: 4900 });
    const request = requestRefund(purchase.id);
    const decidedAt = new Date(2026, 10, 6, 9, 0);

    approveRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
      now: decidedAt,
    });

    expect(getRefund(request.id)).toMatchObject({
      status: RefundStatus.Approved,
      amountRefunded: 4900,
      resolvedAt: decidedAt.toISOString(),
      resolvedByUserId: support.id,
    });
  });

  it("builds an email that quotes the amount paid, not the list price", () => {
    const purchase = buyCourse(learner.id, { amountPaid: 4900 });
    const request = requestRefund(purchase.id);

    const { email } = approveRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
    });

    expect(email.to).toBe(learner.email);
    expect(email.body).toContain("$49.00");
    expect(email.body).not.toContain("$99.00");
  });

  it("removes the learner's enrollment when nothing else covers them", () => {
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);
    expect(isEnrolled(learner.id)).toBe(true);

    const result = approveRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
    });

    expect(result.accessRemoved).toBe(true);
    expect(isEnrolled(learner.id)).toBe(false);
  });

  it("keeps the enrollment when another Individual Purchase that isn't Refunded covers the learner", () => {
    const first = buyCourse(learner.id);
    buyCourse(learner.id, { at: NOV_5 });
    const request = requestRefund(first.id);

    const result = approveRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
    });

    expect(result.accessRemoved).toBe(false);
    expect(isEnrolled(learner.id)).toBe(true);
  });

  it("removes the enrollment when the other Individual Purchase is itself a Refunded Purchase", () => {
    const first = buyCourse(learner.id);
    const second = buyCourse(learner.id, { at: NOV_5 });
    approveRefundRequest(db, {
      refundId: requestRefund(first.id).id,
      supportUserId: support.id,
    });

    approveRefundRequest(db, {
      refundId: requestRefund(second.id).id,
      supportUserId: support.id,
    });

    expect(isEnrolled(learner.id)).toBe(false);
  });

  it("keeps the enrollment when a claimed team seat covers the learner", () => {
    const teamAdmin = db
      .insert(schema.users)
      .values({ name: "Tess Team", email: "tess@example.com", role: UserRole.Student })
      .returning()
      .get();
    const { seatCoupons } = buyTeamLicence(teamAdmin.id, 2);
    claimSeat(seatCoupons[0].id, learner.id);
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);

    const result = approveRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
    });

    expect(result.accessRemoved).toBe(false);
    expect(isEnrolled(learner.id)).toBe(true);
  });

  it("does not count a team-licence Purchase the learner bought themselves", () => {
    buyTeamLicence(learner.id, 3);
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);

    approveRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
    });

    expect(isEnrolled(learner.id)).toBe(false);
  });

  it("keeps lesson progress, watch events and quiz attempts", () => {
    const purchase = buyCourse(learner.id);
    completeLessons(learner.id, 1);
    db.insert(schema.videoWatchEvents)
      .values({
        userId: learner.id,
        lessonId: lessonIds[0],
        eventType: "progress",
        positionSeconds: 120,
      })
      .run();
    const quiz = db
      .insert(schema.quizzes)
      .values({ lessonId: lessonIds[0], title: "Quiz", passingScore: 0.5 })
      .returning()
      .get();
    db.insert(schema.quizAttempts)
      .values({ userId: learner.id, quizId: quiz.id, score: 1, passed: true })
      .run();

    const snapshot = () => ({
      progress: db.select().from(schema.lessonProgress).all(),
      watchEvents: db.select().from(schema.videoWatchEvents).all(),
      quizAttempts: db.select().from(schema.quizAttempts).all(),
    });
    const before = snapshot();

    approveRefundRequest(db, {
      refundId: requestRefund(purchase.id).id,
      supportUserId: support.id,
    });

    expect(snapshot()).toEqual(before);
    expect(before.progress).toHaveLength(1);
    expect(before.watchEvents).toHaveLength(1);
    expect(before.quizAttempts).toHaveLength(1);
  });

  it("rejects a team-licence Purchase and changes nothing", () => {
    const { purchase } = buyTeamLicence(learner.id, 2);
    db.insert(schema.enrollments)
      .values({ userId: learner.id, courseId: course.id })
      .run();
    const request = requestRefund(purchase.id);

    expectDecisionError(
      () =>
        approveRefundRequest(db, {
          refundId: request.id,
          supportUserId: support.id,
        }),
      "team-licence"
    );

    expect(getRefund(request.id)?.status).toBe(RefundStatus.Requested);
    expect(isEnrolled(learner.id)).toBe(true);
  });

  it("rejects an unknown Refund Request", () => {
    expectDecisionError(
      () => approveRefundRequest(db, { refundId: 999, supportUserId: support.id }),
      "not-found"
    );
  });
});

// ─── Decline ───

describe("declineRefundRequest", () => {
  it("Declines, records who and when, gives no money back and leaves access alone", () => {
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);
    const decidedAt = new Date(2026, 10, 6, 9, 0);

    declineRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
      now: decidedAt,
    });

    expect(getRefund(request.id)).toMatchObject({
      status: RefundStatus.Declined,
      amountRefunded: null,
      resolvedAt: decidedAt.toISOString(),
      resolvedByUserId: support.id,
    });
    expect(isEnrolled(learner.id)).toBe(true);
  });

  it("puts Support's note into the learner's email", () => {
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);

    const { email } = declineRefundRequest(db, {
      refundId: request.id,
      supportUserId: support.id,
      note: "You have finished most of the course.",
    });

    expect(email.to).toBe(learner.email);
    expect(email.body).toContain("You have finished most of the course.");
  });

  it("works on a team-licence Purchase", () => {
    const { purchase } = buyTeamLicence(learner.id, 2);
    const request = requestRefund(purchase.id);

    declineRefundRequest(db, { refundId: request.id, supportUserId: support.id });

    expect(getRefund(request.id)?.status).toBe(RefundStatus.Declined);
  });
});

// ─── Finality ───

describe("decisions are final", () => {
  it("cannot Decline an Approved Refund Request", () => {
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);
    approveRefundRequest(db, { refundId: request.id, supportUserId: support.id });
    const afterApprove = getRefund(request.id);

    expectDecisionError(
      () =>
        declineRefundRequest(db, {
          refundId: request.id,
          supportUserId: learner.id,
        }),
      "already-decided"
    );

    expect(getRefund(request.id)).toEqual(afterApprove);
  });

  it("cannot Approve a Declined Refund Request", () => {
    const purchase = buyCourse(learner.id);
    const request = requestRefund(purchase.id);
    declineRefundRequest(db, { refundId: request.id, supportUserId: support.id });
    const afterDecline = getRefund(request.id);

    expectDecisionError(
      () =>
        approveRefundRequest(db, {
          refundId: request.id,
          supportUserId: support.id,
        }),
      "already-decided"
    );

    expect(getRefund(request.id)).toEqual(afterDecline);
    expect(isEnrolled(learner.id)).toBe(true);
  });
});

// ─── Refund Eligibility ───

describe("checkRefundEligibility", () => {
  it("is eligible through the 14th calendar day after the Purchase day", () => {
    const purchase = buyCourse(learner.id, { at: NOV_1 });

    expect(checkRefundEligibility(db, purchase, NOV_15)).toMatchObject({
      eligible: true,
      problems: [],
    });
    expect(checkRefundEligibility(db, purchase, NOV_16).problems).toEqual([
      "outside-refund-window",
    ]);
  });

  it("is not eligible once half the lessons are completed", () => {
    const purchase = buyCourse(learner.id);
    completeLessons(learner.id, 1);
    expect(checkRefundEligibility(db, purchase, NOV_5).eligible).toBe(true);

    completeLessons(learner.id, 2);
    expect(checkRefundEligibility(db, purchase, NOV_5).problems).toEqual([
      "completed-too-much",
    ]);
  });

  it("is not eligible after two hours watched", () => {
    const purchase = buyCourse(learner.id);
    db.insert(schema.videoWatchEvents)
      .values([
        { userId: learner.id, lessonId: lessonIds[0], eventType: "progress", positionSeconds: 3600 },
        { userId: learner.id, lessonId: lessonIds[1], eventType: "progress", positionSeconds: 3600 },
      ])
      .run();

    expect(checkRefundEligibility(db, purchase, NOV_5).problems).toEqual([
      "watched-too-much",
    ]);
  });
});

// ─── The Support screen ───

describe("listRefundRequests", () => {
  it("lists Requested ones first, oldest first, then resolved ones", () => {
    const other = db
      .insert(schema.users)
      .values({ name: "Olu Other", email: "olu@example.com", role: UserRole.Student })
      .returning()
      .get();
    const resolved = requestRefund(buyCourse(other.id).id, new Date(2026, 10, 2));
    declineRefundRequest(db, { refundId: resolved.id, supportUserId: support.id });
    const newer = requestRefund(buyCourse(learner.id).id, new Date(2026, 10, 4));
    const older = requestRefund(buyCourse(other.id, { at: NOV_5 }).id, new Date(2026, 10, 3));

    const rows = listRefundRequests(db, NOV_5);

    expect(rows.map((row) => row.id)).toEqual([older.id, newer.id, resolved.id]);
    expect(rows[2]).toMatchObject({
      status: RefundStatus.Declined,
      resolvedByName: support.name,
    });
  });

  it("shows the learner, course, reason, amount paid, progress and days left in the Refund Window", () => {
    const purchase = buyCourse(learner.id, { amountPaid: 4900, at: NOV_1 });
    completeLessons(learner.id, 1);
    db.insert(schema.videoWatchEvents)
      .values({ userId: learner.id, lessonId: lessonIds[0], eventType: "progress", positionSeconds: 1800 })
      .run();
    requestRefund(purchase.id);

    const [row] = listRefundRequests(db, NOV_5);

    expect(row).toMatchObject({
      learnerName: learner.name,
      courseTitle: course.title,
      reason: "It was not what I expected.",
      amountPaid: 4900,
      requestedAt: NOV_5.toISOString(),
      progress: { completedLessons: 1, totalLessons: 4, secondsWatched: 1800 },
      daysLeftInWindow: 10,
      eligibilityProblems: [],
      isTeamLicence: false,
    });
    expect(listRefundRequests(db, NOV_16)[0].daysLeftInWindow).toBe(-1);
  });

  it("flags an ineligible Refund Request, which can still be Approved", () => {
    const purchase = buyCourse(learner.id);
    completeLessons(learner.id, 3);
    const request = requestRefund(purchase.id);

    expect(listRefundRequests(db, NOV_5)[0].eligibilityProblems).toEqual([
      "completed-too-much",
    ]);

    approveRefundRequest(db, { refundId: request.id, supportUserId: support.id });
    expect(getRefund(request.id)?.status).toBe(RefundStatus.Approved);
  });

  it("marks team-licence Purchases", () => {
    const { purchase } = buyTeamLicence(learner.id, 2);
    requestRefund(purchase.id);

    expect(listRefundRequests(db, NOV_5)[0].isTeamLicence).toBe(true);
  });
});
