import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteMeasure = {
  length: number;
  max: number;
  tooLong: boolean;
  empty: boolean;
  label: string;
};

const formatCount = (n: number) => n.toLocaleString("en");

/**
 * Trims before counting because the save action trims before it checks the
 * limit; counting the raw text would warn about whitespace the server drops.
 */
export function measure(body: string, max = MAX_NOTE_LENGTH): NoteMeasure {
  const length = body.trim().length;
  return {
    length,
    max,
    tooLong: length > max,
    empty: length === 0,
    label: `${formatCount(length)} / ${formatCount(max)}`,
  };
}
