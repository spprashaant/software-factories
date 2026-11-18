import { measure, type CommentMeasure } from "./lib/measure";

export type { CommentMeasure };

/**
 * How long a comment is against the limit the comment actions enforce, and
 * the "used / allowed" label the comment box shows while someone types.
 */
export function measureComment(body: string, max?: number): CommentMeasure {
  return measure(body, max);
}
