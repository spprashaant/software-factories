# Hosted notification vendors for Cadence

All sources accessed 2026-11-13. These are desk research results only: no accounts were created and nothing was tested hands-on. Pricing changes often, so re-check the pricing pages before committing.

## Question

Which hosted notification vendors fit Cadence, and how do they compare? Cadence is a video-course web app (React Router v7, SQLite). It needs in-app Notifications shown in a Notification Feed we build ourselves, plus email and possibly web push.

Hard criteria:

1. Usable free tier for development.
2. Per-user feed auth: the browser reads only its own Notifications, using a token our server signs or mints.
3. Preferences stored by the vendor, per category and per category x channel.
4. A headless feed API or SDK, with no prebuilt UI forced on us.
5. Hosted SaaS.

We also report on email delivery, web push, delayed or scheduled steps, batching and digests, idempotency keys on the trigger API, and pricing above the free tier.

## Summary

- **Knock** is the only candidate that meets all five hard criteria on its free plan and also has delay, batch and idempotency with no documented plan gate. It has no first-party web push: browser push goes through FCM. Its first paid tier jumps to $250/month.
- **Novu Cloud** meets the criteria with one caveat. Preferences are stored per workflow x channel, and "categories" are workflow tags grouped in the client. The Free plan caps delay and digest at 1 day, which rules out multi-day nudges until we pay. Its first paid tier is the cheapest of the group (from $30/month), but idempotency has to be enabled by Novu support.
- **Courier** meets the hard criteria, and its pay-as-you-go pricing ($0.005 per send) is simple. However, the pricing page lists digest and batching under Enterprise only, and web push goes through third-party providers.
- **MagicBell** meets the hard criteria and has native VAPID web push. Its free tier is small (1,000 deliveries per month), it has no documented digest or batching, and its v2 API reference shows no idempotency key.
- **SuprSend** has strong features on paper, but the pricing page leaves "Channel Preferences", "Categories & Sub-category preferences", "Batching" and "Digest" out of the Free and Essentials plans. That fails criterion 3 on the free tier after the 30-day trial ends.
- **Excluded:** OneSignal has no stored per-user Notification history. Engagespot's marketing site and pricing page currently fail to load ("Site Not Found"), so the vendor cannot be verified.

## Comparison table

Legend: Yes / No / Partial. The bracketed numbers are footnotes that point to the Sources list.

| Vendor | 1. Free tier | 2. Per-user feed auth | 3. Prefs: category, category x channel | 4. Headless feed SDK/API | 5. Hosted | Email | Web push | Delay / scheduled steps | Batch / digest | Idempotency on trigger | Paid pricing |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Knock** | Yes. 10,000 messages/mo, no card, no hard cap [K1] | Yes. RS256 JWT signed by our server (`sub` = user id), required once "enhanced security mode" is on [K2] | Yes. `categories`, `channel_types`, and nested `categories.<x>.channel_types` [K3] | Yes. `@knocklabs/client`: `fetch`, `markAsRead`/`Seen`/`Archived`, websockets, `getPreferences`/`setPreferences` [K4][K5] | Yes | Yes, through our own provider (Resend, Postmark, SES, SendGrid, etc.). The built-in Knock provider is for testing only [K6] | Partial. No first-party web push; goes through FCM [K7] | Yes. Fixed delay or delay until a timestamp, max 365 days [K8] | Yes. Batch step with key, sliding window, max 90 days. No scheduled recurring digest [K9] | Yes. `Idempotency-Key` header on workflow trigger, 24h [K10] | Starter $250/mo with 50k messages, then $0.005 each [K1] |
| **Novu Cloud** | Yes. 10,000 runs/mo, 5 workflows, no card [N1] | Yes. HMAC-SHA256(secretKey, subscriberId) as `subscriberHash`, enforced when enabled [N2] | Partial. Per workflow x channel and global channel prefs are stored. "Categories" are workflow tags grouped in the client (`preferenceGroups`), with no stored category entity found [N3][N4] | Yes. `@novu/js`: `notifications.list`/`read`/`archive`, `preferences.list`/`update`/`bulkUpdate`, real-time events [N5] | Yes | Yes, through our own provider. A demo email integration exists for tests [N6] | Partial. Through FCM, OneSignal, Pusher Beams, Pushpad or Push Webhook [N7] | Yes. Fixed, scheduled, or dynamic (ISO timestamp). **Max 1 day on Free**, 7 on Pro, 30 on Team [N8][N9] | Yes. Regular and scheduled digest, max 1 day on Free [N10][N9] | Partial. `Idempotency-Key` header for POST/PATCH, 24h, **not enabled for all orgs; ask support** [N11] | Pro from $30/mo (30k runs), Team from $250/mo (250k runs). Overage $1.20 per 1k runs [N1] |
| **Courier** | Yes. Developer plan, 10,000 sends/mo [C1] | Yes. Our server calls `POST /auth/issue-token` with scopes `user_id:<id> inbox:read:messages ...`; Courier signs the JWT [C2] | Yes. Per subscription topic (opt-in/out/required) and per-topic `custom_routing` channels [C3] | Yes. `@trycourier/courier-js` is "without UI components": `getMessages`, `read`, `archive`, socket, `putUserPreferenceTopic` [C4] | Yes | Yes, through our own provider (SendGrid, SES, Postmark, Resend, etc.) [C5] | Partial. Through OneSignal or FCM providers [C6] | Yes. `delay.duration` / `delay.until` on send, plus Journeys [C7][C1] | Partial. Topic digests and a batch node exist [C8], but the pricing page lists "digest and batching" under **Enterprise** [C1] | Yes. `Idempotency-Key` header, 25h default, up to 1 year [C7] | Business $0.005 per send, with no included sends (50k = $250). Enterprise is custom [C1] |
| **MagicBell** | Partial. Builder plan, 1,000 deliveries/mo, counted per channel [M1] | Yes. HS256 User JWT signed with the project secret (`user_external_id` or `user_email`, plus `api_key`) [M2] | Yes. `UserPreferences` = categories, each with channels and `enabled` [M3][M4] | Yes. `UserClient`: `listNotifications`, `markNotificationRead`, `archiveNotification`, Realtime `listen` [M4] | Yes | Yes, through SES, Mailgun, SendGrid, SMTP, etc. [M5] | Yes. Web push channel with VAPID keys [M6] | Partial. Workflow `wait` command in seconds; doc depth is thin [M7][M4] | No. No digest or batch documented (found nothing) | Not found. No idempotency field in v2 API reference [M8] | Startup $249/mo with 50k deliveries, then $0.0025 each [M1] |
| **SuprSend** | Partial. 10,000 notifications/mo, but preferences, batch and digest are not on Free (30-day trial only) [S1] | Yes. ES256 JWT (`entity_type: subscriber`, `entity_id`) signed by our server, enforced in enhanced security mode [S2] | Yes (paid). Categories, plus channels within a category [S3]. **Business plan ($250/mo) only** [S1] | Yes. `@suprsend/web-sdk` feed client: `fetch`, `markAsRead`, `markAsArchived`, socket [S4] | Yes | Yes, through vendor integrations (not individually verified) | Yes. Native web push with VAPID key and service worker [S5] | Yes. Fixed, dynamic and relative delay [S6] | Yes (paid). Batch node and recurring digest [S7][S8], Business plan only [S1] | Yes. `idempotency_key` / `$idempotency_key` on trigger, 24h dedupe (stated for dynamic trigger) [S9] | Essentials $100/mo (50k, then $2 per 1k). Business $250/mo (50k, then $5 per 1k) [S1] |

## Per-vendor details

### Knock

- **Free tier:** $0. "Up to 10,000" messages per month, unlimited profiles, workflows and channels, no credit card, and no hard cap. Knock "will contact you about setting up billing" if usage exceeds the limit. [K1]
- **Auth:** Enhanced security mode is off by default. With it off, the public key alone can act as any user. With it on, client requests need a JWT signed RS256 with a signing key from the dashboard. The `sub` claim must be the user id, `exp` and `iat` are recommended, and `grants` can scope the token further. The Node SDK has `signUserToken` (default expiry 3600s), and the React provider has an `onUserTokenExpiring` hook. Tokens are signed locally, with no network round-trip to Knock. [K2]
- **Preferences:** A `PreferenceSet` has `categories`, `channel_types`, `channels` and `workflows` keys. Category x channel is expressed by nesting `channel_types` under a category. Defaults merge at the recipient, tenant and environment levels. [K3] The client SDK source has `getAllPreferences`, `getPreferences` and `setPreferences` on the user client. [K5]
- **Headless:** `@knocklabs/client` is "a low-level set of methods" for the Knock API, with managed websockets and optimistic feed state. [K4] The feed methods in the source include `fetch`, `fetchNextPage`, `markAsSeen`, `markAsRead`, `markAsUnread`, `markAsArchived`, `markAllAsRead`, `markAllAsArchived` and `markAsInteracted`. [K5]
- **Email:** Knock sends through our own provider: Amazon SES, Cloudflare Email, Mailgun, Postmark, Resend, SendGrid, SMTP and others. The "Knock (testing only)" provider is for testing. [K6]
- **Web push:** "Knock does not have a first-party web push channel". The browser gets an FCM token, which is stored as channel data, and messages go out through an FCM channel step. [K7]
- **Delay:** A fixed interval, or a dynamic delay until an ISO-8601 timestamp. Max 365 days. [K8]
- **Batch:** A per-recipient window (fixed, dynamic or sliding), a batch key, a max activity count, and max 90 days open. Knock says batch is not the same as a recurring digest and recommends that our system supply events for daily or weekly digests. Raising the render limit above 10 items is Enterprise only. [K9]
- **Idempotency:** The `Idempotency-Key` header (up to 255 chars) is honored only on `POST /workflows/:key/trigger`. Responses are cached for 24h, and only 2xx responses are cached. [K10]
- **Paid:** Starter costs $250/month, includes 50,000 messages, then $0.005 per message. Enterprise is custom. [K1]

### Novu Cloud

- **Free tier:** $0 for 10,000 workflow runs per month, 5 workflows, 2 environments, unlimited subscribers, all channels, no card. The vendor's "Activity feed retention" (its delivery log) is 24h. [N1] Novu does not stop or throttle sends over the limit, and the Free plan keeps in-app messages for 30 days. [N9]
- **Auth:** `subscriberHash = HMAC-SHA256(NOVU_SECRET_KEY, subscriberId)` as lowercase hex, enabled with the "Security HMAC encryption" toggle in the In-App provider settings. Once enabled, the feed will not load without it. The hash is static per user, with no expiry. [N2]
- **Preferences:** The layers are workflow defaults, subscriber global (per channel), and subscriber per-workflow (per channel). "Critical" workflows cannot be opted out of. Preferences are stored per environment, or per subscriber plus tenant. [N3] Grouping preferences "by category" goes through the client-side `preferenceGroups` prop, which filters workflows by tag. The docs describe no stored category-level entity, and say "Each workflow has its own set of channel preferences". [N4] That makes per-category preferences Partial: one Cadence category maps to a tag on several workflows, and a category toggle has to `bulkUpdate` each workflow.
- **Headless:** `@novu/js` uses `new Novu({ applicationIdentifier, subscriberId, subscriberHash })`. It offers `notifications.list`, `read` and `archive`, plus `preferences.list`, per-item `update` and `bulkUpdate`. [N5] Real-time events come through `novu.on("notifications.notification_received")`. [N12]
- **Email:** Novu sends through our own provider (SendGrid, SES, Resend, Postmark, Mailgun, SMTP and others). A "demo email integration" handles tests. [N6]
- **Web push:** Novu offers FCM, Expo, APNS, OneSignal, Push Webhook, Pusher Beams and Pushpad. The docs say push can reach "web" without detailing browser support per provider. [N7]
- **Delay:** Fixed, scheduled (in the subscriber's time zone), or dynamic (ISO timestamp or duration object). The max duration is "1 day on Free, 7 days on Pro, and 30 days on Team". [N8] This matters for time-based nudges: on Free, a "you haven't finished this lesson in 3 days" delay is not possible.
- **Digest:** A regular window, "when events repeat", or a scheduled digest (daily, weekly, etc., in the subscriber's time zone), with a grouping key. Max 1 day on Free. [N10]
- **Idempotency:** The `Idempotency-Key` header works on POST and PATCH with 24h caching. However, the "Idempotency feature is currently not enabled for all organizations", so we would need to contact support. It works only with API-key auth. [N11]
- **Paid:** Pro is from $30/month with 30,000+ runs. Team is from $250/month with 250,000+ runs. Overage is $1.20 per 1,000 runs. Enterprise is custom. [N1]

### Courier

- **Free tier:** The Developer plan includes 10,000 sends per month. A send is one template to one recipient, regardless of channel count. [C1]
- **Auth:** Our backend calls `POST /auth/issue-token` with the workspace API key and a space-separated scope (`user_id:<id>` is required; also `inbox:read:messages`, `inbox:write:events`, `read:preferences`, `write:preferences`). `expires_in` is optional, and leaving it out "mints a token that never expires". The SDKs do not refresh tokens. [C2] This differs from the other vendors because each token needs a network call to Courier. We do not sign tokens locally.
- **Preferences:** Subscription topics have a default of opt-in, opt-out or required, and are grouped into sections. Users can choose channels per topic (`custom_routing` / `has_custom_routing`) when channel selection is enabled for the section. Tenant defaults are supported. [C3]
- **Headless:** `@trycourier/courier-js` is described as a way to "Read and update inbox and preferences data in the browser without UI components" ("inbox" is the vendor's term). It provides `getMessages`, `read`, `archive`, `readAll`, `getUnreadMessageCount`, a socket with `addMessageEventListener`, and `getUserPreferences` / `putUserPreferenceTopic`. [C4]
- **Email:** Courier sends through our own provider, such as SendGrid, SES, Mailgun, Postmark, Resend or SMTP. Without one, sends fail with `MISSING_CONFIGURATION`. [C5]
- **Web push:** Courier's push providers include FCM, APNs, Expo, OneSignal, Pusher Beams, MagicBell and Beamer. Courier's own guides point to OneSignal for browser push. [C6]
- **Delay:** The Send API takes a `delay` object (`duration` in ms, `until` as ISO 8601 or an opening-hours expression, and `timezone`). [C7] Journeys are on the Developer plan. [C1]
- **Batch/digest:** Topic digest schedules (instant, daily, weekly), a Send to Digest node and a Batch node are all documented. [C8] The pricing page lists "digest and batching" as an **Enterprise** feature. [C1]
- **Idempotency:** The `Idempotency-Key` header on Send keeps the key 25h by default. `x-idempotency-expiration` can extend that to a maximum of 1 year. [C7]
- **Paid:** Business is $0.005 per send for every send, including the first 10,000 (50k sends = $250, 200k = $1,000). Enterprise has custom volume pricing. [C1]

### MagicBell

- **Free tier:** The Builder plan includes 1,000 deliveries per month and 1 project. Deliveries are counted per channel: a Notification sent in-app and by email counts as 2. [M1]
- **Auth:** "User JWTs must be signed with your project's Secret Key using the HS256 algorithm." Claims are `user_external_id` and/or `user_email`, plus `api_key`. The examples use a 1-year expiry. [M2] The legacy v1 API used an HMAC header (`X-MAGICBELL-USER-HMAC`). [M9]
- **Preferences:** `GET` and `PUT /channels/user_preferences` take a User JWT. The body lists categories, each with channels and an `enabled` flag. [M3][M4]
- **Headless:** The JS SDK `UserClient` has `listNotifications` (filter by `category` and `topic`), `markNotificationRead`, `markAllNotificationsRead`, `archiveNotification`, `fetchUserPreferences` and `saveUserPreferences`. A Realtime client offers `listen(callback)`. [M4]
- **Email:** MagicBell supports Amazon SES, Mailgun, Ping Email, SMTP and SendGrid. [M5]
- **Web push:** The web push channel takes VAPID public and private keys. [M6]
- **Delay:** Workflows support `broadcast`, `wait` (seconds), `pause` and `abort`, with "More commands coming soon". [M7] The SDK has `saveWorkflow` and `createWorkflowRun`. [M4]
- **Batch/digest:** We found no documentation for either.
- **Idempotency:** The `POST /broadcasts` reference shows no idempotency header. The body takes an optional `id` (uuid), but the docs do not say it deduplicates. [M8]
- **Paid:** Startup is $249/month with 50,000 deliveries, then $0.0025 each, and 5 projects. Enterprise is custom. [M1]

### SuprSend

- **Free tier:** $0 for 10,000 notifications per month, unlimited channels, and an in-app feed with SuprSend branding. [S1] In the pricing comparison table, "Channel Preferences", "Categories & Sub-category preferences", "Batching" and "Digest" all show dashes for Free and Essentials. The Business card lists "User Preferences" and "Batching & Digest". New workspaces get a 30-day trial of all features. [S1]
- **Auth:** An ES256 JWT signed with a key from the dashboard, with `entity_type: "subscriber"`, `entity_id` = distinct_id, `exp`, `iat`, and an optional tenant `scope`. "All requests will be rejected by SuprSend if enhanced security mode is on and signed user token is not provided." [S2]
- **Preferences:** Global channel restrictions, category opt-in/out, and channel opt-out within a category. Category opt-outs are checked at trigger time, and channel preferences at delivery. [S3]
- **Headless:** `@suprsend/web-sdk` has `identify(distinctId, userToken)`. The feed client from `feeds.initialize()` offers `fetch`, `fetchNextPage`, `markAsRead`, `markAsSeen`, `markAsArchived`, `markAllAsRead` and `initializeSocketConnection`. [S4][S10]
- **Web push:** Native, using a VAPID key from the dashboard, a hosted `serviceworker.js`, and `webpush.registerPush()`. [S5]
- **Delay:** Fixed (`xxd xxh xxm xxs`), dynamic (from the payload, ISO timestamp or duration), or relative to a future timestamp. [S6]
- **Batch/digest:** A batch node with a window, batch key and "flush first item immediately", plus a digest node on a recurring schedule that can be time-zone-aware. [S7][S8]
- **Idempotency:** An `idempotency_key` option in the SDKs, or `$idempotency_key` in REST bodies. The 24h dedupe window is stated on the dynamic workflow trigger reference. [S9]
- **Paid:** Essentials is $100/month ($1,200/year) with 50k notifications, then $2 per 1k. Business is $250/month ($3,000/year) with 50k, then $5 per 1k. Enterprise is custom. [S1]

## Excluded vendors

- **OneSignal:** It does not store a per-user Notification history. Its docs say it "does not currently store the history of messages sent to each individual user" and recommend storing copies on our own server. [O1] That fails criteria 2–4 for the Notification Feed. It remains a possible web push delivery provider behind Knock, Novu or Courier.
- **Engagespot:** Its docs describe a fitting feature set, including an RS256 JWT with `sub: "user:<id>"` and `apiKey` in secure mode. [E1] However, `https://engagespot.co/` currently returns "Site Not Found | Framer", and `/pricing` and `/pricing.php` return 404 (checked 2026-11-13 with curl and WebFetch). The free-tier and pricing figures we found came only from third-party directories, which are not primary sources. A vendor whose own site is down is a viability risk, so we excluded it until that changes.
- **Not evaluated:** NotificationAPI, Customer.io, Braze and Iterable. The last three are marketing-automation suites with no developer free tier aimed at a headless Notification Feed. NotificationAPI surfaced in searches but was not researched.

## Unverified / open items

1. **SuprSend plan gating:** The pricing page's check marks did not render as text. Our read that Free lacks preferences and digest comes from dashes in the table and from the Business card listing "User Preferences" and "Batching & Digest". Confirm on the live page or with sales.
2. **Novu Free-plan pricing table:** The table cells did not align when fetched. The 1-day delay and digest limit and the 30-day in-app retention come from the docs (Limits page and step pages), not the pricing table. The Limits page may be stale.
3. **Novu idempotency:** We don't know whether support will enable it for a Free organization.
4. **Novu category preferences:** No docs say whether `preferenceGroups` or `bulkUpdate` can express a single "category off" toggle atomically, or whether a stored category entity exists.
5. **Courier on the Developer plan:** The pricing page does not say whether the in-app channel, preferences and Journeys delay are limited on the free plan. It does list digest and batching under Enterprise, and it is unclear whether topic digests count as "digest".
6. **Courier web push:** No standalone first-party web push provider was found. FCM web support is mentioned only briefly.
7. **MagicBell:** No docs found for digests, batching, idempotency, or how mature and generally available workflows are ("More commands coming soon"). The auth label on the in-app notification list endpoints was cut off in the API reference.
8. **Knock web push through FCM:** We did not verify that Knock's FCM channel delivers to Safari or Firefox. Knock's tutorial covers only the FCM web flow.
9. **SuprSend email:** Specific vendors were not verified (the docs pages timed out).
10. **Knock Free plan:** The pricing page lists no feature gates for preferences, batch or delay on Free. Only the batch render limit above 10 is noted as Enterprise. We assume everything else is available on Free.
11. **Novu web push:** Browser support per provider (OneSignal, Pushpad, Pusher Beams) was not checked.
12. **Pricing in general:** All figures come from pages read on 2026-11-13 and should be re-checked before committing.

## Recommendation (input to the human's decision, not the decision)

**Top pick: Knock.** It meets all five hard criteria on the free plan, with no documented feature gates on preferences, delay or batch:

- Our server signs RS256 JWTs locally, which fits a React Router v7 loader that injects the token into the page.
- It stores a true category x channel-type preference model, which matches "per category and per category x channel" directly.
- Delays of up to 365 days cover course nudges.
- `Idempotency-Key` on trigger is on by default.

The trade-offs:

- Web push goes through FCM, so we would need a Firebase project.
- There is no built-in recurring digest. We would batch, or assemble digests ourselves.
- The first paid tier is $250/month.

**Runner-up: Novu Cloud.** It is the cheapest path past the free tier: Pro from $30/month, and overage of $1.20 per 1k runs versus Knock's $0.005 per message (about $5 per 1k). It has a real scheduled digest, and its HMAC subscriber hash is simple to generate. The trade-offs:

- Preferences are per workflow, so "category" has to be modeled with tags.
- The Free plan caps delay and digest at 1 day, so multi-day nudges cannot be tested without paying.
- Idempotency needs support to turn it on.
- The HMAC hash never expires, unlike a short-lived JWT.

What separates them:

- **Shape of the preference model:** Knock has native categories. Novu uses workflows plus tags.
- **Delay ceiling on Free:** 365 days on Knock, 1 day on Novu.
- **Cost after the free tier:** Novu is cheaper at low volume.
- **Token model:** Knock uses an expiring JWT. Novu uses a static HMAC.

Courier is a reasonable third choice if per-send pricing matters more than digests, which it gates to Enterprise.

## Sources

All accessed 2026-11-13.

- [K1] https://knock.app/pricing
- [K2] https://docs.knock.app/in-app-ui/security-and-authentication
- [K3] https://docs.knock.app/preferences/overview
- [K4] https://docs.knock.app/in-app-ui/javascript/overview
- [K5] https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/users/index.ts and https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts
- [K6] https://docs.knock.app/integrations/email/overview
- [K7] https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm
- [K8] https://docs.knock.app/designing-workflows/delay-function
- [K9] https://docs.knock.app/designing-workflows/batch-function
- [K10] https://docs.knock.app/api-reference/overview/idempotent-requests
- [N1] https://novu.co/pricing
- [N2] https://docs.novu.co/platform/inbox/prepare-for-production
- [N3] https://docs.novu.co/platform/concepts/preferences
- [N4] https://docs.novu.co/platform/inbox/configuration/preferences
- [N5] https://docs.novu.co/platform/sdks/javascript
- [N6] https://docs.novu.co/platform/integrations/email
- [N7] https://docs.novu.co/platform/integrations/push
- [N8] https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/delay
- [N9] https://docs.novu.co/platform/developer/limits and https://docs.novu.co/platform/account/billing
- [N10] https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest
- [N11] https://docs.novu.co/api-reference/idempotency
- [N12] https://docs.novu.co/platform/inbox/headless/get-started
- [C1] https://www.courier.com/pricing
- [C2] https://www.courier.com/docs/platform/inbox/authentication
- [C3] https://www.courier.com/docs/platform/preferences/
- [C4] https://www.courier.com/docs/sdk-libraries/courier-js-web
- [C5] https://www.courier.com/docs/integrations/overview
- [C6] https://www.courier.com/docs/integrations/push/overview
- [C7] https://www.courier.com/docs/api-reference/send/send-a-message
- [C8] https://www.courier.com/docs/guides/send-a-daily-digest
- [M1] https://www.magicbell.com/pricing
- [M2] https://www.magicbell.com/docs/api/authentication/user
- [M3] https://www.magicbell.com/docs/api/reference (User Preferences section)
- [M4] https://www.magicbell.com/docs/libraries/magicbell-js
- [M5] https://www.magicbell.com/docs/channels
- [M6] https://www.magicbell.com/docs/channels/web_push
- [M7] https://www.magicbell.com/workflows
- [M8] https://www.magicbell.com/docs/api/reference (Broadcasts section)
- [M9] https://magicbell.com/docs/v1
- [S1] https://www.suprsend.com/pricing
- [S2] https://docs.suprsend.com/docs/client-authentication
- [S3] https://docs.suprsend.com/docs/user-preferences
- [S4] https://docs.suprsend.com/docs/js-inapp-feed
- [S5] https://docs.suprsend.com/docs/react-webpush.md
- [S6] https://docs.suprsend.com/docs/delay.md
- [S7] https://docs.suprsend.com/docs/batch.md
- [S8] https://docs.suprsend.com/docs/digest.md
- [S9] https://docs.suprsend.com/reference/dynamic-workflow-trigger and https://docs.suprsend.com/docs/node-trigger-workflow-from-api
- [S10] https://docs.suprsend.com/docs/javascript-sdk
- [O1] https://documentation.onesignal.com/docs/en/create-an-activity-feed
- [E1] https://docs.engagespot.co/docs/features/in-app-inbox/authentication
