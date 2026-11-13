import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import type { Db } from "~/lib/refunds.server";

// ─── Discussions ───
// Posting a Discussion Question on a lesson, or a Discussion Reply to one.
// Both the lesson page and /instructor/questions post through here. Editing
// and deleting stay in the lesson route.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Comment = typeof comments.$inferSelect;

export type PostResult =
  | { ok: true; comment: Comment }
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

function lessonExists(db: Db, lessonId: number) {
  return !!db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

/** Posts a top-level Discussion Question on a lesson. */
export function askDiscussionQuestion(
  db: Db,
  authorId: number,
  lessonId: number,
  body: string
): PostResult {
  const valid = validateBody(body);
  if (!valid.ok) return valid;

  if (!lessonExists(db, lessonId)) {
    return { ok: false, error: "Lesson not found" };
  }

  const comment = db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId: null, body: valid.body })
    .returning()
    .get();

  return { ok: true, comment };
}

/**
 * Posts a Discussion Reply to a Discussion Question. Replies are one level
 * deep, and the Discussion Question must be on the same lesson.
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

  if (!lessonExists(db, lessonId)) {
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

  return { ok: true, comment };
}
