import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { lookupFeedDetails } from "./feed-details.server";
import {
  approveRefundRequest,
  declineRefundRequest,
  raiseRefundRequest,
} from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function enroll(userId: number) {
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function postComment(body: string) {
  return db
    .insert(schema.comments)
    .values({ lessonId, userId: base.user.id, body })
    .returning()
    .get();
}

function lookupComment(userId: number, commentId: number) {
  return lookupFeedDetails(db, userId, null, {
    commentIds: [commentId],
    refundRequestIds: [],
  }).comments[commentId];
}

describe("lookupFeedDetails: Discussion comments", () => {
  it("returns the text of a comment on a course the user can see", () => {
    enroll(base.user.id);
    const comment = postComment("How do I start?");

    expect(lookupComment(base.user.id, comment.id)).toEqual({
      status: "text",
      text: "How do I start?",
    });
  });

  it("returns the current text after the author edits", () => {
    enroll(base.user.id);
    const comment = postComment("First draft");
    db.update(schema.comments)
      .set({ body: "Second draft", editedAt: new Date().toISOString() })
      .where(eq(schema.comments.id, comment.id))
      .run();

    expect(lookupComment(base.user.id, comment.id)).toEqual({
      status: "text",
      text: "Second draft",
    });
  });

  it("says removed for a soft-deleted comment", () => {
    enroll(base.user.id);
    const comment = postComment("Never mind");
    db.update(schema.comments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.comments.id, comment.id))
      .run();

    expect(lookupComment(base.user.id, comment.id)).toEqual({
      status: "removed",
    });
  });

  it("says unavailable when the user can't see the course", () => {
    const outsider = addStudent("Olive");
    const comment = postComment("How do I start?");

    expect(lookupComment(outsider.id, comment.id)).toEqual({
      status: "unavailable",
    });
  });

  it("says unavailable for a comment that doesn't exist", () => {
    expect(lookupComment(base.user.id, 999)).toEqual({ status: "unavailable" });
  });

  it("returns the text to the course's Instructor without an enrollment", () => {
    const comment = postComment("How do I start?");

    expect(lookupComment(base.instructor.id, comment.id)).toEqual({
      status: "text",
      text: "How do I start?",
    });
  });
});

describe("lookupFeedDetails: refund decision notes", () => {
  function platformAdmin() {
    return db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
  }

  /** A Team Licence bought by `buyer`, refunded with `note` decided on it. */
  function decidedTeamLicenceRefund(
    buyerId: number,
    decide: "approve" | "decline",
    note: string
  ) {
    const now = new Date();
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: buyerId,
        role: schema.TeamMemberRole.Admin,
      })
      .run();
    const purchase = db
      .insert(schema.purchases)
      .values({ userId: buyerId, courseId: base.course.id, amountPaid: 15800 })
      .returning()
      .get();
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}`,
        purchaseId: purchase.id,
      })
      .run();

    const raised = raiseRefundRequest(
      db,
      purchase.id,
      buyerId,
      "Wrong course for us",
      now
    );
    if (!raised.ok) throw new Error(raised.error);
    const admin = platformAdmin();
    const decided =
      decide === "approve"
        ? approveRefundRequest(db, raised.refundRequestId, admin.id, note, now)
        : declineRefundRequest(db, raised.refundRequestId, admin.id, note, now);
    if (!decided.ok) throw new Error(decided.error);
    return { team, refundRequestId: raised.refundRequestId };
  }

  function lookupNote(userId: number, refundRequestId: number) {
    return lookupFeedDetails(db, userId, null, {
      commentIds: [],
      refundRequestIds: [refundRequestId],
    }).decisionNotes[refundRequestId];
  }

  it("returns the decision note to the user who raised the Refund Request", () => {
    const buyer = addStudent("Bea");
    const { refundRequestId } = decidedTeamLicenceRefund(
      buyer.id,
      "decline",
      "Outside the fourteen days, sorry."
    );

    expect(lookupNote(buyer.id, refundRequestId)).toEqual({
      status: "note",
      text: "Outside the fourteen days, sorry.",
    });
  });

  it("returns an approval's note too", () => {
    const buyer = addStudent("Bea");
    const { refundRequestId } = decidedTeamLicenceRefund(
      buyer.id,
      "approve",
      "Refunded in full."
    );

    expect(lookupNote(buyer.id, refundRequestId)).toEqual({
      status: "note",
      text: "Refunded in full.",
    });
  });

  it("says unavailable to a later Team Admin of the same Team Licence", () => {
    const buyer = addStudent("Bea");
    const { team, refundRequestId } = decidedTeamLicenceRefund(
      buyer.id,
      "decline",
      "Outside the fourteen days, sorry."
    );
    const laterAdmin = addStudent("Lou");
    db.insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: laterAdmin.id,
        role: schema.TeamMemberRole.Admin,
      })
      .run();

    expect(lookupNote(laterAdmin.id, refundRequestId)).toEqual({
      status: "unavailable",
    });
  });

  it("says unavailable for a Refund Request that doesn't exist", () => {
    expect(lookupNote(base.user.id, 999)).toEqual({ status: "unavailable" });
  });
});
