import { eq, inArray } from "drizzle-orm";
import { comments, lessons, modules, purchases, refunds } from "~/db/schema";
import { resolveCourseAccess } from "~/lib/course-access.server";
import type { Db } from "~/db/types";
import type { FeedDetailIds, FeedDetails } from "~/lib/notification-feed";

// ─── Notification Feed details ───
// Knock never holds text a person wrote. The drawer asks Cadence for the
// Discussion excerpts and refund decision notes on its loaded page, in one
// batch, and this reads them at render time for the signed-in user.
//
// Per comment: its current text if the user can see that course now (the
// lesson page's access check), "removed" if soft-deleted, else "unavailable".
// A decision note goes only to the user who raised the Refund Request.
//
// Uses positional parameters (project convention).

export function lookupFeedDetails(
  db: Db,
  userId: number,
  currentCountry: string | null,
  ids: FeedDetailIds
): FeedDetails {
  const result: FeedDetails = { comments: {}, decisionNotes: {} };

  const found =
    ids.commentIds.length === 0
      ? []
      : db
          .select({
            id: comments.id,
            body: comments.body,
            deletedAt: comments.deletedAt,
            courseId: modules.courseId,
          })
          .from(comments)
          .innerJoin(lessons, eq(lessons.id, comments.lessonId))
          .innerJoin(modules, eq(modules.id, lessons.moduleId))
          .where(inArray(comments.id, ids.commentIds))
          .all();

  // One access check per course, not per comment.
  const canView = new Map<number, boolean>();
  for (const comment of found) {
    if (!canView.has(comment.courseId)) {
      canView.set(
        comment.courseId,
        resolveCourseAccess(db, userId, comment.courseId, currentCountry)
          .canViewContent
      );
    }
  }

  for (const id of ids.commentIds) {
    const comment = found.find((each) => each.id === id);
    if (!comment || !canView.get(comment.courseId)) {
      result.comments[id] = { status: "unavailable" };
    } else if (comment.deletedAt) {
      result.comments[id] = { status: "removed" };
    } else {
      result.comments[id] = { status: "text", text: comment.body };
    }
  }

  // The buyer on the Purchase is who raised its Refund Request. A Team Admin
  // added to the Team Licence later did not, so never sees the note.
  const decided =
    ids.refundRequestIds.length === 0
      ? []
      : db
          .select({
            id: refunds.id,
            note: refunds.decisionNote,
            raisedBy: purchases.userId,
          })
          .from(refunds)
          .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
          .where(inArray(refunds.id, ids.refundRequestIds))
          .all();

  for (const id of ids.refundRequestIds) {
    const refund = decided.find((each) => each.id === id);
    result.decisionNotes[id] =
      refund && refund.raisedBy === userId && refund.note
        ? { status: "note", text: refund.note }
        : { status: "unavailable" };
  }

  return result;
}
