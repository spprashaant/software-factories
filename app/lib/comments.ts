import { z } from "zod";

export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

export const COMMENT_EMPTY = "Comment cannot be empty";
export const COMMENT_TOO_LONG = `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`;

/**
 * A Discussion Question or Reply body from a form: trimmed, and within the
 * length the Discussions service accepts, with the same wording.
 */
export function commentBodySchema(whenMissing: string) {
  return z
    .string({ required_error: whenMissing })
    .trim()
    .min(MIN_COMMENT_LENGTH, COMMENT_EMPTY)
    .max(MAX_COMMENT_LENGTH, COMMENT_TOO_LONG);
}
