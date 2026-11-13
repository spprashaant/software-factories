import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import type {
  Notification,
  NotificationPerson,
} from "~/lib/notifications.server";
import type { Db } from "~/db/types";

// ─── Discussions ───
// Posting a Discussion Question on a lesson, or a Discussion Reply to one.
// Both the lesson page and /instructor/questions post through here. Editing
// and deleting stay in the lesson route.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Comment = typeof comments.$inferSelect;

export type PostResult =
  | { ok: true; comment: Comment; notifications: Notification[] }
  | { ok: false; error: string };

function validateBody(body: string): { ok: true; body: string } | { ok: false; error: string } {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, body: trimmed };
}

type LessonContext = {
  lessonId: number;
  lessonTitle: string;
  courseId: number;
  courseSlug: string;
  courseTitle: string;
  instructorId: number;
};

function findLesson(db: Db, lessonId: number): LessonContext | undefined {
  return db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function findPerson(db: Db, userId: number): NotificationPerson | undefined {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

// ─── Notifications ───
// Only ids, names and titles: never the comment text, which the feed shows
// from Cadence at render time.

function discussionNotification(
  db: Db,
  kind: "discussion-question" | "discussion-reply",
  recipientId: number,
  authorId: number,
  lesson: LessonContext,
  comment: Comment
): Notification[] {
  if (recipientId === authorId) return [];
  const recipient = findPerson(db, recipientId);
  const actor = findPerson(db, authorId);
  if (!recipient || !actor) return [];

  return [
    {
      kind,
      recipients: [recipient],
      actor,
      data: {
        commentId: comment.id,
        lessonId: lesson.lessonId,
        lessonTitle: lesson.lessonTitle,
        courseId: lesson.courseId,
        courseSlug: lesson.courseSlug,
        courseTitle: lesson.courseTitle,
      },
      idempotencyKey: `${kind}:${comment.id}`,
      arrivesRead: false,
    },
  ];
}

/**
 * Posts a top-level Discussion Question on a lesson. "{Person} asked on
 * {lesson}" goes to the course's Instructor, unless they asked it.
 */
export function askDiscussionQuestion(
  db: Db,
  authorId: number,
  lessonId: number,
  body: string
): PostResult {
  const valid = validateBody(body);
  if (!valid.ok) return valid;

  const lesson = findLesson(db, lessonId);
  if (!lesson) {
    return { ok: false, error: "Lesson not found" };
  }

  const comment = db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId: null, body: valid.body })
    .returning()
    .get();

  return {
    ok: true,
    comment,
    notifications: discussionNotification(
      db,
      "discussion-question",
      lesson.instructorId,
      authorId,
      lesson,
      comment
    ),
  };
}

/**
 * Posts a Discussion Reply to a Discussion Question. Replies are one level
 * deep, and the Discussion Question must be on the same lesson. "{Person}
 * replied on {lesson}" goes to the Discussion Question's author, unless they
 * replied; nobody else in the thread hears about it.
 */
export function replyToDiscussionQuestion(
  db: Db,
  authorId: number,
  lessonId: number,
  questionId: number,
  body: string
): PostResult {
  const valid = validateBody(body);
  if (!valid.ok) return valid;

  const lesson = findLesson(db, lessonId);
  if (!lesson) {
    return { ok: false, error: "Lesson not found" };
  }

  const parent = db
    .select()
    .from(comments)
    .where(eq(comments.id, questionId))
    .get();
  if (!parent) {
    return { ok: false, error: "Parent comment not found" };
  }
  if (parent.lessonId !== lessonId) {
    return { ok: false, error: "Parent comment belongs to a different lesson" };
  }
  if (parent.parentId !== null) {
    return { ok: false, error: "Replies can only be one level deep" };
  }

  const comment = db
    .insert(comments)
    .values({
      userId: authorId,
      lessonId,
      parentId: questionId,
      body: valid.body,
    })
    .returning()
    .get();

  return {
    ok: true,
    comment,
    notifications: discussionNotification(
      db,
      "discussion-reply",
      parent.userId,
      authorId,
      lesson,
      comment
    ),
  };
}
