import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// A Student's own flag on a Lesson, and their own writing about it. See
// GLOSSARY.md. Both are private to the Student: nothing here takes a second
// user id, and no Instructor or Platform Admin view may read Note bodies.
//
// The one-per-Student-per-Lesson rule is held by unique indexes on both
// tables, so the writes below lean on the database rather than a read first.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;

const bookmarkOf = (userId: number, lessonId: number) =>
  and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId));

const noteOf = (userId: number, lessonId: number) =>
  and(eq(notes.userId, userId), eq(notes.lessonId, lessonId));

// ─── Bookmarks ───

export function isBookmarked(db: Db, userId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(bookmarkOf(userId, lessonId))
    .get();
}

/** Removes the Bookmark if there is one, adds it if not. Returns whether the Lesson is now bookmarked. */
export function toggleBookmark(
  db: Db,
  userId: number,
  lessonId: number,
  now: Date
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(bookmarkOf(userId, lessonId))
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return false;

  db.insert(bookmarks)
    .values({ userId, lessonId, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return true;
}

// ─── Notes ───

export type LessonNote = { body: string; updatedAt: string };

export function getNote(
  db: Db,
  userId: number,
  lessonId: number
): LessonNote | null {
  return (
    db
      .select({ body: notes.body, updatedAt: notes.updatedAt })
      .from(notes)
      .where(noteOf(userId, lessonId))
      .get() ?? null
  );
}

export type SaveNoteResult =
  | { ok: true; note: LessonNote }
  | { ok: false; error: string };

/**
 * Creates the Student's Note on a Lesson, or replaces its body and moves its
 * "last edited" time on. The body is trimmed and refused, never truncated,
 * when it is over the cap.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length < MIN_NOTE_LENGTH) {
    return { ok: false, error: "Write something before saving your note." };
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`,
    };
  }

  const timestamp = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .returning({ body: notes.body, updatedAt: notes.updatedAt })
    .get();

  return { ok: true, note };
}

// ─── The Saved page ───

const lessonRefColumns = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first, each with the Lesson and Course it belongs to. */
export function listBookmarks(db: Db, userId: number) {
  return db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonRefColumns })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, most recently edited first, each with the Lesson and Course it belongs to. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRefColumns,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
