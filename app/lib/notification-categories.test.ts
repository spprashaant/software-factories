import { describe, expect, it } from "vitest";
import { UserRole } from "~/db/schema";
import { workflows } from "../../knock/workflows";
import {
  notificationCategories,
  notificationSettingsFor,
} from "./notification-categories";

const keysFor = (role: UserRole) =>
  notificationSettingsFor(role, {}).map((setting) => setting.category);

describe("notificationSettingsFor", () => {
  it("offers a Platform Admin Refund Requests to review, plus what any buyer receives", () => {
    expect(keysFor(UserRole.Admin)).toEqual([
      "refund-requests",
      "my-refunds",
      "seat-claims",
      "discussion-replies",
    ]);
  });

  it("offers a Student their refunds, Seat claims and Discussion Replies", () => {
    expect(keysFor(UserRole.Student)).toEqual([
      "my-refunds",
      "seat-claims",
      "discussion-replies",
    ]);
  });

  it("offers an Instructor Enrollments and Discussion Questions, plus what any buyer receives", () => {
    expect(keysFor(UserRole.Instructor)).toEqual([
      "my-refunds",
      "seat-claims",
      "enrollment",
      "discussion-questions",
      "discussion-replies",
    ]);
  });

  it("has Enrollments off and everything else on by default", () => {
    const settings = notificationSettingsFor(UserRole.Instructor, {});

    expect(settings).toEqual([
      { category: "my-refunds", label: "Your refunds", enabled: true },
      { category: "seat-claims", label: "Seat claims", enabled: true },
      { category: "enrollment", label: "Enrollments", enabled: false },
      {
        category: "discussion-questions",
        label: "Discussion Questions",
        enabled: true,
      },
      {
        category: "discussion-replies",
        label: "Discussion Replies",
        enabled: true,
      },
    ]);
  });

  it("shows what the user chose over the default", () => {
    const settings = notificationSettingsFor(UserRole.Instructor, {
      enrollment: true,
      "discussion-replies": false,
    });

    expect(
      Object.fromEntries(settings.map((s) => [s.category, s.enabled]))
    ).toEqual({
      "my-refunds": true,
      "seat-claims": true,
      enrollment: true,
      "discussion-questions": true,
      "discussion-replies": false,
    });
  });
});

describe("notificationCategories", () => {
  it("covers the category of every Knock workflow", () => {
    const keys = notificationCategories.map((category) => category.key);
    for (const workflow of workflows) {
      expect(keys).toContain(workflow.category);
    }
  });
});
