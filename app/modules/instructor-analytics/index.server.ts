import { db as appDb } from "~/db";
import {
  buildInstructorAnalytics,
  type AnalyticsViewer,
  type Db,
} from "./lib/analytics.server";

export type {
  AnalyticsViewer,
  CourseCountryRevenue,
  CourseFunnel,
  CourseProgressSummary,
  FunnelLesson,
  InstructorAnalytics,
  QuizPassRate,
  RefundExposure,
  RevenueSeries,
} from "./lib/analytics.server";

/**
 * Instructor analytics bound to one database. Tests build their own from an
 * in-memory database; the route uses `instructorAnalytics`.
 *
 * `get` returns the whole analytics page for one viewer, from the page's raw
 * search params. Nothing in `params` is trusted. A non-admin is pinned to
 * their own figures whatever `instructor` says, and a `course` the resolved
 * instructor does not own is treated as no course selected rather than
 * rejected. Junk values fall back to the defaults.
 *
 * `now` is the only clock: every range start, chart bucket and refund "today"
 * is measured from it, so one request cannot straddle midnight.
 */
export function createInstructorAnalytics(db: Db) {
  return {
    get(viewer: AnalyticsViewer, params: URLSearchParams, now: Date) {
      return buildInstructorAnalytics(db, viewer, params, now);
    },
  };
}

export const instructorAnalytics = createInstructorAnalytics(appDb);
