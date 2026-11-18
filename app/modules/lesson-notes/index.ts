import { measure, type NoteMeasure } from "./lib/measure";

export type { NoteMeasure };

/**
 * How long a Note is against the limit the save action enforces, and the
 * "used / allowed" label the notes box shows while the Student types.
 */
export function measureNote(body: string, max?: number): NoteMeasure {
  return measure(body, max);
}
