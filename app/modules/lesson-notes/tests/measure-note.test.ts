import { describe, it, expect } from "vitest";
import { measureNote } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("measureNote", () => {
  it("measures against the limit the save action enforces by default", () => {
    expect(measureNote("").max).toBe(MAX_NOTE_LENGTH);
  });

  it("labels an empty note with the full allowance", () => {
    expect(measureNote("")).toEqual({
      length: 0,
      max: MAX_NOTE_LENGTH,
      tooLong: false,
      empty: true,
      label: "0 / 2,000",
    });
  });

  it("does not count surrounding whitespace, as the server trims it", () => {
    const result = measureNote("  hello \n");
    expect(result.length).toBe(5);
    expect(result.empty).toBe(false);
    expect(result.label).toBe("5 / 2,000");
  });

  it("treats whitespace alone as empty", () => {
    expect(measureNote("   \n\t").empty).toBe(true);
  });

  it("allows a note exactly at the limit", () => {
    const result = measureNote("a".repeat(10), 10);
    expect(result.tooLong).toBe(false);
    expect(result.label).toBe("10 / 10");
  });

  it("flags a note one character over the limit", () => {
    const result = measureNote("a".repeat(11), 10);
    expect(result.tooLong).toBe(true);
    expect(result.label).toBe("11 / 10");
  });

  it("groups thousands in the label", () => {
    expect(measureNote("a".repeat(1500), 2000).label).toBe("1,500 / 2,000");
  });
});
