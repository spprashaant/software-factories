import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import { measureText, type TextMeasure } from "~/lib/measure-text";

export type CommentMeasure = TextMeasure;

/**
 * How long a comment is against the limit the comment actions enforce, and
 * the "used / allowed" label the comment box shows while someone types.
 */
export function measureComment(
  body: string,
  max = MAX_COMMENT_LENGTH
): CommentMeasure {
  return measureText(body, max);
}
