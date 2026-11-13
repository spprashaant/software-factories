import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, refusalOf, seedBaseData } from "~/test/setup";
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
      comment: {
        userId: base.user.id,
        lessonId,
        parentId: null,
        body: "How do I start?",
      },
    });
  });

  it("refuses an empty or whitespace-only body and posts nothing", () => {
    const result = refusalOf(() =>
      askDiscussionQuestion(db, base.user.id, lessonId, "   ")
    );

    expect(result).toEqual({ status: 400, message: "Comment cannot be empty" });
  });

  it("refuses a body over 5000 characters", () => {
    const result = refusalOf(() =>
      askDiscussionQuestion(db, base.user.id, lessonId, "a".repeat(5001))
    );

    expect(result).toEqual({
      status: 400,
      message: "Comment must be 5000 characters or fewer",
    });
  });

  it("accepts a body of exactly 5000 characters", () => {
    const result = askDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      "a".repeat(5000)
    );

    expect(result.comment.body).toHaveLength(5000);
  });

  it("refuses a lesson that doesn't exist", () => {
    const result = refusalOf(() =>
      askDiscussionQuestion(db, base.user.id, 9999, "Hello")
    );

    expect(result).toEqual({ status: 404, message: "Lesson not found" });
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

    const result = refusalOf(() =>
      replyToDiscussionQuestion(
        db,
        base.instructor.id,
        lessonId,
        question.id,
        ""
      )
    );

    expect(result).toEqual({ status: 400, message: "Comment cannot be empty" });
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

    const result = refusalOf(() =>
      replyToDiscussionQuestion(
        db,
        base.user.id,
        lessonId,
        reply.comment.id,
        "Reply to the reply"
      )
    );

    expect(result).toEqual({
      status: 400,
      message: "Replies can only be one level deep",
    });
  });

  it("refuses a parent on another lesson", () => {
    const question = ask(otherLessonId);

    const result = refusalOf(() =>
      replyToDiscussionQuestion(
        db,
        base.instructor.id,
        lessonId,
        question.id,
        "Wrong lesson"
      )
    );

    expect(result).toEqual({
      status: 400,
      message: "Parent comment belongs to a different lesson",
    });
  });

  it("refuses a parent that doesn't exist", () => {
    const result = refusalOf(() =>
      replyToDiscussionQuestion(db, base.instructor.id, lessonId, 9999, "Hello")
    );

    expect(result).toEqual({
      status: 404,
      message: "Parent comment not found",
    });
  });
});

describe("Discussion Notifications", () => {
  it("tells the course's Instructor when someone asks a Discussion Question", () => {
    const result = askDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      "Secret question text"
    );

    expect(result.notifications).toEqual([
      {
        kind: "discussion-question",
        recipients: [{ id: base.instructor.id, name: "Test Instructor" }],
        actor: { id: base.user.id, name: "Test User" },
        data: {
          commentId: result.comment.id,
          lessonId,
          lessonTitle: "Lesson 1",
          courseId: base.course.id,
          courseSlug: "test-course",
          courseTitle: "Test Course",
        },
        idempotencyKey: `discussion-question:${result.comment.id}`,
        arrivesRead: false,
      },
    ]);
  });

  it("tells nobody when the Instructor asks on their own course", () => {
    const result = askDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      "Note to self"
    );

    expect(result.notifications).toEqual([]);
  });

  it("tells the Discussion Question's author when someone else replies", () => {
    const other = db
      .insert(schema.users)
      .values({
        name: "Other Student",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    const question = ask();

    const result = replyToDiscussionQuestion(
      db,
      other.id,
      lessonId,
      question.id,
      "Secret reply text"
    );

    expect(result.notifications).toEqual([
      {
        kind: "discussion-reply",
        recipients: [{ id: base.user.id, name: "Test User" }],
        actor: { id: other.id, name: "Other Student" },
        data: {
          commentId: result.comment.id,
          lessonId,
          lessonTitle: "Lesson 1",
          courseId: base.course.id,
          courseSlug: "test-course",
          courseTitle: "Test Course",
        },
        idempotencyKey: `discussion-reply:${result.comment.id}`,
        arrivesRead: false,
      },
    ]);
  });

  it("tells the author when the Instructor replies (as from /instructor/questions)", () => {
    const question = ask();

    const result = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Instructor answer"
    );

    expect(result.notifications).toMatchObject([
      {
        kind: "discussion-reply",
        recipients: [{ id: base.user.id, name: "Test User" }],
        actor: { id: base.instructor.id, name: "Test Instructor" },
      },
    ]);
  });

  it("tells nobody when the author replies to their own Discussion Question", () => {
    const question = ask();

    const result = replyToDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      question.id,
      "Answering myself"
    );

    expect(result.notifications).toEqual([]);
  });

  it("never puts comment text in a payload", () => {
    const asked = askDiscussionQuestion(
      db,
      base.user.id,
      lessonId,
      "SECRET-QUESTION"
    );
    const replied = replyToDiscussionQuestion(
      db,
      base.instructor.id,
      lessonId,
      asked.comment.id,
      "SECRET-REPLY"
    );

    const payloads = JSON.stringify([
      ...asked.notifications,
      ...replied.notifications,
    ]);
    expect(asked.notifications).toHaveLength(1);
    expect(replied.notifications).toHaveLength(1);
    expect(payloads).not.toContain("SECRET");
  });
});
