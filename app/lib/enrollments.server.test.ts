import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, refusalOf, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, UserRole } from "~/db/schema";
import { claimSeat, makeIndividualPurchase } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  teamAdmin = db
    .insert(schema.users)
    .values({
      name: "Tess Admin",
      email: "tess@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
});

function buyTeamLicence(seatCount = 2, country: string | null = "GB") {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 7900 * seatCount,
      country,
    })
    .returning()
    .get();

  const team = db.insert(schema.teams).values({}).returning().get();

  const seats = Array.from({ length: seatCount }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );

  return { purchase, seats };
}

describe("claimSeat", () => {
  it("gives the Student an Enrollment when the Seat is available", () => {
    const { seats } = buyTeamLicence();

    const result = claimSeat(db, seats[0].code, base.user.id, "GB");

    expect(result).toMatchObject({
      enrollment: { userId: base.user.id, courseId: base.course.id },
    });
  });

  it("tells the Team Admin about the Seat claim and the Instructor about the Enrollment", () => {
    const { seats } = buyTeamLicence();

    const result = claimSeat(db, seats[0].code, base.user.id, "GB");

    expect(result.notifications).toEqual([
      {
        kind: "seat-claimed",
        recipients: [{ id: teamAdmin.id, name: "Tess Admin" }],
        actor: { id: base.user.id, name: "Test User" },
        data: {
          seatId: seats[0].id,
          courseId: base.course.id,
          courseTitle: "Test Course",
        },
        idempotencyKey: `seat-claimed:${seats[0].id}`,
        arrivesRead: false,
      },
      {
        kind: "enrollment",
        recipients: [{ id: base.instructor.id, name: "Test Instructor" }],
        actor: { id: base.user.id, name: "Test User" },
        data: {
          enrollmentId: result.enrollment.id,
          courseId: base.course.id,
          courseTitle: "Test Course",
        },
        idempotencyKey: `enrollment:${result.enrollment.id}`,
        arrivesRead: false,
      },
    ]);
  });

  it("doesn't tell a Team Admin about a Seat they claimed themselves", () => {
    const { seats } = buyTeamLicence();

    const result = claimSeat(db, seats[0].code, teamAdmin.id, "GB");

    expect(result.notifications.map((n) => n.kind)).toEqual(["enrollment"]);
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", () => {
    const { purchase, seats } = buyTeamLicence();
    db.insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        status: RefundStatus.Open,
        reason: "Team shrank",
        requestedAt: new Date().toISOString(),
      })
      .run();

    const result = refusalOf(() =>
      claimSeat(db, seats[0].code, base.user.id, "GB")
    );

    expect(result).toEqual({
      status: 409,
      message:
        "This seat can't be claimed right now. Ask the person who shared it with you.",
    });
  });

  it("refuses a Seat that was refunded", () => {
    const { seats } = buyTeamLicence();
    db.update(schema.coupons)
      .set({ refundedAt: new Date().toISOString() })
      .run();

    const result = refusalOf(() =>
      claimSeat(db, seats[0].code, base.user.id, "GB")
    );

    expect(result).toEqual({
      status: 409,
      message:
        "This seat is no longer available. Ask the person who shared it with you.",
    });
  });

  it("refuses a Seat someone has already claimed", () => {
    const { seats } = buyTeamLicence();
    claimSeat(db, seats[0].code, teamAdmin.id, "GB");

    const result = refusalOf(() =>
      claimSeat(db, seats[0].code, base.user.id, "GB")
    );

    expect(result).toEqual({
      status: 409,
      message: "Coupon has already been redeemed",
    });
  });

  it("refuses a second Seat for a Student who is already enrolled", () => {
    const { seats } = buyTeamLicence();
    claimSeat(db, seats[0].code, base.user.id, "GB");

    const result = refusalOf(() =>
      claimSeat(db, seats[1].code, base.user.id, "GB")
    );

    expect(result).toEqual({
      status: 409,
      message: "You are already enrolled in this course",
    });
  });

  it("refuses a claim from a different country to the buyer's", () => {
    const { seats } = buyTeamLicence(1, "GB");

    const result = refusalOf(() =>
      claimSeat(db, seats[0].code, base.user.id, "IN")
    );

    expect(result).toEqual({
      status: 403,
      message:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
  });

  it("refuses a code that matches no Seat", () => {
    const result = refusalOf(() => claimSeat(db, "NOPE", base.user.id, "GB"));

    expect(result).toEqual({ status: 404, message: "Coupon not found" });
  });
});

describe("makeIndividualPurchase", () => {
  it("records the Purchase and gives the buyer an Enrollment", () => {
    const result = makeIndividualPurchase(
      db,
      base.user.id,
      base.course.id,
      4900,
      "IN"
    );

    expect(result).toMatchObject({
      purchase: {
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4900,
        country: "IN",
      },
      enrollment: { userId: base.user.id, courseId: base.course.id },
    });
  });

  it("tells the course's Instructor about the Enrollment", () => {
    const result = makeIndividualPurchase(
      db,
      base.user.id,
      base.course.id,
      4900,
      "IN"
    );

    expect(result.notifications).toEqual([
      {
        kind: "enrollment",
        recipients: [{ id: base.instructor.id, name: "Test Instructor" }],
        actor: { id: base.user.id, name: "Test User" },
        data: {
          enrollmentId: result.enrollment.id,
          courseId: base.course.id,
          courseTitle: "Test Course",
        },
        idempotencyKey: `enrollment:${result.enrollment.id}`,
        arrivesRead: false,
      },
    ]);
  });

  it("doesn't tell an Instructor about enrolling on their own course", () => {
    const result = makeIndividualPurchase(
      db,
      base.instructor.id,
      base.course.id,
      4900,
      "IN"
    );

    expect(result.notifications).toEqual([]);
  });

  it("refuses a buyer who is already enrolled, e.g. through a Claimed Seat", () => {
    const { seats } = buyTeamLicence();
    claimSeat(db, seats[0].code, base.user.id, "GB");

    const result = refusalOf(() =>
      makeIndividualPurchase(db, base.user.id, base.course.id, 7900, "GB")
    );

    expect(result).toEqual({
      status: 409,
      message: "You are already enrolled in this course",
    });
  });
});
