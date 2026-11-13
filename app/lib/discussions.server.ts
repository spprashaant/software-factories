import { eq } from "drizzle-orm";
import { data } from "react-router";
import { comments, courses, lessons, modules } from "~/db/schema";
import type { Db } from "~/db/types";
import {
  COMMENT_EMPTY,
  COMMENT_TOO_LONG,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from "~/lib/comments";
import type {
  Notification,
  WithNotifications,
} from "~/lib/notifications.server";
import { findPerson } from "~/lib/people.server";

// ─── Discussions ───
// Posting a Discussion Question on a lesson, or a Discussion Reply to one.
// Both the lesson page and /instructor/questions post through here. Editing
// and deleting stay in the lesson route.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention). A post that can't go
// ahead throws a response with the reason, as route actions do.

type Comment = typeof comments.$inferSelect;

export type Posted = WithNotifications<{ comment: Comment }>;

/** A lesson and its course, as they travel together into a Notification. */
export type LessonInCourse = {
  lessonId: number;
  lessonTitle: string;
  courseId: number;
  courseSlug: string;
  courseTitle: string;
};

/** The trimmed body, or a 400 when it is empty or too long. */
function validBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw data(COMMENT_EMPTY, { status: 400 });
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw data(COMMENT_TOO_LONG, { status: 400 });
  }
  return trimmed;
}

function findLesson(
  db: Db,
  lessonId: number
): { lesson: LessonInCourse; instructorId: number } {
  const found = db
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
  if (!found) throw data("Lesson not found", { status: 404 });

  const { instructorId, ...lesson } = found;
  return { lesson, instructorId };
}

// ─── Notifications ───
// Only ids, names and titles: never the comment text, which the feed shows
// from Cadence at render time.

function discussionNotification(
  db: Db,
  kind: "discussion-question" | "discussion-reply",
  recipientId: number,
  authorId: number,
  lesson: LessonInCourse,
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
      data: { commentId: comment.id, ...lesson },
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
): Posted {
  const trimmed = validBody(body);
  const { lesson, instructorId } = findLesson(db, lessonId);

  const comment = db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId: null, body: trimmed })
    .returning()
    .get();

  return {
    comment,
    notifications: discussionNotification(
      db,
      "discussion-question",
      instructorId,
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
): Posted {
  const trimmed = validBody(body);
  const { lesson } = findLesson(db, lessonId);

  const parent = db
    .select()
    .from(comments)
    .where(eq(comments.id, questionId))
    .get();
  if (!parent) {
    throw data("Parent comment not found", { status: 404 });
  }
  if (parent.lessonId !== lessonId) {
    throw data("Parent comment belongs to a different lesson", {
      status: 400,
    });
  }
  if (parent.parentId !== null) {
    throw data("Replies can only be one level deep", { status: 400 });
  }

  const comment = db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId: questionId, body: trimmed })
    .returning()
    .get();

  return {
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
