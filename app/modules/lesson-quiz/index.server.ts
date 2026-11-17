import { createQuiz as insertQuiz, type NewQuiz } from "./lib/create-quiz";
import {
  computeResult,
  getLessonQuiz as loadLessonQuiz,
  type Db,
} from "./lib/quiz";

/**
 * The quiz on a Lesson, without its answers, and the Student's best attempt.
 * Both are null when the Lesson has no quiz; `bestAttempt` is also null for a
 * signed-out visitor or a Student who has not tried it.
 */
export function getLessonQuiz(
  db: Db,
  lesson: { lessonId: number; userId: number | null }
) {
  return loadLessonQuiz(db, lesson);
}

/**
 * Scores the Student's answers, records the attempt and returns the result.
 * Returns null when the quiz does not exist or the attempt cannot be saved.
 */
export function scoreQuizAttempt(
  db: Db,
  attempt: {
    userId: number;
    quizId: number;
    selectedAnswers: Record<number, number>;
  }
) {
  return computeResult(db, attempt);
}

/**
 * Adds a quiz to a Lesson, numbering the questions in the order given.
 * Returns the ids of the quiz, its questions and their options, in order.
 */
export function createQuiz(db: Db, quiz: NewQuiz) {
  return insertQuiz(db, quiz);
}
