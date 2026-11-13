# How long does Knock keep feed messages?

Research for issue #26. Cadence keeps no copy of its Notifications, so Knock's retention rules decide how long a Notification exists at all. Sources were read on 2026-11-13.

## Conclusion

Knock keeps **in-app feed items indefinitely on every plan, including Free**. The plan-based limit (30 days on Free and Starter, 90 days on Enterprise) applies only to the **message log**: message contents, events, delivery logs, and activities as seen in the Dashboard, the Management API, and the non-feed public API. Once that window passes, the feed item can still be fetched through the Feeds API and its status can still be updated. Custom retention windows are not self-serve. The pricing page says feed retention "can be configured", but the docs say custom retention is not supported and point you to support.

Knock has no documented way to hard-delete a single feed message. You can archive messages (one at a time, in batches, or in bulk per channel), and archiving only hides them from the default feed view. Archived messages are still stored and can be unarchived. The only documented hard delete of a user's messages is **deleting the user**, which removes all of that user's messages and logs. Knock presents this as the way to handle GDPR right-to-be-forgotten requests.

## Findings

### 1. Retention by plan

| Data | Free | Starter ($250/mo) | Enterprise |
| --- | --- | --- | --- |
| In-app feed items ("Feed retention") | Unlimited | Unlimited | Unlimited |
| Message log data, audit logs, workflow run logs, webhook delivery logs, source event logs | 30 days | 30 days | 90 days |
| API logs | 30 days | 30 days | 30 days |

- The pricing page lists three plans: **Free**, **Starter**, and **Enterprise**. It does not use the name "Developer". The "Developer tier" in the issue is taken to be the Free plan. Source: https://knock.app/pricing
- The pricing page row "Feed retention" is described as "The number of days a message stays in your users' feeds", with the value "No limit, but can be configured." on Free and "Unlimited" across the plan columns. "Log retention" is "30-day retention" on Free and Starter and "90-day retention" on Enterprise. Source: https://knock.app/pricing
- The docs say: "Some Knock data is subject to a retention policy based on your account plan… **Enterprise plans**: 90 days. **All other plans**: 30 days." That policy covers audit logs, message log data, outbound webhook delivery logs, source event and action logs, and workflow run logs. API logs have "a universal, 30-day retention policy". Source: https://docs.knock.app/manage-your-account/data-retention
- After the retention period, data "will no longer be accessible in the Knock Dashboard, the Management API, or the public API. Knock will eventually prune data that has aged out of its retention period." Source: same page.

**Feed visibility and message log retention are separate.** The data retention page says:

> "In-app feed notifications are available indefinitely. Even after your message log data has expired, you can still fetch the associated `FeedItem` data from the Show feed endpoint … You can also still use the message status update endpoints to update the status of these feed items. These status updates will still generate new message events and trigger your outbound webhooks, even though you will not be able to view the message in the Knock Dashboard any longer."

The messages concept page says the same: "Message log data in the Dashboard and the public API are subject to retention policy enforcement. In-app message data and the Feeds API are not." Source: https://docs.knock.app/concepts/messages

Consequences for Cadence:
- After 30 days (Free or Starter), a Notification is still visible in the user's feed, but `GET /v1/messages/{id}`, the message events and delivery logs, and the Dashboard message view will stop returning it. The feed endpoint `GET /v1/users/{user_id}/feeds/{channel_id}` is then the only read path.
- Workflow branch conditions that check message status "will always evaluate to a false result" for a message past the retention window. Source: https://docs.knock.app/llms-full.txt (status conditions section of the branch function docs).
- Merging users only moves "the past 30 days of message history" of the secondary user to the primary ("If you need to retain more than 30 days worth of history, please contact us."). Source: https://docs.knock.app/managing-recipients/merging-users (seen in https://docs.knock.app/llms-full.txt)

### 2. Is retention configurable?

- The docs say: "**Custom retention policies are not currently supported.** If custom retention windows are critical to your usage of Knock, please click the 'Contact support' button…" Source: https://docs.knock.app/manage-your-account/data-retention
- The pricing page says feed retention "can be configured", but I found **no documented setting** (per environment, per channel, or as a plan add-on) for doing so. **Unconfirmed:** this is probably handled by support on request. The docs don't describe how.
- The only documented way to get longer log retention is the Enterprise plan (90 days instead of 30).

### 3. Archiving and deleting messages through the API

Per-message endpoints (https://docs.knock.app/api-reference/messages):
- `PUT /v1/messages/{message_id}/seen`, `/read`, `/interacted`, and `/archived` set a status. `DELETE` on the same paths (`/seen`, `/read`, `/archived`) removes it, so `DELETE …/archived` unarchives the message.
- **There is no endpoint that deletes a message.** The only `DELETE` verbs on messages remove a status.
- Archive is described as: "Archived messages are hidden from the default message list in the feed but can still be accessed and unarchived later."

Batch endpoints (same page):
- `POST /v1/messages/batch/{seen|unseen|read|unread|interacted|archived|unarchived}` take a list of `message_ids`. The page states no batch size limit (unconfirmed).

Bulk per channel (https://docs.knock.app/api-reference/channels/bulk/update_message_status):
- `POST /v1/channels/{channel_id}/messages/bulk/{action}` runs asynchronously and returns a `BulkOperation` with a `progress_path`.
- Filters: `recipient_ids` (this is how you target one user), `archived` (`exclude|include|only`), `engagement_status`, `delivery_status`, `older_than`, `newer_than`, `tenants`, `has_tenant`, `workflows`, `trigger_data`.
- "For in-app channels, messages can be updated indefinitely via this operation. For all other channel types, messages outside the account's retention window will not be updated."
- The docs name only `archive` and `unarchive` as example actions. Knock's generated Node SDK (built from their OpenAPI spec) gives the full `action` enum as `seen | unseen | read | unread | archived | unarchived | interacted | archive | unarchive | delete`. Source: https://github.com/knocklabs/knock-node/blob/main/src/resources/channels/bulk.ts. **Unconfirmed:** the prose docs never mention a `delete` bulk action or say whether it hard-deletes messages or purges them from the feed. Test it before relying on it.

Feeds and archived messages:
- "by default all `archived` messages are excluded from the feed." The feed endpoint accepts `archived=exclude|include|only` and `status=unread|read|unseen|seen|all`. Sources: https://docs.knock.app/in-app-ui/api-overview and https://github.com/knocklabs/knock-node/blob/main/src/resources/users/feeds.ts
- **Archived messages are still retained.** They are hidden, not removed, and can be fetched with `archived=only` or `include`, and unarchived.
- `FeedMetadata.total_count` is "The total number of messages the user has for this in-app channel". **Unconfirmed:** whether `total_count`, `unread_count`, and `unseen_count` include archived items. Source: https://docs.knock.app/in-app-ui/api-overview
- Archived messages still count toward billing. **Unconfirmed**, but very likely: billing is per message sent (https://knock.app/pricing), so archiving after delivery would not change the count.

### 4. What deleting a user does to their messages

From https://docs.knock.app/managing-recipients/deleting-users, deleting a user is a "**hard delete**" of:
- all system and custom properties, preferences, channel data, subscriptions, and schedules
- "All messages sent to that user, including the content of those messages and any debugging events associated"
- "All activity associated with a user, including the workflow run logs the user was a recipient of"

Also from that page:
- "deletion requests can take up to 10 minutes to process. During this time, you may still see some data associated with the user."
- The deleted data "cannot be recovered". You can re-identify a user with the same ID afterwards, and that creates a new user.
- Endpoints: `DELETE /v1/users/{user_id}` and `POST /v1/users/bulk/delete`, which "Permanently deletes up to 1,000 users at a time" and runs async as a `BulkOperation`. Source: https://docs.knock.app/api-reference/users/bulk/delete
- Users can also be deleted one at a time from the Dashboard.

### 5. GDPR and data deletion

- "Knock provides a programmatic user deletion API that you can use to hard delete users and the data associated with users. This can be especially useful in fulfilling GDPR right-to-be-forgotten requests." The FAQ suggests using the single-user endpoint, or batching "deletion requests per-day using our bulk delete endpoint." Source: https://docs.knock.app/managing-recipients/deleting-users
- Changelog, 2023-10-11: "Now we permanently delete all content associated with a user upon receiving a deletion request … Knock user deletion is now fully GDPR-compliant." Before that, these requests went through support. Source: https://knock.app/changelog/2023-10-11
- Knock says it is "SOC 2 Type 2 compliant, GDPR certified, CCPA, and HIPAA compliant", and its DPA and SOC 2 report are in the trust center. Sources: https://docs.knock.app/developer-tools/security and https://trust.knock.app (I did not read the DPA itself).
- Related privacy controls: dashboard data obfuscation and "filtered log keys", which keep chosen keys out of stored logs. Source: https://docs.knock.app/manage-your-account/data-obfuscation
- Deleting the whole account removes all data, including message history and logs. Source: https://docs.knock.app/manage-your-account/account-deletion
- **Not documented:** a way to erase a single Notification's content without deleting the user (for example, to remove one message containing personal data). The candidates are archive, which keeps the data, and the undocumented bulk `delete` action.

## Open questions to check with Knock or by testing

1. What does `POST /v1/channels/{channel_id}/messages/bulk/delete` do? Does it hard-delete feed items, and is it enabled on the Free plan?
2. What does "can be configured" for feed retention on the pricing page mean in practice? Is it a support-set TTL, and can it be set per environment or per channel?
3. Do the `FeedMetadata` counts include archived items?
4. When message logs are pruned after 30 days, does the `FeedItem` still have its full rendered content (`blocks`) and `data`? The docs say "FeedItem data" stays available, but they don't list which fields.
