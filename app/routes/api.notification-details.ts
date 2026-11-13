import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notification-details";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import { resolveCountry } from "~/lib/country.server";
import { lookupFeedDetails } from "~/lib/feed-details.server";

// The Notification Feed's excerpts and decision notes for one loaded page.
// The drawer posts every id on the page at once; see fetchFeedDetails.

const ids = z.array(z.number().int().positive()).max(100);

const requestSchema = z.object({
  commentIds: ids,
  refundRequestIds: ids,
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    throw data("Invalid request.", { status: 400 });
  }

  return lookupFeedDetails(
    db,
    userId,
    await resolveCountry(request),
    parsed.data
  );
}
