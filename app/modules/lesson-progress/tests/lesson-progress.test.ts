import { describe, it, expect, beforeEach } from "vitest";
import { LessonProgressStatus } from "~/db/schema";
import * as schema from "~/db/schema";
import {
  calculateWatchProgress,
  getLastWatchPosition,
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
  recordWatchEvent,
} from "../index.server";
import { lessonWorld } from "./fixtures";

let world: ReturnType<typeof lessonWorld>;
let userId: number;
let lessonId: number;

beforeEach(() => {
  world = lessonWorld();
  userId = world.base.user.id;
  lessonId = world.lessonIds[0];
});

describe("marking a Lesson in progress", () => {
  it("has no progress before the Student opens the Lesson", () => {
    expect(getLessonProgress(world.db, { userId, lessonId })).toBeUndefined();
  });

  it("starts the Lesson the first time it is opened", () => {
    const row = markLessonInProgress(world.db, { userId, lessonId });

    expect(row.status).toBe(LessonProgressStatus.InProgress);
    expect(row.completedAt).toBeNull();
    expect(getLessonProgress(world.db, { userId, lessonId })).toEqual(row);
  });

  it("keeps a single row when the Lesson is opened again", () => {
    const first = markLessonInProgress(world.db, { userId, lessonId });
    const second = markLessonInProgress(world.db, { userId, lessonId });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe(LessonProgressStatus.InProgress);
    expect(world.db.select().from(schema.lessonProgress).all()).toHaveLength(1);
  });

  it("leaves a completed Lesson completed", () => {
    const completed = markLessonComplete(world.db, { userId, lessonId });

    const reopened = markLessonInProgress(world.db, { userId, lessonId });

    expect(reopened).toEqual(completed);
    expect(getLessonProgress(world.db, { userId, lessonId })?.status).toBe(
      LessonProgressStatus.Completed
    );
  });

  it("does not touch another Student's progress", () => {
    markLessonInProgress(world.db, { userId, lessonId });

    expect(
      getLessonProgress(world.db, { userId: world.otherStudentId, lessonId })
    ).toBeUndefined();
  });
});

describe("marking a Lesson complete", () => {
  it("completes a Lesson that was never opened", () => {
    const row = markLessonComplete(world.db, { userId, lessonId });

    expect(row.status).toBe(LessonProgressStatus.Completed);
    expect(row.completedAt).not.toBeNull();
  });

  it("completes a started Lesson in place", () => {
    const started = markLessonInProgress(world.db, { userId, lessonId });

    const completed = markLessonComplete(world.db, { userId, lessonId });

    expect(completed.id).toBe(started.id);
    expect(completed.status).toBe(LessonProgressStatus.Completed);
    expect(completed.completedAt).not.toBeNull();
  });
});

describe("progress across a course", () => {
  it("lists the Student's progress on that course's Lessons only", () => {
    markLessonComplete(world.db, { userId, lessonId: world.lessonIds[0] });
    markLessonInProgress(world.db, { userId, lessonId: world.lessonIds[1] });
    markLessonComplete(world.db, { userId, lessonId: world.otherLessonId });
    markLessonComplete(world.db, {
      userId: world.otherStudentId,
      lessonId: world.lessonIds[0],
    });

    const rows = getLessonProgressForCourse(world.db, {
      userId,
      courseId: world.base.course.id,
    });

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lessonId: world.lessonIds[0],
          status: LessonProgressStatus.Completed,
        }),
        expect.objectContaining({
          lessonId: world.lessonIds[1],
          status: LessonProgressStatus.InProgress,
        }),
      ])
    );
  });

  it("is empty for a course with no Modules", () => {
    const empty = world.db
      .insert(schema.courses)
      .values({ ...world.otherCourse, id: undefined, slug: "empty-course" })
      .returning()
      .get();

    expect(
      getLessonProgressForCourse(world.db, { userId, courseId: empty.id })
    ).toEqual([]);
  });

  it("is empty for a course whose Modules have no Lessons", () => {
    const bare = world.db
      .insert(schema.courses)
      .values({ ...world.otherCourse, id: undefined, slug: "bare-course" })
      .returning()
      .get();
    world.db
      .insert(schema.modules)
      .values({ courseId: bare.id, title: "Empty", position: 1 })
      .run();

    expect(
      getLessonProgressForCourse(world.db, { userId, courseId: bare.id })
    ).toEqual([]);
  });
});

describe("watching the video", () => {
  const at = (minute: number) => new Date(2026, 9, 6, 12, minute, 0);
  const watch = (positionSeconds: number, minute: number, who = userId) =>
    recordWatchEvent(world.db, {
      userId: who,
      lessonId,
      eventType: "progress",
      positionSeconds,
      at: at(minute),
    });

  it("records the event at the moment given", () => {
    const event = watch(42, 5);

    expect(event).toMatchObject({
      userId,
      lessonId,
      eventType: "progress",
      positionSeconds: 42,
      createdAt: at(5).toISOString(),
    });
  });

  it("resumes from the start when the Student has not watched", () => {
    expect(getLastWatchPosition(world.db, { userId, lessonId })).toBe(0);
  });

  it("resumes from the latest event, not the furthest", () => {
    watch(300, 1);
    watch(120, 2);

    expect(getLastWatchPosition(world.db, { userId, lessonId })).toBe(120);
  });

  it("ignores another Student's events when resuming", () => {
    watch(60, 1);
    watch(500, 2, world.otherStudentId);

    expect(getLastWatchPosition(world.db, { userId, lessonId })).toBe(60);
  });

  it("measures progress from the furthest position reached", () => {
    watch(300, 1);
    watch(120, 2);

    expect(
      calculateWatchProgress(world.db, {
        userId,
        lessonId,
        videoDurationSeconds: 600,
      })
    ).toBe(50);
  });

  it("rounds progress to a whole percentage", () => {
    watch(100, 1);

    expect(
      calculateWatchProgress(world.db, {
        userId,
        lessonId,
        videoDurationSeconds: 300,
      })
    ).toBe(33);
  });

  it("caps progress at 100", () => {
    watch(900, 1);

    expect(
      calculateWatchProgress(world.db, {
        userId,
        lessonId,
        videoDurationSeconds: 600,
      })
    ).toBe(100);
  });

  it("is 0 with no events, and ignores other Students", () => {
    watch(600, 1, world.otherStudentId);

    expect(
      calculateWatchProgress(world.db, {
        userId,
        lessonId,
        videoDurationSeconds: 600,
      })
    ).toBe(0);
  });

  it("is 0 for a video with no duration", () => {
    watch(60, 1);

    expect(
      calculateWatchProgress(world.db, {
        userId,
        lessonId,
        videoDurationSeconds: 0,
      })
    ).toBe(0);
  });
});
