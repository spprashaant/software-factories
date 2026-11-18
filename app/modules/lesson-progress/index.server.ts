import * as progress from "./lib/progress";
import type { Db } from "./lib/progress";

type StudentLesson = { userId: number; lessonId: number };

/** The Student's progress row for one Lesson, if they have opened it. */
export function getLessonProgress(db: Db, { userId, lessonId }: StudentLesson) {
  return progress.getLessonProgress(db, userId, lessonId);
}

/** The Student's progress rows across every Lesson of the course. */
export function getLessonProgressForCourse(
  db: Db,
  { userId, courseId }: { userId: number; courseId: number }
) {
  return progress.getLessonProgressForCourse(db, userId, courseId);
}

/** Records the Lesson as completed, now. */
export function markLessonComplete(
  db: Db,
  { userId, lessonId }: StudentLesson
) {
  return progress.markLessonComplete(db, userId, lessonId);
}

/** Records the Lesson as started. A completed Lesson stays completed. */
export function markLessonInProgress(
  db: Db,
  { userId, lessonId }: StudentLesson
) {
  return progress.markLessonInProgress(db, userId, lessonId);
}

/** Where the Student last was in the Lesson's video, in seconds; 0 if never. */
export function getLastWatchPosition(
  db: Db,
  { userId, lessonId }: StudentLesson
) {
  return progress.getLastWatchPosition(db, userId, lessonId);
}

/**
 * How far into the video the Student has got, as a whole percentage from 0 to
 * 100, from the furthest position they reached.
 */
export function calculateWatchProgress(
  db: Db,
  viewing: StudentLesson & { videoDurationSeconds: number }
) {
  return progress.calculateWatchProgress(db, viewing);
}

/** Records one event from the Lesson's video player at the given moment. */
export function recordWatchEvent(
  db: Db,
  event: StudentLesson & {
    eventType: string;
    positionSeconds: number;
    at: Date;
  }
) {
  return progress.recordWatchEvent(db, event);
}
