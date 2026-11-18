import { describe, it, expect } from "vitest";
import { measureComment } from "../index";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";

describe("measureComment", () => {
  it("measures against the limit the comment actions enforce by default", () => {
    expect(measureComment("").max).toBe(MAX_COMMENT_LENGTH);
  });

  it("labels an empty comment with the full allowance, grouped like the notes box", () => {
    expect(measureComment("")).toEqual({
      length: 0,
      max: MAX_COMMENT_LENGTH,
      tooLong: false,
      empty: true,
      label: "0 / 5,000",
    });
  });

  it("does not count surrounding whitespace, as the server trims it", () => {
    const result = measureComment("  hello \n");
    expect(result.length).toBe(5);
    expect(result.empty).toBe(false);
    expect(result.label).toBe("5 / 5,000");
  });

  it("treats whitespace alone as empty", () => {
    expect(measureComment("   \n\t").empty).toBe(true);
  });

  it("allows a comment exactly at the limit", () => {
    const result = measureComment("a".repeat(10), 10);
    expect(result.tooLong).toBe(false);
    expect(result.label).toBe("10 / 10");
  });

  it("does not flag a comment pushed over the limit only by trailing whitespace", () => {
    expect(measureComment(`${"a".repeat(10)}   `, 10).tooLong).toBe(false);
  });

  it("flags a comment one character over the limit", () => {
    const result = measureComment("a".repeat(11), 10);
    expect(result.tooLong).toBe(true);
    expect(result.label).toBe("11 / 10");
  });
});
