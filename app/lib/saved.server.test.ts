import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { createLesson, createModule } from "./course-content.server";
import { createStudent } from "./users.server";
import { renderMarkdown } from "./markdown.server";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./saved.server";

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfter(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = createModule(db, base.course.id, "Basics", null);
  lessonIds = [1, 2, 3].map(
    (n) => createLesson(db, module.id, `Lesson ${n}`, null, null, null, null).id
  );
});

function addStudent(name: string) {
  return createStudent(db, name, `${name.toLowerCase()}@example.com`);
}

describe("bookmarking a Lesson", () => {
  it("adds a Bookmark the first time and removes it the second", () => {
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves two Bookmarks on the same Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();
    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates the Note with its body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  Remember the generics bit  ", NOW);

    expect(result).toEqual({
      ok: true,
      note: { body: "Remember the generics bit", updatedAt: NOW.toISOString() },
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "Remember the generics bit",
      updatedAt: NOW.toISOString(),
    });
  });

  it("has no Note on a Lesson the Student has not written about", () => {
    expect(getNote(db, base.user.id, lessonIds[0])).toBeNull();
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thought", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Second thought", minutesAfter(5));

    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "Second thought",
      updatedAt: minutesAfter(5).toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("keeps the line breaks and Markdown characters exactly as typed", () => {
    saveNote(db, base.user.id, lessonIds[0], "# not a heading\n*not bold*", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("is plain text that the Markdown renderer will not take", () => {
    saveNote(db, base.user.id, lessonIds[0], "*not bold*", NOW);
    const note = getNote(db, base.user.id, lessonIds[0]);

    // @ts-expect-error a Note body is PlainText, never Markdown
    const render = () => note && renderMarkdown(note.body);
    expect(render).toBeTypeOf("function");
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "a".repeat(2000), NOW);

    expect(result.ok).toBe(true);
  });

  it("refuses a Note over 2,000 characters without storing it", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "a".repeat(2001), NOW);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("2,000") });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeNull();
  });

  it("refuses an empty Note", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "   ", NOW);

    expect(result.ok).toBe(false);
    expect(getNote(db, base.user.id, lessonIds[0])).toBeNull();
  });
});

describe("the Bookmarks and Notes lists", () => {
  it("list only the Student's own Bookmarks, newest first, with their Lesson and Course", () => {
    const other = addStudent("Olivia");
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[1], minutesAfter(1));
    toggleBookmark(db, other.id, lessonIds[2], minutesAfter(2));

    expect(listBookmarks(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId: lessonIds[1],
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      }),
      expect.objectContaining({ lessonId: lessonIds[0], lessonTitle: "Lesson 1" }),
    ]);
  });

  it("list only the Student's own Notes, most recently edited first", () => {
    const other = addStudent("Olivia");
    saveNote(db, base.user.id, lessonIds[0], "Older", NOW);
    saveNote(db, base.user.id, lessonIds[1], "Newer", minutesAfter(1));
    saveNote(db, other.id, lessonIds[2], "Not mine", minutesAfter(2));
    saveNote(db, base.user.id, lessonIds[0], "Older, edited", minutesAfter(3));

    expect(listNotes(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId: lessonIds[0],
        body: "Older, edited",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      }),
      expect.objectContaining({ lessonId: lessonIds[1], body: "Newer" }),
    ]);
  });
});
