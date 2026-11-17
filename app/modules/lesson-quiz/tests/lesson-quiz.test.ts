import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import { createQuiz, getLessonQuiz, scoreQuizAttempt } from "../index.server";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

function trueFalseQuiz(count: number) {
  return createQuiz(db, {
    lessonId,
    title: "Check yourself",
    passingScore: 0.5,
    questions: Array.from({ length: count }, (_, i) => ({
      questionText: `Statement ${i + 1}`,
      questionType: QuestionType.TrueFalse,
      options: [
        { optionText: "True", isCorrect: true },
        { optionText: "False", isCorrect: false },
      ],
    })),
  });
}

/** Answers the first `right` questions correctly and the rest wrongly. */
function answer(quiz: ReturnType<typeof trueFalseQuiz>, right: number) {
  return Object.fromEntries(
    quiz.questions.map((q, i) => [q.id, q.optionIds[i < right ? 0 : 1]])
  );
}

function score(quizId: number, selectedAnswers: Record<number, number>) {
  return scoreQuizAttempt(db, {
    userId: base.user.id,
    quizId,
    selectedAnswers,
  });
}

describe("the quiz on a Lesson", () => {
  it("is null when the Lesson has no quiz", () => {
    expect(getLessonQuiz(db, { lessonId, userId: base.user.id })).toEqual({
      quiz: null,
      bestAttempt: null,
    });
  });

  it("lists questions in order, without saying which option is right", () => {
    const created = createQuiz(db, {
      lessonId,
      title: "Basics quiz",
      passingScore: 0.8,
      questions: [
        {
          questionText: "Pick one",
          questionType: QuestionType.MultipleChoice,
          options: [
            { optionText: "A", isCorrect: false },
            { optionText: "B", isCorrect: true },
          ],
        },
        {
          questionText: "True?",
          questionType: QuestionType.TrueFalse,
          options: [{ optionText: "True", isCorrect: true }],
        },
      ],
    });

    const { quiz } = getLessonQuiz(db, { lessonId, userId: null });

    expect(quiz).toEqual({
      id: created.id,
      title: "Basics quiz",
      passingScore: 0.8,
      questions: [
        {
          id: created.questions[0].id,
          questionText: "Pick one",
          questionType: QuestionType.MultipleChoice,
          position: 1,
          options: [
            { id: created.questions[0].optionIds[0], optionText: "A" },
            { id: created.questions[0].optionIds[1], optionText: "B" },
          ],
        },
        {
          id: created.questions[1].id,
          questionText: "True?",
          questionType: QuestionType.TrueFalse,
          position: 2,
          options: [
            { id: created.questions[1].optionIds[0], optionText: "True" },
          ],
        },
      ],
    });
  });

  it("has no best attempt for a signed-out visitor", () => {
    const quiz = trueFalseQuiz(1);
    score(quiz.id, answer(quiz, 1));

    expect(
      getLessonQuiz(db, { lessonId, userId: null }).bestAttempt
    ).toBeNull();
  });

  it("has no best attempt before the Student tries", () => {
    trueFalseQuiz(1);

    expect(
      getLessonQuiz(db, { lessonId, userId: base.user.id }).bestAttempt
    ).toBeNull();
  });

  it("reports the Student's highest-scoring attempt", () => {
    const quiz = trueFalseQuiz(4);
    score(quiz.id, answer(quiz, 4));
    score(quiz.id, answer(quiz, 1));

    expect(
      getLessonQuiz(db, { lessonId, userId: base.user.id }).bestAttempt
    ).toEqual({ score: 1, passed: true });
  });
});

describe("scoring an attempt", () => {
  it("is null for a quiz that does not exist", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(score(9999, {})).toBeNull();
  });

  it("is null when the attempt cannot be saved", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const quiz = trueFalseQuiz(1);

    expect(
      scoreQuizAttempt(db, {
        userId: 9999,
        quizId: quiz.id,
        selectedAnswers: answer(quiz, 1),
      })
    ).toBeNull();
  });

  it.each([
    [10, "A", true],
    [9, "A", true],
    [8, "B", true],
    [7, "C", false],
    [6, "D", false],
    [5, "F", false],
  ])("grades %i out of 10 as %s", (right, grade, passed) => {
    const quiz = trueFalseQuiz(10);

    expect(score(quiz.id, answer(quiz, right))).toMatchObject({
      score: right / 10,
      grade,
      passed,
      totalCorrect: right,
      totalQuestions: 10,
    });
  });

  it("passes only above 70%, whatever the quiz's passing score", () => {
    const quiz = trueFalseQuiz(10);

    expect(score(quiz.id, answer(quiz, 6))?.passed).toBe(false);
  });

  it("explains each question, and leaves an unanswered one blank", () => {
    const quiz = createQuiz(db, {
      lessonId,
      title: "Mixed",
      passingScore: 0.5,
      questions: [
        {
          questionText: "Pick one",
          questionType: QuestionType.MultipleChoice,
          options: [
            { optionText: "A", isCorrect: false },
            { optionText: "B", isCorrect: true },
          ],
        },
        {
          questionText: "True?",
          questionType: QuestionType.TrueFalse,
          options: [
            { optionText: "True", isCorrect: false },
            { optionText: "False", isCorrect: true },
          ],
        },
        {
          questionText: "Skipped",
          questionType: QuestionType.TrueFalse,
          options: [{ optionText: "True", isCorrect: true }],
        },
      ],
    });
    const [mc, tf, skipped] = quiz.questions;

    const result = score(quiz.id, {
      [mc.id]: mc.optionIds[1],
      [tf.id]: tf.optionIds[0],
    });

    expect(result?.questionResults).toEqual([
      {
        questionId: mc.id,
        correct: true,
        selectedOptionId: mc.optionIds[1],
        correctOptionId: mc.optionIds[1],
      },
      {
        questionId: tf.id,
        correct: false,
        selectedOptionId: tf.optionIds[0],
        correctOptionId: tf.optionIds[1],
      },
      {
        questionId: skipped.id,
        correct: false,
        selectedOptionId: null,
        correctOptionId: null,
      },
    ]);
  });

  it("marks a question with no correct option wrong", () => {
    const quiz = createQuiz(db, {
      lessonId,
      title: "Broken",
      passingScore: 0.5,
      questions: [
        {
          questionText: "Pick one",
          questionType: QuestionType.MultipleChoice,
          options: [{ optionText: "A", isCorrect: false }],
        },
        {
          questionText: "True?",
          questionType: QuestionType.TrueFalse,
          options: [{ optionText: "True", isCorrect: false }],
        },
      ],
    });
    const [mc, tf] = quiz.questions;

    const result = score(quiz.id, {
      [mc.id]: mc.optionIds[0],
      [tf.id]: tf.optionIds[0],
    });

    expect(result?.totalCorrect).toBe(0);
    expect(result?.questionResults.map((r) => r.correctOptionId)).toEqual([
      null,
      null,
    ]);
  });

  it("scores a quiz with no questions as 0", () => {
    const quiz = trueFalseQuiz(0);

    expect(score(quiz.id, {})).toMatchObject({
      score: 0,
      grade: "F",
      passed: false,
      totalQuestions: 0,
    });
  });

  it("records the attempt and the answers given", () => {
    const quiz = trueFalseQuiz(2);
    const [first] = quiz.questions;

    const result = score(quiz.id, { [first.id]: first.optionIds[0] });

    expect(db.select().from(schema.quizAttempts).all()).toEqual([
      expect.objectContaining({
        id: result?.attemptId,
        userId: base.user.id,
        quizId: quiz.id,
        score: 0.5,
        passed: false,
      }),
    ]);
    expect(db.select().from(schema.quizAnswers).all()).toEqual([
      expect.objectContaining({
        attemptId: result?.attemptId,
        questionId: first.id,
        selectedOptionId: first.optionIds[0],
      }),
    ]);
  });
});
