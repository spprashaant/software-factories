# Knock setup

Cadence sends Notifications through Knock and reads the Notification Feed from
Knock's headless feed API. Without `KNOCK_API_KEY`, Notifications are written
to `.outbox/notifications/` and the bell is hidden, so none of this is needed
to work locally.

Workflows, their categories and the Enrollment default are code: the
workflows live in `knock/workflows.ts` (each kind's category comes from
`app/lib/notification-kinds.ts`), and `npm run knock:push-workflows` sets them
up through Knock's Management API. Only the three steps below are done by hand
in the dashboard.

## By hand

### 1. Service token (once)

- [ ] Account settings → Service tokens: create a token for Cadence and put it
      in `.env` as `KNOCK_SERVICE_TOKEN`. It's shown once. It is only used by
      `knock:push-workflows`, never by the app, the browser or Production
      servers.

### 2. In-app feed channel (once)

- [ ] Integrations → Channels: there is one **in-app feed** channel. Its
      channel id is `KNOCK_FEED_CHANNEL_ID`; the push script looks up its key
      from that id.

### 3. Keys (per environment)

Pick the environment (Development or Production) in the dashboard's
environment switcher, then:

- [ ] Developers → API keys: turn on **Enhanced security mode**, so the feed
      only accepts a signed user token for its own user. Knock's Management
      API can't set this. Check it: with one user's token,
      `GET /v1/users/<another id>/feeds/<channel id>` is rejected (403).
- [ ] Set these on the servers for this environment (`.env` locally):

| Variable                | Where it comes from                                     | Used by                    |
| ----------------------- | ------------------------------------------------------- | -------------------------- |
| `KNOCK_API_KEY`         | Developers → API keys → secret key                      | Server, triggers workflows |
| `KNOCK_SIGNING_KEY`     | Developers → API keys → signing key (RS256 private key) | Server, signs user tokens  |
| `KNOCK_PUBLIC_API_KEY`  | Developers → API keys → public key                      | Browser, reads the feed    |
| `KNOCK_FEED_CHANNEL_ID` | Integrations → Channels → the in-app feed channel's id  | Browser, reads the feed    |
| `KNOCK_SERVICE_TOKEN`   | Step 1. Local `.env` only                               | `knock:push-workflows`     |

## From code

### Development

Run `npm run knock:push-workflows` whenever a Notification kind is added or
its workflow changes. Every step is safe to repeat. It:

1. upserts each category into the project's preference category catalog (a
   workflow can't be tagged with a category Knock doesn't know);
2. upserts and commits each workflow in Development, with a single in-app feed
   step and its one category. A trigger for a key Knock doesn't have, or an
   uncommitted workflow, returns 404 and the Notification is dropped;
3. makes sure Development's environment default preference set holds
   `categories.enrollment: false`, keeping any other keys in it.

### Production

Run `npm run knock:push-workflows -- --production`. It does everything above,
then promotes each Cadence workflow's commits to Production (only those
workflows, not other pending changes) and makes sure Production's default holds
`categories.enrollment: false`.

## Workflows

| Key                   | Catalogue row                             | Category               |
| --------------------- | ----------------------------------------- | ---------------------- |
| `refund-opened`       | 1, Refund Request opened                  | `refund-requests`      |
| `refund-approved`     | 2, Refund Request approved                | `my-refunds`           |
| `refund-declined`     | 3, Refund Request declined                | `my-refunds`           |
| `seat-claimed`        | 4, Seat claimed                           | `seat-claims`          |
| `enrollment`          | 5, Enrollment created                     | `enrollment`           |
| `discussion-question` | 6, Discussion Question asked              | `discussion-questions` |
| `discussion-reply`    | 7, Discussion Reply posted                | `discussion-replies`   |
| `refund-received`     | 8, Refund Request received (arrives read) | `my-refunds`           |

Cadence renders its own row titles and links (`app/lib/notification-kinds.ts`),
so the templates in `knock/workflows.ts` only affect Knock's dashboard and
previews. The `enrollment` category key is fixed because the environment
default uses it to keep Enrollment Notifications off until an Instructor opts
in.

## Categories

`/settings` reads and writes each user's `default` preference set (category
keys only, `merge` strategy). The code-side list in
`app/lib/notification-categories.ts` must match these keys and defaults.
Without `KNOCK_API_KEY`, preferences go to `.outbox/preferences/<userId>.json`,
and Notifications in a muted category aren't written to `.outbox/`.

| Key                    | Label                     | Who sees the toggle                     | Default |
| ---------------------- | ------------------------- | --------------------------------------- | ------- |
| `refund-requests`      | Refund Requests to review | Platform Admins                         | On      |
| `my-refunds`           | Your refunds              | Everyone (anyone can buy)               | On      |
| `seat-claims`          | Seat claims               | Everyone (anyone can buy Team Licences) | On      |
| `enrollment`           | Enrollments               | Instructors                             | **Off** |
| `discussion-questions` | Discussion Questions      | Instructors                             | On      |
| `discussion-replies`   | Discussion Replies        | Everyone                                | On      |
