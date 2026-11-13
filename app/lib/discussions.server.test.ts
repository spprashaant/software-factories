import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  askDiscussionQuestion,
  replyToDiscussionQuestion,
} from "./discussions.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

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

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

function ask(lesson = lessonId) {
  const result = askDiscussionQuestion(db, base.user.id, lesson, "A question");
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

describe("askDiscussionQuestion", () => {
  it("posts a top-level Discussion Question with the body trimmed", () => {
    const result = askDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      "  How do I start?  "
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.user.id,
        lessonId,
        parentId: null,
        body: "How do I start?",
      },
    });
  });

  it("refuses an empty or whitespace-only body and posts nothing", () => {
    const result = askDiscussionQuestion(db, base.user.id, lessonId, "   ");

    expect(result).toEqual({ ok: false, error: "Comment cannot be empty" });
  });

  it("refuses a body over 5000 characters", () => {
    const result = askDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      "a".repeat(5001)
    );

    expect(result).toEqual({
      ok: false,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("accepts a body of exactly 5000 characters", () => {
    const result = askDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      "a".repeat(5000)
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a lesson that doesn't exist", () => {
    const result = askDiscussionQuestion(db, base.user.id, 9999, "Hello");

    expect(result).toEqual({ ok: false, error: "Lesson not found" });
  });
});

describe("replyToDiscussionQuestion", () => {
  it("posts a Discussion Reply under the Discussion Question", () => {
    const question = ask();

    const result = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "  Start with lesson one.  "
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.instructor.id,
        lessonId,
        parentId: question.id,
        body: "Start with lesson one.",
      },
    });
  });

  it("refuses an empty body", () => {
    const question = ask();

    const result = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      ""
    );

    expect(result).toEqual({ ok: false, error: "Comment cannot be empty" });
  });

  it("refuses a reply to a reply, since replies are one level deep", () => {
    const question = ask();
    const reply = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "First reply"
    );
    if (!reply.ok) throw new Error(reply.error);

    const result = replyToDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      reply.comment.id,
      "Reply to the reply"
    );

    expect(result).toEqual({
      ok: false,
      error: "Replies can only be one level deep",
    });
  });

  it("refuses a parent on another lesson", () => {
    const question = ask(otherLessonId);

    const result = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Wrong lesson"
    );

    expect(result).toEqual({
      ok: false,
      error: "Parent comment belongs to a different lesson",
    });
  });

  it("refuses a parent that doesn't exist", () => {
    const result = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      9999,
      "Hello"
    );

    expect(result).toEqual({ ok: false, error: "Parent comment not found" });
  });
});
