import { describe, it, expect } from "vitest";
import { describeFeedItem, type FeedItem } from "./notification-feed";

function feedItem(key: string, data: Record<string, unknown>): FeedItem {
  return {
    id: "msg_1",
    inserted_at: "2026-11-13T10:00:00Z",
    seen_at: null,
    read_at: null,
    source: { key },
    data,
    actors: [{ id: "7", name: "Ada" }],
  };
}

const discussionData = {
  commentId: 42,
  lessonId: 3,
  lessonTitle: "Closures",
  courseId: 1,
  courseSlug: "intro-js",
  courseTitle: "Intro to JS",
};

describe("describeFeedItem for Discussions", () => {
  it("reads a Discussion Question as asked on the lesson and links to the comment", () => {
    expect(
      describeFeedItem(feedItem("discussion-question", discussionData))
    ).toEqual({
      title: [
        { text: "Ada", bold: true },
        { text: " asked on ", bold: false },
        { text: "Closures", bold: true },
      ],
      meta: "Intro to JS",
      url: "/courses/intro-js/lessons/3#comment-42",
    });
  });

  it("reads a Discussion Reply as replied on the lesson and links to the comment", () => {
    expect(
      describeFeedItem(feedItem("discussion-reply", discussionData))
    ).toEqual({
      title: [
        { text: "Ada", bold: true },
        { text: " replied on ", bold: false },
        { text: "Closures", bold: true },
      ],
      meta: "Intro to JS",
      url: "/courses/intro-js/lessons/3#comment-42",
    });
  });
});
