# Knock setup

Cadence sends Notifications through Knock and reads the Notification Feed from
Knock's headless feed API. Without `KNOCK_API_KEY`, Notifications are written
to `.outbox/notifications/` and the bell is hidden, so none of this is needed
to work locally.

This list covers what code can't do. Workflows themselves live in
`knock/workflows.ts` and are pushed with `npm run knock:push-workflows`.

## Environment variables

| Variable                 | Where it comes from                                                 | Used by                    |
| ------------------------ | ------------------------------------------------------------------- | -------------------------- |
| `KNOCK_API_KEY`          | Dashboard → Developers → API keys → secret key (per environment)    | Server, triggers workflows |
| `KNOCK_SIGNING_KEY`      | Dashboard → Developers → API keys → signing key (RS256 private key) | Server, signs user tokens  |
| `KNOCK_PUBLIC_API_KEY`   | Dashboard → Developers → API keys → public key                      | Browser, reads the feed    |
| `KNOCK_FEED_CHANNEL_ID`  | Dashboard → Integrations → Channels → the in-app feed channel's id  | Browser, reads the feed    |
| `KNOCK_SERVICE_TOKEN`    | Dashboard → Account settings → Service tokens (see below)           | `knock:push-workflows`     |
| `KNOCK_FEED_CHANNEL_KEY` | The in-app feed channel's key. Optional, defaults to `in-app-feed`  | `knock:push-workflows`     |

## One-off steps (by hand)

1. **Create `KNOCK_SERVICE_TOKEN`.** In the Knock dashboard, open Account
   settings → Service tokens, create a token for Cadence, and put it in `.env`
   as `KNOCK_SERVICE_TOKEN`. It's shown once. It never goes to the browser or
   to Production servers.
2. **Enhanced security on the in-app feed.** In each environment, under
   Developers → API keys, turn on "Enhanced security mode" so the feed only
   accepts a signed user token for its own user. Check it by hand: with one
   user's token, `GET /v1/users/<another id>/feeds/<channel id>` must be
   rejected.

## Development

1. Run `npm run knock:push-workflows`. It upserts and commits every workflow
   in `knock/workflows.ts` in Development. A trigger for an uncommitted
   workflow returns 404, so run it again whenever a workflow is added.
2. The environment default preference set already holds
   `categories.enrollment: false`.

## Production (each deploy that adds or changes a workflow)

These can't be pushed from code:

1. **Promote the workflows.** In the dashboard, open Commits, and promote the
   Development commits for the new or changed workflows to Production.
2. **Environment default preference set.** In Production, set the default
   preference set to hold `categories.enrollment: false`, so Instructors get
   Enrollment Notifications only after opting in. Set it once.
3. **Production keys.** Set `KNOCK_API_KEY`, `KNOCK_SIGNING_KEY`,
   `KNOCK_PUBLIC_API_KEY` and `KNOCK_FEED_CHANNEL_ID` from the Production
   environment on the Production servers.

## Workflows

| Key                   | Catalogue row                             | Category               | Channel     |
| --------------------- | ----------------------------------------- | ---------------------- | ----------- |
| `refund-opened`       | 1, Refund Request opened                  | `refund-requests`      | In-app feed |
| `refund-approved`     | 2, Refund Request approved                | `my-refunds`           | In-app feed |
| `refund-declined`     | 3, Refund Request declined                | `my-refunds`           | In-app feed |
| `seat-claimed`        | 4, Seat claimed                           | `seat-claims`          | In-app feed |
| `enrollment`          | 5, Enrollment created                     | `enrollment`           | In-app feed |
| `discussion-question` | 6, Discussion Question asked              | `discussion-questions` | In-app feed |
| `discussion-reply`    | 7, Discussion Reply posted                | `discussion-replies`   | In-app feed |
| `refund-received`     | 8, Refund Request received (arrives read) | `my-refunds`           | In-app feed |

The `enrollment` category key is fixed: the environment default preference
set (Development set; Production step 2 above) uses it to keep Enrollment
Notifications off until an Instructor opts in.

## Categories

`/settings` reads and writes each user's `default` preference set (category
keys only, `merge` strategy). The code-side list in
`app/lib/notification-categories.ts` must match these keys and defaults.
Without `KNOCK_API_KEY`, preferences go to `.outbox/preferences/<userId>.json`.

| Key                    | Label                     | Who sees the toggle | Default |
| ---------------------- | ------------------------- | ------------------- | ------- |
| `refund-requests`      | Refund Requests to review | Platform Admins     | On      |
| `my-refunds`           | Your refunds              | Students (buyers)   | On      |
| `seat-claims`          | Seat claims               | Students (Team Admins) | On   |
| `enrollment`           | Enrollments               | Instructors         | **Off** |
| `discussion-questions` | Discussion Questions      | Instructors         | On      |
| `discussion-replies`   | Discussion Replies        | Everyone            | On      |
