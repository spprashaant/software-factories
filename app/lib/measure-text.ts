export type TextMeasure = {
  length: number;
  max: number;
  tooLong: boolean;
  empty: boolean;
  label: string;
};

const formatCount = (n: number) => n.toLocaleString("en");

/**
 * Trims before counting because the save actions for notes and comments trim
 * before they check the limit; counting the raw text would warn about
 * whitespace the server drops.
 */
export function measureText(body: string, max: number): TextMeasure {
  const length = body.trim().length;
  return {
    length,
    max,
    tooLong: length > max,
    empty: length === 0,
    label: `${formatCount(length)} / ${formatCount(max)}`,
  };
}
