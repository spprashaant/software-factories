import { describe, it, expect, beforeEach } from "vitest";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import {
  createComment,
  deleteComment,
  editComment,
} from "~/lib/comments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { getCommentById, getRenderedLessonThread } from "../index.server";

const at = (minute: number) => new Date(2026, 9, 6, 12, minute, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;
let adminId: number;

async function post(
  authorId: number,
  body: string,
  { minute = 0, parentId = null as number | null, lesson = lessonId } = {}
) {
  const result = await createComment(
    db,
    authorId,
    lesson,
    parentId,
    body,
    at(minute),
    fakeNotifications()
  );
  if (!result.ok) throw new Error(result.error);
  return result.comment.id;
}

function remove(commentId: number, userId: number) {
  return deleteComment(
    db,
    commentId,
    userId,
    false,
    at(30),
    fakeNotifications()
  );
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  [lessonId, otherLessonId] = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
  adminId = db
    .insert(schema.users)
    .values({
      name: "Ada Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get().id;
});

describe("a Lesson's Discussion", () => {
  it("is empty when nobody has posted", async () => {
    expect(await getRenderedLessonThread(db, lessonId)).toEqual([]);
  });

  it("is empty for a Lesson that does not exist", async () => {
    expect(await getRenderedLessonThread(db, 9999)).toEqual([]);
  });

  it("lists questions oldest first, each with its replies", async () => {
    const later = await post(base.user.id, "Second question", { minute: 5 });
    const first = await post(base.user.id, "First question", { minute: 1 });
    await post(base.instructor.id, "An answer", { minute: 6, parentId: first });
    await post(base.user.id, "Elsewhere", { lesson: otherLessonId });

    const thread = await getRenderedLessonThread(db, lessonId);

    expect(thread.map((c) => c.id)).toEqual([first, later]);
    expect(thread[0].replies.map((r) => r.body)).toEqual(["An answer"]);
    expect(thread[1].replies).toEqual([]);
  });

  it("renders each body to HTML and keeps the source", async () => {
    await post(base.user.id, "Why **this**?");

    const [question] = await getRenderedLessonThread(db, lessonId);

    expect(question.body).toBe("Why **this**?");
    expect(question.bodyHtml).toContain("<strong>this</strong>");
    expect(question.createdAt).toBe(at(0).toISOString());
    expect(question.editedAt).toBeNull();
    expect(question.deleted).toBe(false);
  });

  it("marks who the instructor and the platform admins are", async () => {
    const q = await post(base.user.id, "A question");
    await post(base.instructor.id, "From the instructor", { parentId: q });
    await post(adminId, "From an admin", { parentId: q });

    const [question] = await getRenderedLessonThread(db, lessonId);
    const authors = [question, ...question.replies].map((c) => c.author);

    expect(authors).toEqual([
      {
        id: base.user.id,
        name: "Test User",
        avatarUrl: null,
        isInstructor: false,
        isPlatformAdmin: false,
      },
      expect.objectContaining({ isInstructor: true, isPlatformAdmin: false }),
      expect.objectContaining({ isInstructor: false, isPlatformAdmin: true }),
    ]);
  });

  it("keeps a deleted question that has replies, without its body", async () => {
    const q = await post(base.user.id, "Secret question");
    editComment(db, q, base.user.id, "Edited secret", at(10));
    await post(base.instructor.id, "Still useful", { parentId: q });
    await remove(q, base.user.id);

    const [question] = await getRenderedLessonThread(db, lessonId);

    expect(question).toMatchObject({
      id: q,
      deleted: true,
      body: "",
      bodyHtml: "",
      editedAt: null,
    });
    expect(question.replies).toHaveLength(1);
  });

  it("drops a deleted question with no replies", async () => {
    const q = await post(base.user.id, "Never mind");
    await remove(q, base.user.id);

    expect(await getRenderedLessonThread(db, lessonId)).toEqual([]);
  });

  it("drops a deleted reply", async () => {
    const q = await post(base.user.id, "A question");
    const reply = await post(base.user.id, "Oops", { parentId: q });
    await remove(reply, base.user.id);

    const [question] = await getRenderedLessonThread(db, lessonId);

    expect(question.replies).toEqual([]);
  });
});

describe("an edited comment", () => {
  it("shows when it was edited", async () => {
    const q = await post(base.user.id, "Frist");
    editComment(db, q, base.user.id, "First", at(10));

    const [question] = await getRenderedLessonThread(db, lessonId);

    expect(question.body).toBe("First");
    expect(question.editedAt).toBe(at(10).toISOString());
  });
});

describe("finding a comment", () => {
  it("finds a comment by id", async () => {
    const id = await post(base.user.id, "Hello");

    expect(getCommentById(db, id)).toMatchObject({ id, lessonId });
  });

  it("finds nothing for an unknown id", () => {
    expect(getCommentById(db, 9999)).toBeUndefined();
  });
});
