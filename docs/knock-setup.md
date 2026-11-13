# Knock setup

Cadence sends Notifications through Knock and reads the Notification Feed from
Knock's headless feed API. Without `KNOCK_API_KEY`, Notifications are written
to `.outbox/notifications/` and the bell is hidden, so none of this is needed
to work locally.

Knock is set up by hand in the dashboard. Work through the checklist below
once for **Development** and once for **Production**, and again whenever a
Notification kind is added or changed. Every key must match the code exactly:
kinds and their categories live in `app/lib/notification-kinds.ts`, category
labels and defaults in `app/lib/notification-categories.ts`.

## Checklist, per environment

Pick the environment (Development or Production) in the dashboard's
environment switcher before each step.

### 1. In-app feed channel

- [ ] Integrations → Channels: there is one **in-app feed** channel. Note its
      channel id for `KNOCK_FEED_CHANNEL_ID`.

### 2. Workflows

Workflows → Create workflow, once per row below. For each one:

- [ ] **Key** exactly as in the table. A trigger for a key Knock doesn't have
      returns 404 and the Notification is dropped.
- [ ] **Categories**: exactly the one category in the table. This is what the
      toggles on `/settings` mute.
- [ ] **Steps**: a single **in-app feed** channel step. No email, SMS, push or
      chat steps.
- [ ] In the in-app feed step's template, set the markdown body and action URL
      from the table. Cadence renders its own row titles and links, so these
      only affect Knock's dashboard and previews.
- [ ] **Commit** the workflow to this environment. An uncommitted workflow
      also answers triggers with 404.

| Key                   | Catalogue row                             | Category               | Markdown body                                                                          | Action URL                                                                                |
| --------------------- | ----------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `refund-opened`       | 1, Refund Request opened                  | `refund-requests`      | `**{{ actor.name }}** asked for a refund on **{{ data.courseTitle }}**`                | `/admin/refunds`                                                                          |
| `refund-approved`     | 2, Refund Request approved                | `my-refunds`           | `Your refund for **{{ data.courseTitle }}** was approved`                              | `{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}`         |
| `refund-declined`     | 3, Refund Request declined                | `my-refunds`           | `Your refund for **{{ data.courseTitle }}** was declined`                              | `{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}`         |
| `seat-claimed`        | 4, Seat claimed                           | `seat-claims`          | `**{{ actor.name }}** claimed a Seat on **{{ data.courseTitle }}**`                    | `/team`                                                                                   |
| `enrollment`          | 5, Enrollment created                     | `enrollment`           | `**{{ actor.name }}** enrolled on **{{ data.courseTitle }}**`                          | `/instructor/{{ data.courseId }}/students`                                                |
| `discussion-question` | 6, Discussion Question asked              | `discussion-questions` | `**{{ actor.name }}** asked on **{{ data.lessonTitle }}** in {{ data.courseTitle }}`   | `/courses/{{ data.courseSlug }}/lessons/{{ data.lessonId }}#comment-{{ data.commentId }}` |
| `discussion-reply`    | 7, Discussion Reply posted                | `discussion-replies`   | `**{{ actor.name }}** replied on **{{ data.lessonTitle }}** in {{ data.courseTitle }}` | `/courses/{{ data.courseSlug }}/lessons/{{ data.lessonId }}#comment-{{ data.commentId }}` |
| `refund-received`     | 8, Refund Request received (arrives read) | `my-refunds`           | `We've got your refund request for **{{ data.courseTitle }}**`                         | `{% if data.purchaseKind == 'team_licence' %}/team{% else %}/settings{% endif %}`         |

To promote to Production instead of building again, open Commits in
Development and promote the commits for the new or changed workflows, then
check each one in Production against the list above.

### 3. Environment default preference set

- [ ] Preferences → environment default preference set: set
      `categories.enrollment: false`. Instructors then get Enrollment
      Notifications only after opting in on `/settings`. Every other category
      stays on. Development already has this; set it once in Production.

The `enrollment` category key is fixed because this default uses it.

### 4. Enhanced security on the feed

- [ ] Developers → API keys: turn on **Enhanced security mode**, so the feed
      only accepts a signed user token for its own user.
- [ ] Check it: with one user's token,
      `GET /v1/users/<another id>/feeds/<channel id>` is rejected (403).

### 5. Keys

- [ ] Set these four from this environment's dashboard on the servers for
      this environment (`.env` locally):

| Variable                | Where it comes from                                             | Used by                    |
| ----------------------- | --------------------------------------------------------------- | -------------------------- |
| `KNOCK_API_KEY`         | Developers → API keys → secret key                              | Server, triggers workflows |
| `KNOCK_SIGNING_KEY`     | Developers → API keys → signing key (RS256 private key)         | Server, signs user tokens  |
| `KNOCK_PUBLIC_API_KEY`  | Developers → API keys → public key                              | Browser, reads the feed    |
| `KNOCK_FEED_CHANNEL_ID` | Integrations → Channels → the in-app feed channel's id (step 1) | Browser, reads the feed    |

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
