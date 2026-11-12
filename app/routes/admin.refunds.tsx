import { useState } from "react";
import { data, Form, isRouteErrorResponse, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import { RefundStatus } from "~/db/schema";
import { requirePlatformAdmin } from "~/lib/access.server";
import {
  approveRefundRequest,
  declineRefundRequest,
  listRefundRequests,
  RefundDecisionError,
  REFUND_ELIGIBILITY_PROBLEM_LABELS,
  type RefundEmail,
} from "~/lib/refunds.server";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { AlertTriangle, ReceiptText } from "lucide-react";

// Approving team-licence Purchases waits on voiding their unclaimed seats.
const TEAM_LICENCE_ISSUE_URL =
  "https://github.com/spprashaant/software-factories/issues/4";

const decisionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundId: z.coerce.number().int().positive(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundId: z.coerce.number().int().positive(),
    note: z
      .string()
      .trim()
      .max(1000, "Please keep the note under 1000 characters.")
      .optional(),
  }),
]);

const DECISION_FAILURE_STATUS = {
  "not-found": 404,
  "already-decided": 409,
  "team-licence": 403,
} as const;

function logEmail(email: RefundEmail) {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or Decline Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePlatformAdmin(request);

  const refundRequests = listRefundRequests(db).map((row) => ({
    ...row,
    eligibilityFlags: row.eligibilityProblems.map(
      (problem) => REFUND_ELIGIBILITY_PROBLEM_LABELS[problem]
    ),
  }));

  return { refundRequests };
}

export async function action({ request }: Route.ActionArgs) {
  const { userId } = await requirePlatformAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    throw data(Object.values(parsed.errors)[0] ?? "Invalid input.", {
      status: 400,
    });
  }

  try {
    if (parsed.data.intent === "approve") {
      const { email } = approveRefundRequest(db, {
        refundId: parsed.data.refundId,
        supportUserId: userId,
      });
      logEmail(email);
    } else {
      const { email } = declineRefundRequest(db, {
        refundId: parsed.data.refundId,
        supportUserId: userId,
        note: parsed.data.note,
      });
      logEmail(email);
    }
  } catch (error) {
    if (error instanceof RefundDecisionError) {
      throw data(error.message, {
        status: DECISION_FAILURE_STATUS[error.failure],
      });
    }
    throw error;
  }

  return { ok: true };
}

// ─── UI ───

type RefundRequestRow =
  Route.ComponentProps["loaderData"]["refundRequests"][number];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatHours(seconds: number) {
  return `${(seconds / 3600).toFixed(1)} h`;
}

function describeWindow(daysLeft: number) {
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === 1) return "1 day left";
  if (daysLeft === 0) return "Last day";
  if (daysLeft === -1) return "1 day past";
  return `${-daysLeft} days past`;
}

function StatusBadge({ status }: { status: RefundStatus }) {
  const styles: Record<RefundStatus, string> = {
    [RefundStatus.Requested]:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    [RefundStatus.Approved]:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    [RefundStatus.Declined]:
      "bg-muted text-muted-foreground",
  };
  const labels: Record<RefundStatus, string> = {
    [RefundStatus.Requested]: "Requested",
    [RefundStatus.Approved]: "Approved",
    [RefundStatus.Declined]: "Declined",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function Decision({ row }: { row: RefundRequestRow }) {
  const navigation = useNavigation();
  const [declining, setDeclining] = useState(false);
  const isSubmitting =
    navigation.state !== "idle" &&
    navigation.formData?.get("refundId") === String(row.id);

  if (row.status !== RefundStatus.Requested) {
    return (
      <p className="text-sm text-muted-foreground">
        {row.status === RefundStatus.Approved ? "Approved" : "Declined"} by{" "}
        {row.resolvedByName ?? "unknown"}
        {row.resolvedAt && <> on {formatDate(row.resolvedAt)}</>}
        {row.status === RefundStatus.Approved && row.amountRefunded !== null && (
          <> · {formatPrice(row.amountRefunded)} refunded</>
        )}
      </p>
    );
  }

  if (declining) {
    return (
      <Form method="post" className="space-y-2">
        <input type="hidden" name="intent" value="decline" />
        <input type="hidden" name="refundId" value={row.id} />
        <Textarea
          name="note"
          placeholder="Optional note to the learner"
          maxLength={1000}
          rows={2}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Declining..." : "Decline"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDeclining(false)}
          >
            Back
          </Button>
        </div>
      </Form>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Form method="post">
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="refundId" value={row.id} />
          <Button
            type="submit"
            size="sm"
            disabled={row.isTeamLicence || isSubmitting}
          >
            {isSubmitting ? "Approving..." : "Approve"}
          </Button>
        </Form>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDeclining(true)}
        >
          Decline
        </Button>
      </div>
      {row.isTeamLicence && (
        <p className="text-xs text-muted-foreground">
          Team-licence Purchases can't be Approved until their unclaimed seats
          can be voided (
          <a
            href={TEAM_LICENCE_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            #4
          </a>
          ).
        </p>
      )}
    </div>
  );
}

function RefundRequestCard({ row }: { row: RefundRequestRow }) {
  const { completedLessons, totalLessons, secondsWatched } = row.progress;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {row.learnerName}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {row.learnerEmail}
              </span>
            </p>
            <Link
              to={`/courses/${row.courseSlug}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              {row.courseTitle}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {row.isTeamLicence && (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                Team licence
              </span>
            )}
            <StatusBadge status={row.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <blockquote className="border-l-2 pl-3 text-sm italic">
          {row.reason}
        </blockquote>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Paid</dt>
            <dd>{formatPrice(row.amountPaid)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Requested</dt>
            <dd>{formatDate(row.requestedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Progress</dt>
            <dd>
              {completedLessons}/{totalLessons} lessons ·{" "}
              {formatHours(secondsWatched)} watched
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Refund Window</dt>
            <dd>{describeWindow(row.daysLeftInWindow)}</dd>
          </div>
        </dl>

        {row.eligibilityFlags.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Fails Refund Eligibility</p>
              <ul className="list-disc pl-4">
                {row.eligibilityFlags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Decision row={row} />
      </CardContent>
    </Card>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;
  const requested = refundRequests.filter(
    (row) => row.status === RefundStatus.Requested
  );
  const resolved = refundRequests.filter(
    (row) => row.status !== RefundStatus.Requested
  );

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ReceiptText className="size-7" />
          Refund Requests
        </h1>
        <p className="mt-1 text-muted-foreground">
          {requested.length === 1
            ? "1 Refund Request is waiting for a decision."
            : `${requested.length} Refund Requests are waiting for a decision.`}
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Requested</h2>
        {requested.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to decide.</p>
        ) : (
          requested.map((row) => <RefundRequestCard key={row.id} row={row} />)
        )}
      </section>

      {resolved.length > 0 && (
        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold">Decided</h2>
          {resolved.map((row) => (
            <RefundRequestCard key={row.id} row={row} />
          ))}
        </section>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else if (error.status === 409) {
      title = "Already decided";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/admin/refunds" reloadDocument>
            <Button variant="outline">Back to Refund Requests</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
