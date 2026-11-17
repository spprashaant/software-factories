import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";
import { createTestDb, seedBaseData } from "~/test/setup";

/**
 * A course with two Lessons in one Module, a second course with one Lesson,
 * and a second Student. Courses and Lessons belong to the catalogue, not to
 * this module, so they are inserted directly.
 */
export function lessonWorld() {
  const db = createTestDb();
  const base = seedBaseData(db);

  const addLesson = (moduleId: number, position: number) =>
    db
      .insert(schema.lessons)
      .values({ moduleId, title: `Lesson ${position}`, position })
      .returning()
      .get().id;

  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  const lessonIds = [addLesson(mod.id, 1), addLesson(mod.id, 2)];

  const otherCourse = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: markdown("## Other Course\n\nSales copy."),
      status: schema.CourseStatus.Published,
      instructorId: base.instructor.id,
      categoryId: base.category.id,
    })
    .returning()
    .get();
  const otherModule = db
    .insert(schema.modules)
    .values({ courseId: otherCourse.id, title: "Other", position: 1 })
    .returning()
    .get();
  const otherLessonId = addLesson(otherModule.id, 1);

  const otherStudentId = addStudent(db);

  return {
    db,
    base,
    lessonIds,
    otherCourse,
    otherLessonId,
    otherStudentId,
  };
}

function addStudent(db: ReturnType<typeof createTestDb>) {
  return db
    .insert(schema.users)
    .values({
      name: "Other Student",
      email: "other@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get().id;
}
