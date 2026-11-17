import * as thread from "./lib/thread";
import type { Db } from "./lib/thread";

export type { CommentAuthor, ThreadComment } from "./lib/thread";

/** A single comment by id, whatever Lesson it is on, deleted or not. */
export function getCommentById(db: Db, commentId: number) {
  return thread.getCommentById(db, commentId);
}

/**
 * The Lesson's Discussion, with every comment body rendered to sanitised
 * HTML: top-level questions oldest first, each with its replies. Deleted
 * comments lose their body; a deleted question with no replies is dropped.
 */
export function getRenderedLessonThread(db: Db, lessonId: number) {
  return thread.renderThread(thread.getLessonThread(db, lessonId));
}
