import { quizzes, quizQuestions, quizOptions, QuestionType } from "~/db/schema";
import type { Db } from "./quiz";

export type NewQuiz = {
  lessonId: number;
  title: string;
  passingScore: number;
  questions: Array<{
    questionText: string;
    questionType: QuestionType;
    options: Array<{ optionText: string; isCorrect: boolean }>;
  }>;
};

export function createQuiz(db: Db, quiz: NewQuiz) {
  return db.transaction((tx) => {
    const { questions, ...fields } = quiz;
    const created = tx.insert(quizzes).values(fields).returning().get();
    const questionIds = questions.map((question, index) => {
      const { options, ...questionFields } = question;
      const row = tx
        .insert(quizQuestions)
        .values({ ...questionFields, quizId: created.id, position: index + 1 })
        .returning()
        .get();
      const optionIds = options.map(
        (option) =>
          tx
            .insert(quizOptions)
            .values({ ...option, questionId: row.id })
            .returning()
            .get().id
      );
      return { id: row.id, optionIds };
    });
    return { id: created.id, questions: questionIds };
  });
}
