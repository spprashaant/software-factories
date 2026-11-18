import { MAX_COMMENT_LENGTH } from "~/lib/comments";

export type CommentMeasure = {
  length: number;
  max: number;
  tooLong: boolean;
  empty: boolean;
  label: string;
};

const formatCount = (n: number) => n.toLocaleString("en");

/**
 * Trims before counting because createComment and editComment trim before
 * they check the limit; counting the raw text would warn about whitespace the
 * server drops.
 */
export function measure(
  body: string,
  max = MAX_COMMENT_LENGTH
): CommentMeasure {
  const length = body.trim().length;
  return {
    length,
    max,
    tooLong: length > max,
    empty: length === 0,
    label: `${formatCount(length)} / ${formatCount(max)}`,
  };
}
