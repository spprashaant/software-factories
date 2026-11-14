import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { lessons, modules } from "~/db/schema";
import type { Markdown } from "~/lib/text";

type Db = BetterSQLite3Database<typeof schema>;

function nextModulePosition(db: Db, courseId: number) {
  const row = db
    .select({ max: sql<number>`coalesce(max(${modules.position}), 0)` })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .get();
  return (row?.max ?? 0) + 1;
}

function nextLessonPosition(db: Db, moduleId: number) {
  const row = db
    .select({ max: sql<number>`coalesce(max(${lessons.position}), 0)` })
    .from(lessons)
    .where(eq(lessons.moduleId, moduleId))
    .get();
  return (row?.max ?? 0) + 1;
}

export function createModule(
  db: Db,
  courseId: number,
  title: string,
  position: number | null
) {
  return db
    .insert(modules)
    .values({
      courseId,
      title,
      position: position ?? nextModulePosition(db, courseId),
    })
    .returning()
    .get();
}

export function createLesson(
  db: Db,
  moduleId: number,
  title: string,
  content: Markdown | null,
  videoUrl: string | null,
  position: number | null,
  durationMinutes: number | null
) {
  return db
    .insert(lessons)
    .values({
      moduleId,
      title,
      content,
      videoUrl,
      position: position ?? nextLessonPosition(db, moduleId),
      durationMinutes,
    })
    .returning()
    .get();
}

export function findLessonInCourse(db: Db, lessonId: number, courseId: number) {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(and(eq(lessons.id, lessonId), eq(modules.courseId, courseId)))
    .get();
}
