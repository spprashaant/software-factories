import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, LessonProgressStatus, UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import {
  getInstructorAnalytics,
  type AnalyticsViewer,
} from "./instructor-analytics.server";

// Local noon, like the refund tests: refund days are local calendar days.
const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number, from: Date = NOW) {
  const when = new Date(from);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let userCount = 0;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  userCount = 0;
});

// ─── Fixtures ───

function makeUser(role: UserRole = UserRole.Student, name?: string) {
  userCount += 1;
  return db
    .insert(schema.users)
    .values({
      name: name ?? `User ${userCount}`,
      email: `user${userCount}@example.com`,
      role,
    })
    .returning()
    .get();
}

function makeCourse(
  instructorId: number,
  title: string,
  status: CourseStatus = CourseStatus.Published
) {
  return db
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replace(/\W+/g, "-"),
      description: title,
      salesCopy: markdown(title),
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function buy(
  userId: number,
  courseId: number,
  amountPaid: number,
  createdAt: string = daysBefore(1),
  country: string | null = null
) {
  return db
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, createdAt, country })
    .returning()
    .get();
}

function enrol(
  userId: number,
  courseId: number,
  enrolledAt: string = daysBefore(1)
) {
  db.insert(schema.enrollments).values({ userId, courseId, enrolledAt }).run();
}

let seatCount = 0;
function mintSeats(purchase: { id: number; courseId: number }, count: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  return Array.from({ length: count }, () => {
    seatCount += 1;
    return db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: purchase.courseId,
        code: `SEAT-${seatCount}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get();
  });
}

function redeem(couponId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId })
    .where(eq(schema.coupons.id, couponId))
    .run();
}

function makeModule(courseId: number, title: string, position: number) {
  return db
    .insert(schema.modules)
    .values({ courseId, title, position })
    .returning()
    .get();
}

function makeLesson(moduleId: number, title: string, position: number) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

function progress(
  userId: number,
  lessonId: number,
  status: LessonProgressStatus
) {
  db.insert(schema.lessonProgress).values({ userId, lessonId, status }).run();
}

function analytics(viewer: AnalyticsViewer, query = "", now: Date = NOW) {
  return getInstructorAnalytics(db, viewer, new URLSearchParams(query), now);
}

const asInstructor = (id: number): AnalyticsViewer => ({
  userId: id,
  isAdmin: false,
});
const asAdmin = (id: number): AnalyticsViewer => ({
  userId: id,
  isAdmin: true,
});

// ─── Who sees what ───

describe("access", () => {
  it("pins an instructor to their own figures whatever ?instructor says", () => {
    const other = makeUser(UserRole.Instructor);
    const otherCourse = makeCourse(other.id, "Other Course");
    buy(base.user.id, base.course.id, 1000);
    buy(base.user.id, otherCourse.id, 5000);

    const result = analytics(
      asInstructor(base.instructor.id),
      `instructor=${other.id}`
    );

    expect(result.instructorId).toBe(base.instructor.id);
    expect(result.summary.grossCents).toBe(1000);
    expect(result.courseOptions.map((c) => c.courseId)).toEqual([
      base.course.id,
    ]);
    expect(result.instructors).toEqual([]);
  });

  it("lets an admin look platform-wide, or at one named instructor", () => {
    const admin = makeUser(UserRole.Admin, "Ada Admin");
    const other = makeUser(UserRole.Instructor, "Ozzie Other");
    const otherCourse = makeCourse(other.id, "Other Course");
    buy(base.user.id, base.course.id, 1000);
    buy(base.user.id, otherCourse.id, 5000);

    const everyone = analytics(asAdmin(admin.id));
    expect(everyone.instructorId).toBeNull();
    expect(everyone.isAdmin).toBe(true);
    expect(everyone.summary.grossCents).toBe(6000);
    // Owners, sorted by name; the admin owns nothing so is not listed.
    expect(everyone.instructors).toEqual([
      { id: other.id, name: "Ozzie Other" },
      { id: base.instructor.id, name: "Test Instructor" },
    ]);

    const one = analytics(asAdmin(admin.id), `instructor=${other.id}`);
    expect(one.instructorId).toBe(other.id);
    expect(one.summary.grossCents).toBe(5000);
  });

  it("treats another instructor's course as no course selected", () => {
    const other = makeUser(UserRole.Instructor);
    const otherCourse = makeCourse(other.id, "Other Course");
    buy(base.user.id, otherCourse.id, 5000, daysBefore(1), "US");
    enrol(base.user.id, otherCourse.id);

    const result = analytics(
      asInstructor(base.instructor.id),
      `tab=course&course=${otherCourse.id}`
    );

    expect(result.selectedCourseId).toBeNull();
    expect(result.progress).toBeNull();
    expect(result.funnel).toBeNull();
    expect(result.quizzes).toBeNull();
    expect(result.countries).toBeNull();
  });

  it("selects a course the instructor does own", () => {
    const result = analytics(
      asInstructor(base.instructor.id),
      `course=${base.course.id}`
    );

    expect(result.selectedCourseId).toBe(base.course.id);
    expect(result.progress).not.toBeNull();
    expect(result.funnel).not.toBeNull();
    expect(result.quizzes).not.toBeNull();
    expect(result.countries).not.toBeNull();
  });
});

describe("hostile and junk params", () => {
  it.each(["abc", "1.5", "-1", "0", "", `${Number.MAX_SAFE_INTEGER}`])(
    "ignores course=%s",
    (course) => {
      const result = analytics(
        asInstructor(base.instructor.id),
        `course=${encodeURIComponent(course)}`
      );
      expect(result.selectedCourseId).toBeNull();
    }
  );

  it("falls back to platform-wide for an admin's junk instructor id", () => {
    const admin = makeUser(UserRole.Admin);
    expect(analytics(asAdmin(admin.id), "instructor=abc").instructorId).toBe(
      null
    );
    for (const junk of ["-3", "0", "1.5"]) {
      expect(
        analytics(asAdmin(admin.id), `instructor=${junk}`).instructorId
      ).toBeNull();
    }
  });

  it("falls back to the default range and the overview tab", () => {
    const result = analytics(
      asInstructor(base.instructor.id),
      "range=forever&tab=admin"
    );
    expect(result.range).toBe("30d");
    expect(result.tab).toBe("overview");
  });

  it("opens the course tab only when asked by name", () => {
    expect(analytics(asInstructor(base.instructor.id), "tab=course").tab).toBe(
      "course"
    );
    expect(analytics(asInstructor(base.instructor.id)).tab).toBe("overview");
  });
});

// ─── The clock seam ───

describe("range, measured from now", () => {
  it("counts only purchases inside the window ending at now", () => {
    buy(base.user.id, base.course.id, 1000, daysBefore(5));
    buy(base.user.id, base.course.id, 2000, daysBefore(40));
    buy(base.user.id, base.course.id, 4000, daysBefore(200));

    const viewer = asInstructor(base.instructor.id);
    expect(analytics(viewer, "range=7d").summary.grossCents).toBe(1000);
    expect(analytics(viewer, "range=30d").summary.grossCents).toBe(1000);
    expect(analytics(viewer, "range=90d").summary.grossCents).toBe(3000);
    expect(analytics(viewer, "range=all").summary.grossCents).toBe(7000);
  });

  it("uses the now it is given, not the wall clock", () => {
    buy(base.user.id, base.course.id, 1000, daysBefore(5));
    const viewer = asInstructor(base.instructor.id);

    // Sixty days later, the same purchase has left the 30-day window.
    const later = new Date(NOW);
    later.setDate(later.getDate() + 60);
    expect(analytics(viewer, "range=30d", later).summary.grossCents).toBe(0);
    expect(analytics(viewer, "range=30d", NOW).summary.grossCents).toBe(1000);
  });

  it("includes a purchase stamped exactly on the range start", () => {
    const start = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    buy(base.user.id, base.course.id, 1000, start);
    buy(
      base.user.id,
      base.course.id,
      2000,
      new Date(NOW.getTime() - 30 * 86_400_000 - 1).toISOString()
    );

    expect(
      analytics(asInstructor(base.instructor.id), "range=30d").summary
        .grossCents
    ).toBe(1000);
  });
});

// ─── Overview panels ───

describe("revenue summary and per-course revenue", () => {
  it("splits gross into the platform fee and net, and ranks courses", () => {
    const second = makeCourse(base.instructor.id, "Second Course");
    makeCourse(base.instructor.id, "Unsold Course");
    buy(base.user.id, base.course.id, 1000);
    buy(base.user.id, second.id, 3000);
    buy(base.user.id, second.id, 2000);

    const result = analytics(asInstructor(base.instructor.id));

    expect(result.summary).toEqual({
      grossCents: 6000,
      feeCents: 1200,
      netCents: 4800,
      purchaseCount: 3,
    });
    expect(result.courses).toEqual([
      {
        courseId: second.id,
        title: "Second Course",
        grossCents: 5000,
        feeCents: 1000,
        netCents: 4000,
        purchaseCount: 2,
      },
      {
        courseId: base.course.id,
        title: "Test Course",
        grossCents: 1000,
        feeCents: 200,
        netCents: 800,
        purchaseCount: 1,
      },
    ]);
  });

  it("is all zeros with no sales", () => {
    const result = analytics(asInstructor(base.instructor.id));
    expect(result.summary).toEqual({
      grossCents: 0,
      feeCents: 0,
      netCents: 0,
      purchaseCount: 0,
    });
    expect(result.courses).toEqual([]);
  });
});

describe("course options", () => {
  it("lists every owned course by title, sold or not", () => {
    const zeta = makeCourse(base.instructor.id, "Zeta", CourseStatus.Draft);
    const alpha = makeCourse(base.instructor.id, "Alpha");

    const result = analytics(asInstructor(base.instructor.id));

    expect(result.courseOptions).toEqual([
      { courseId: alpha.id, title: "Alpha" },
      { courseId: base.course.id, title: "Test Course" },
      { courseId: zeta.id, title: "Zeta" },
    ]);
  });
});

describe("audience and top buyers", () => {
  it("credits seat holders with their share of a team purchase", () => {
    const solo = makeUser(UserRole.Student, "Solo");
    const teamBuyer = makeUser(UserRole.Student, "Team Buyer");
    const holderA = makeUser(UserRole.Student, "Holder A");
    const holderB = makeUser(UserRole.Student, "Holder B");
    const lurker = makeUser(UserRole.Student, "Lurker");

    buy(solo.id, base.course.id, 10000);
    enrol(solo.id, base.course.id);

    const team = buy(teamBuyer.id, base.course.id, 9000);
    const seats = mintSeats(team, 3);
    redeem(seats[0].id, holderA.id);
    redeem(seats[1].id, holderB.id);
    enrol(holderA.id, base.course.id);
    enrol(holderB.id, base.course.id);
    // The buyer took a place too, but paid for seats, not for themselves.
    enrol(teamBuyer.id, base.course.id);

    buy(lurker.id, base.course.id, 2000);

    const result = analytics(asInstructor(base.instructor.id));

    expect(result.audience).toEqual({
      buyerCount: 3,
      studentCount: 4,
      // (10000 + 3000 + 3000 + 0) / 4
      revenuePerStudentCents: 4000,
    });

    expect(result.buyers).toEqual([
      {
        userId: solo.id,
        name: "Solo",
        email: solo.email,
        spendCents: 10000,
        purchaseCount: 1,
        seatsBought: 0,
        seatsUnredeemed: 0,
        enrolled: true,
      },
      {
        userId: teamBuyer.id,
        name: "Team Buyer",
        email: teamBuyer.email,
        spendCents: 9000,
        purchaseCount: 1,
        seatsBought: 3,
        seatsUnredeemed: 1,
        enrolled: true,
      },
      {
        userId: lurker.id,
        name: "Lurker",
        email: lurker.email,
        spendCents: 2000,
        purchaseCount: 1,
        seatsBought: 0,
        seatsUnredeemed: 0,
        enrolled: false,
      },
    ]);
  });

  it("rounds a seat holder's share once, after summing", () => {
    const teamBuyer = makeUser();
    const holder = makeUser();
    // Two 3-seat purchases of 1000: each share is 333.33…, summed 666.67.
    for (let i = 0; i < 2; i++) {
      const team = buy(teamBuyer.id, base.course.id, 1000);
      redeem(mintSeats(team, 3)[0].id, holder.id);
    }
    enrol(holder.id, base.course.id);

    const result = analytics(asInstructor(base.instructor.id));
    expect(result.audience.revenuePerStudentCents).toBe(667);
  });

  it("has no revenue per student when nobody is enrolled", () => {
    // Two purchases, one buyer.
    buy(base.user.id, base.course.id, 1000);
    buy(base.user.id, makeCourse(base.instructor.id, "Second").id, 1000);
    const result = analytics(asInstructor(base.instructor.id));
    expect(result.audience).toEqual({
      buyerCount: 1,
      studentCount: 0,
      revenuePerStudentCents: null,
    });
  });

  it("does not count students or spend from another instructor's course", () => {
    const other = makeUser(UserRole.Instructor);
    const otherCourse = makeCourse(other.id, "Other Course");
    buy(base.user.id, otherCourse.id, 5000);
    enrol(base.user.id, otherCourse.id);
    buy(base.user.id, base.course.id, 1000);
    enrol(base.user.id, base.course.id);

    // A seat on the other course, held by one of this instructor's students.
    const otherTeam = buy(makeUser().id, otherCourse.id, 6000);
    redeem(mintSeats(otherTeam, 2)[0].id, base.user.id);

    // Someone who is only the other instructor's student.
    const theirs = makeUser();
    enrol(theirs.id, otherCourse.id);

    const result = analytics(asInstructor(base.instructor.id));
    expect(result.audience.studentCount).toBe(1);
    expect(result.audience.revenuePerStudentCents).toBe(1000);
    expect(result.buyers[0].spendCents).toBe(1000);
  });

  it("says never enrolled for a buyer enrolled only elsewhere", () => {
    const otherCourse = makeCourse(makeUser(UserRole.Instructor).id, "Other");
    buy(base.user.id, base.course.id, 1000);
    enrol(base.user.id, otherCourse.id);

    const result = analytics(asInstructor(base.instructor.id));
    expect(result.buyers[0].enrolled).toBe(false);
  });

  it("says enrolled for a buyer who enrolled before the range", () => {
    buy(base.user.id, base.course.id, 1000, daysBefore(1));
    enrol(base.user.id, base.course.id, daysBefore(200));

    const result = analytics(asInstructor(base.instructor.id), "range=30d");
    expect(result.buyers[0].enrolled).toBe(true);
    // …but they are not a student of this range.
    expect(result.audience.studentCount).toBe(0);
  });

  it("lists at most ten buyers, biggest spender first", () => {
    const buyers = Array.from({ length: 12 }, (_, i) => {
      const user = makeUser();
      buy(user.id, base.course.id, 100 * (i + 1));
      return user;
    });

    const result = analytics(asInstructor(base.instructor.id));
    expect(result.buyers).toHaveLength(10);
    expect(result.buyers[0].userId).toBe(buyers[11].id);
    expect(result.buyers[9].userId).toBe(buyers[2].id);
  });
});

describe("unanswered questions", () => {
  function question(
    userId: number,
    lessonId: number,
    createdAt: string,
    extra: Partial<typeof schema.comments.$inferInsert> = {}
  ) {
    return db
      .insert(schema.comments)
      .values({
        userId,
        lessonId,
        body: markdown("?"),
        createdAt,
        ...extra,
      })
      .returning()
      .get();
  }

  it("counts questions with no live staff reply, split by the range", () => {
    const admin = makeUser(UserRole.Admin);
    const student = base.user;
    const peer = makeUser();
    const lesson = makeLesson(makeModule(base.course.id, "M", 1).id, "L", 1);
    const recent = daysBefore(2);

    // Counted.
    question(student.id, lesson.id, recent);
    // Exactly on the range start is inside it.
    question(
      student.id,
      lesson.id,
      new Date(NOW.getTime() - 30 * 86_400_000).toISOString()
    );
    question(student.id, lesson.id, daysBefore(60)); // older
    const peerAnswered = question(student.id, lesson.id, recent);
    question(peer.id, lesson.id, recent, { parentId: peerAnswered.id });
    const replyDeleted = question(student.id, lesson.id, recent);
    question(base.instructor.id, lesson.id, recent, {
      parentId: replyDeleted.id,
      deletedAt: recent,
    });

    // Not counted.
    const instructorAnswered = question(student.id, lesson.id, recent);
    question(base.instructor.id, lesson.id, recent, {
      parentId: instructorAnswered.id,
    });
    const adminAnswered = question(student.id, lesson.id, recent);
    question(admin.id, lesson.id, recent, { parentId: adminAnswered.id });
    question(student.id, lesson.id, recent, { deletedAt: recent });
    question(base.instructor.id, lesson.id, recent);
    question(admin.id, lesson.id, recent);

    const result = analytics(asInstructor(base.instructor.id), "range=30d");
    expect(result.questions).toEqual({ inRange: 4, older: 1 });

    const allTime = analytics(asInstructor(base.instructor.id), "range=all");
    expect(allTime.questions).toEqual({ inRange: 5, older: 0 });
  });

  it("ignores another instructor's questions", () => {
    const other = makeUser(UserRole.Instructor);
    const otherCourse = makeCourse(other.id, "Other Course");
    const lesson = makeLesson(makeModule(otherCourse.id, "M", 1).id, "L", 1);
    question(base.user.id, lesson.id, daysBefore(1));

    const result = analytics(asInstructor(base.instructor.id));
    expect(result.questions).toEqual({ inRange: 0, older: 0 });
  });

  it("is zero with no questions at all", () => {
    expect(analytics(asInstructor(base.instructor.id)).questions).toEqual({
      inRange: 0,
      older: 0,
    });
  });
});

describe("ratings", () => {
  function rate(rating: number, createdAt: string, courseId = base.course.id) {
    db.insert(schema.courseRatings)
      .values({ userId: makeUser().id, courseId, rating, createdAt })
      .run();
  }

  it("averages in-range ratings to one decimal place", () => {
    rate(5, daysBefore(1));
    rate(4, daysBefore(2));
    rate(4, daysBefore(3));
    rate(1, daysBefore(60));
    const other = makeCourse(makeUser(UserRole.Instructor).id, "Other");
    rate(1, daysBefore(1), other.id);

    const result = analytics(asInstructor(base.instructor.id), "range=30d");
    expect(result.ratings).toEqual({ average: 4.3, count: 3 });
  });

  it("has no average without ratings", () => {
    expect(analytics(asInstructor(base.instructor.id)).ratings).toEqual({
      average: null,
      count: 0,
    });
  });
});

describe("unpublished", () => {
  it("is true for an instructor with no published course", () => {
    const fresh = makeUser(UserRole.Instructor);
    makeCourse(fresh.id, "Draft", CourseStatus.Draft);
    makeCourse(fresh.id, "Old", CourseStatus.Archived);
    expect(analytics(asInstructor(fresh.id)).unpublished).toBe(true);
  });

  it("is false once one course is published, and platform-wide", () => {
    const admin = makeUser(UserRole.Admin);
    expect(analytics(asInstructor(base.instructor.id)).unpublished).toBe(false);
    expect(analytics(asAdmin(admin.id)).unpublished).toBe(false);
  });
});

describe("revenue over time", () => {
  function utcDay(iso: string) {
    return iso.slice(0, 10);
  }

  it("spans a fixed range day by day up to now, zeros included", () => {
    buy(base.user.id, base.course.id, 5000, daysBefore(2));
    buy(base.user.id, base.course.id, 1000, daysBefore(2));

    const { series } = analytics(asInstructor(base.instructor.id), "range=7d");

    expect(series.granularity).toBe("day");
    expect(series.points).toHaveLength(8);
    expect(series.points[0].bucket).toBe(
      utcDay(new Date(NOW.getTime() - 7 * 86_400_000).toISOString())
    );
    expect(series.points.at(-1)?.bucket).toBe(utcDay(NOW.toISOString()));

    const saleDay = series.points.find(
      (point) => point.bucket === utcDay(daysBefore(2))
    );
    expect(saleDay).toEqual({
      bucket: utcDay(daysBefore(2)),
      grossCents: 6000,
      netCents: 4800,
    });
    const total = series.points.reduce((sum, p) => sum + p.grossCents, 0);
    expect(total).toBe(6000);
  });

  it("spans a fixed range even with no sales", () => {
    const { series } = analytics(asInstructor(base.instructor.id), "range=7d");
    expect(series.points).toHaveLength(8);

    // Every fixed range is daily; only all time is monthly.
    const ninety = analytics(asInstructor(base.instructor.id), "range=90d");
    expect(ninety.series.granularity).toBe("day");
    expect(ninety.series.points).toHaveLength(91);
    expect(series.points.every((p) => p.grossCents === 0)).toBe(true);
  });

  it("goes month by month from the first sale for all time", () => {
    buy(base.user.id, base.course.id, 3000, "2026-07-15T12:00:00.000Z");
    buy(base.user.id, base.course.id, 1000, "2026-09-15T12:00:00.000Z");

    const { series } = analytics(asInstructor(base.instructor.id), "range=all");

    expect(series.granularity).toBe("month");
    expect(series.points).toEqual([
      { bucket: "2026-07", grossCents: 3000, netCents: 2400 },
      { bucket: "2026-08", grossCents: 0, netCents: 0 },
      { bucket: "2026-09", grossCents: 1000, netCents: 800 },
      { bucket: "2026-10", grossCents: 0, netCents: 0 },
    ]);
  });

  it("is empty for all time with no sales", () => {
    const { series } = analytics(asInstructor(base.instructor.id), "range=all");
    expect(series).toEqual({ granularity: "month", points: [] });
  });
});

describe("refund exposure", () => {
  function at(daysAgo: number, hour: number, minute = 0) {
    const when = new Date(NOW);
    when.setDate(when.getDate() - daysAgo);
    when.setHours(hour, minute, 0, 0);
    return when.toISOString();
  }

  it("counts purchases still inside their fourteen calendar days", () => {
    const second = makeCourse(base.instructor.id, "Second Course");

    buy(base.user.id, base.course.id, 2000, at(14, 23, 30)); // last day
    // Also the last day, though fourteen 24-hour days ran out at 9:00 and
    // now is noon: the window is calendar days, not hours.
    buy(base.user.id, base.course.id, 500, at(14, 9));
    buy(base.user.id, base.course.id, 4000, at(15, 0, 1)); // closed
    buy(base.user.id, second.id, 5000, at(3, 9)); // 11 days left
    // Newest last, so the course's headline can't come from row order.
    buy(base.user.id, base.course.id, 1000, at(0, 9)); // 14 days left

    const result = analytics(asInstructor(base.instructor.id), "range=30d");

    expect(result.refundExposure).toEqual({
      grossCents: 8500,
      netCents: 6800,
      purchaseCount: 4,
      // 8500 of 12500 gross.
      sharePercent: 68,
      closingTodayCount: 2,
      courses: [
        {
          courseId: second.id,
          title: "Second Course",
          grossCents: 5000,
          purchaseCount: 1,
          daysLeft: 11,
        },
        {
          courseId: base.course.id,
          title: "Test Course",
          grossCents: 3500,
          purchaseCount: 3,
          // The most urgent purchase, not the newest.
          daysLeft: 0,
        },
      ],
    });
  });

  it("measures today from now", () => {
    buy(base.user.id, base.course.id, 1000, at(0, 9));
    const later = new Date(NOW);
    later.setDate(later.getDate() + 15);

    const result = analytics(
      asInstructor(base.instructor.id),
      "range=all",
      later
    );
    expect(result.refundExposure.purchaseCount).toBe(0);
  });

  it("is empty with no sales", () => {
    expect(analytics(asInstructor(base.instructor.id)).refundExposure).toEqual({
      grossCents: 0,
      netCents: 0,
      purchaseCount: 0,
      sharePercent: 0,
      closingTodayCount: 0,
      courses: [],
    });
  });
});

// ─── Course tab ───

describe("course panels", () => {
  let lessons: { id: number }[];
  let students: { id: number }[];
  let outsider: { id: number };

  // M1 = [L1, L2], M2 = [L3]. Lessons are inserted out of order so the
  // curriculum order has to come from position, not from id.
  beforeEach(() => {
    const m2 = makeModule(base.course.id, "Module Two", 2);
    const m1 = makeModule(base.course.id, "Module One", 1);
    const l3 = makeLesson(m2.id, "Lesson Three", 1);
    const l2 = makeLesson(m1.id, "Lesson Two", 2);
    const l1 = makeLesson(m1.id, "Lesson One", 1);
    lessons = [l1, l2, l3];

    students = Array.from({ length: 5 }, () => {
      const student = makeUser();
      enrol(student.id, base.course.id, daysBefore(100));
      return student;
    });
    outsider = makeUser();

    const [e1, e2, , e4, e5] = students;
    for (const lesson of lessons) {
      progress(e1.id, lesson.id, LessonProgressStatus.Completed);
    }
    progress(e2.id, l1.id, LessonProgressStatus.Completed);
    progress(e4.id, l1.id, LessonProgressStatus.InProgress);
    progress(e5.id, l1.id, LessonProgressStatus.NotStarted);
    progress(e5.id, l2.id, LessonProgressStatus.NotStarted);
    // Working through a course they never enrolled in.
    progress(outsider.id, l3.id, LessonProgressStatus.Completed);

    // Progress elsewhere does not count here.
    const elsewhere = makeCourse(base.instructor.id, "Elsewhere");
    // Enrolled, just not in this course.
    enrol(outsider.id, elsewhere.id);
    const lx = makeLesson(makeModule(elsewhere.id, "X", 1).id, "LX", 1);
    progress(e2.id, lx.id, LessonProgressStatus.Completed);
  });

  function courseTab(query = "") {
    return analytics(
      asInstructor(base.instructor.id),
      `tab=course&course=${base.course.id}${query}`
    );
  }

  it("summarises progress across every enrollee, starters or not", () => {
    expect(courseTab().progress).toEqual({
      enrolledCount: 5,
      totalLessons: 3,
      // (100 + 33.3 + 0 + 0 + 0) / 5
      averageProgressPercent: 27,
      finishedCount: 1,
    });
  });

  it("has no average for a course with no lessons", () => {
    const empty = makeCourse(base.instructor.id, "Empty");
    enrol(base.user.id, empty.id);
    const result = analytics(
      asInstructor(base.instructor.id),
      `course=${empty.id}`
    );
    expect(result.progress).toEqual({
      enrolledCount: 1,
      totalLessons: 0,
      averageProgressPercent: null,
      finishedCount: 0,
    });
    expect(result.funnel).toEqual({ enrolledCount: 1, modules: [] });
  });

  it("builds the drop-off funnel in curriculum order", () => {
    const [l1, l2, l3] = lessons;
    expect(courseTab().funnel).toEqual({
      enrolledCount: 5,
      modules: [
        {
          moduleId: expect.any(Number),
          title: "Module One",
          reachedCount: 3,
          dropWithin: 2,
          lessons: [
            {
              lessonId: l1.id,
              title: "Lesson One",
              reachedCount: 3,
              dropFromPrevious: 2,
            },
            {
              lessonId: l2.id,
              title: "Lesson Two",
              reachedCount: 1,
              dropFromPrevious: 2,
            },
          ],
        },
        {
          moduleId: expect.any(Number),
          title: "Module Two",
          reachedCount: 1,
          dropWithin: 0,
          lessons: [
            {
              lessonId: l3.id,
              title: "Lesson Three",
              reachedCount: 1,
              dropFromPrevious: 0,
            },
          ],
        },
      ],
    });
  });

  describe("quiz pass rates", () => {
    beforeEach(() => {
      const [l1, , l3] = lessons;
      const q1 = db
        .insert(schema.quizzes)
        .values({ lessonId: l1.id, title: "Quiz One", passingScore: 0.7 })
        .returning()
        .get();
      db.insert(schema.quizzes)
        .values({ lessonId: l3.id, title: "Quiz Three", passingScore: 0.8 })
        .run();

      const [e1, e2, , e4, e5] = students;
      const attempt = (
        userId: number,
        score: number,
        passed: boolean,
        attemptedAt = daysBefore(1)
      ) =>
        db
          .insert(schema.quizAttempts)
          .values({ userId, quizId: q1.id, score, passed, attemptedAt })
          .run();

      attempt(e1.id, 0.5, false);
      attempt(e1.id, 0.9, true);
      attempt(e2.id, 0.6, false);
      attempt(e4.id, 0.95, true, daysBefore(60));
      attempt(e4.id, 0.4, false);
      // Passed when the bar was lower, then beat that score after it was
      // raised and was marked a fail. The best attempt's verdict stands.
      attempt(e5.id, 0.72, true);
      attempt(e5.id, 0.75, false);
    });

    it("rates each quiz on every student's best in-range attempt", () => {
      expect(courseTab("&range=30d").quizzes).toEqual([
        {
          quizId: expect.any(Number),
          title: "Quiz One",
          moduleTitle: "Module One",
          lessonTitle: "Lesson One",
          passingScorePercent: 70,
          studentCount: 4,
          passedCount: 1,
          passRatePercent: 25,
          averageBestScorePercent: 66,
        },
        {
          quizId: expect.any(Number),
          title: "Quiz Three",
          moduleTitle: "Module Two",
          lessonTitle: "Lesson Three",
          passingScorePercent: 80,
          studentCount: 0,
          passedCount: 0,
          passRatePercent: null,
          averageBestScorePercent: null,
        },
      ]);
    });

    it("picks up older attempts for all time", () => {
      const [quiz] = courseTab("&range=all").quizzes ?? [];
      expect(quiz).toMatchObject({
        studentCount: 4,
        passedCount: 2,
        passRatePercent: 50,
        averageBestScorePercent: 80,
      });
    });
  });

  it("is an empty quiz list for a course with no quizzes", () => {
    expect(courseTab().quizzes).toEqual([]);
  });

  it("breaks revenue down by country, with what parity discounts cost", () => {
    const buyer = base.user.id;
    buy(buyer, base.course.id, 10000, daysBefore(1), "US");
    buy(buyer, base.course.id, 10000, daysBefore(2), "US");
    buy(buyer, base.course.id, 5000, daysBefore(3), "IN");
    buy(buyer, base.course.id, 3000, daysBefore(4), null);
    buy(buyer, base.course.id, 9999, daysBefore(60), "IN");
    const other = makeCourse(base.instructor.id, "Other");
    buy(buyer, other.id, 7777, daysBefore(1), "IN");

    expect(courseTab("&range=30d").countries).toEqual({
      grossCents: 28000,
      netCents: 22400,
      purchaseCount: 4,
      discountedGrossCents: 5000,
      discountedNetCents: 4000,
      discountedSharePercent: 18,
      rows: [
        {
          country: "US",
          grossCents: 20000,
          purchaseCount: 2,
          netCents: 16000,
          sharePercent: 71,
          averagePaidCents: 10000,
          discountPercent: 0,
        },
        {
          country: "IN",
          grossCents: 5000,
          purchaseCount: 1,
          netCents: 4000,
          sharePercent: 18,
          averagePaidCents: 5000,
          discountPercent: 50,
        },
        {
          country: null,
          grossCents: 3000,
          purchaseCount: 1,
          netCents: 2400,
          sharePercent: 11,
          averagePaidCents: 3000,
          discountPercent: null,
        },
      ],
    });
  });

  it("is an empty country breakdown with no sales", () => {
    expect(courseTab().countries).toEqual({
      grossCents: 0,
      netCents: 0,
      purchaseCount: 0,
      discountedGrossCents: 0,
      discountedNetCents: 0,
      discountedSharePercent: 0,
      rows: [],
    });
  });
});
