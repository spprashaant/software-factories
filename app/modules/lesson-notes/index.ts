import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { measureText, type TextMeasure } from "~/lib/measure-text";

export type NoteMeasure = TextMeasure;

/**
 * How long a Note is against the limit the save action enforces, and the
 * "used / allowed" label the notes box shows while the Student types.
 */
export function measureNote(body: string, max = MAX_NOTE_LENGTH): NoteMeasure {
  return measureText(body, max);
}
