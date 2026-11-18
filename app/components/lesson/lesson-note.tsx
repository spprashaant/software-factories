import { useId, useState } from "react";
import { useFetcher } from "react-router";
import { NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { PanelHeading } from "~/components/panel-heading";
import { cn, formatRelativeTime } from "~/lib/utils";
import { measureNote, type NoteMeasure } from "~/modules/lesson-notes";

export function LessonNote({
  note,
}: {
  note: { body: string; updatedAt: string } | null;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [body, setBody] = useState(note?.body ?? "");
  const isSaving = fetcher.state !== "idle";
  const error = fetcher.data?.error;
  const measure = measureNote(body);
  const { tooLong } = measure;
  const headingId = useId();
  const counterId = useId();

  return (
    <Card className="mb-8">
      <CardContent className="space-y-3">
        <PanelHeading icon={NotebookPen} id={headingId}>
          Your notes
        </PanelHeading>

        <fetcher.Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Only you can read this."
            className="resize-y"
            aria-labelledby={headingId}
            aria-describedby={counterId}
            aria-invalid={tooLong || undefined}
          />
          <NoteFooter
            isSaving={isSaving}
            error={error}
            updatedAt={note?.updatedAt}
            measure={measure}
            counterId={counterId}
          />
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteFooter({
  isSaving,
  error,
  updatedAt,
  measure: { tooLong, label, max },
  counterId,
}: {
  isSaving: boolean;
  error: string | undefined;
  updatedAt: string | undefined;
  measure: NoteMeasure;
  counterId: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" size="sm" disabled={isSaving || tooLong}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
      {!error && updatedAt && (
        <span
          suppressHydrationWarning
          className="text-xs text-muted-foreground"
        >
          Last edited {formatRelativeTime(updatedAt)}
        </span>
      )}
      <span
        id={counterId}
        aria-label={`${label} characters`}
        title={`Notes can be up to ${max.toLocaleString("en")} characters`}
        className={cn(
          "ml-auto text-xs tabular-nums",
          tooLong ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  );
}
