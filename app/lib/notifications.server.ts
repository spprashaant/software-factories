import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Knock, { NotFoundError } from "@knocklabs/node";
import { knockEnv } from "~/lib/knock.server";
import type {
  CategoryPreferences,
  NotificationCategory,
} from "~/lib/notification-categories";

// ─── Notifications ───
// A Notification is a plain description that services return next to their
// result and route actions hand to `notify()` once the database write has
// committed. Services never talk to Knock.
//
// Knock delivers every Notification when KNOCK_API_KEY is set. Without a key
// (local dev) each one is written to .outbox/notifications/ as a JSON file
// instead, mirroring `sendEmail()` in mailer.server.ts.

/**
 * One row of the v1 catalogue. Each kind is also the key of the Knock
 * workflow that delivers it (see knock/workflows.ts).
 */
export type NotificationKind =
  | "refund-opened"
  | "refund-approved"
  | "refund-declined"
  | "seat-claimed"
  | "enrollment"
  | "discussion-question"
  | "discussion-reply"
  | "refund-received";

export type NotificationPerson = { id: number; name: string };

/**
 * Only ids, people's names and course/lesson titles go in `data`. Never text a
 * person wrote: no refund reason, no decision note, no Discussion text.
 */
export type NotificationData = Record<string, string | number>;

export type Notification = {
  kind: NotificationKind;
  recipients: NotificationPerson[];
  actor: NotificationPerson | null;
  data: NotificationData;
  /** One per event and recipient group, e.g. `refund-opened:<refundRequestId>`. */
  idempotencyKey: string;
  /** True only for the buyer's receipt for their own Refund Request. */
  arrivesRead: boolean;
};

// ─── Transports ───

/**
 * Work a transport still has to do once a Notification is sent, such as
 * marking an arrives-read Notification read. `notify()` runs it after the
 * send, outside the send's timeout and without holding up the action.
 */
export type FollowUp = () => Promise<void>;

export interface NotificationTransport {
  send(notification: Notification): Promise<FollowUp | void>;
}

/**
 * A user's category preferences (/settings). Reads return only what the user
 * has chosen; `notificationSettingsFor()` fills in the defaults. A write
 * changes one category and leaves the others as they were.
 */
export interface PreferenceStore {
  readPreferences(userId: number): Promise<CategoryPreferences>;
  writePreference(
    userId: number,
    category: NotificationCategory,
    enabled: boolean
  ): Promise<void>;
}

/** Knock's default preference set, which Notifications are checked against. */
const KNOCK_PREFERENCE_SET = "default";

/**
 * Knock upserts recipients and actor inline from the trigger, which is the only
 * user sync: id is `String(user.id)` and only the name goes with it.
 *
 * For a Notification that arrives read, the send returns a follow-up that
 * finds the messages the trigger made and marks them seen and read, so the
 * badge never counts them. Knock creates messages asynchronously, so it looks
 * a few times.
 */
export function knockTransport(
  apiKey: string,
  { fetch }: { fetch?: typeof globalThis.fetch } = {}
): NotificationTransport & PreferenceStore {
  const knock = new Knock({ apiKey, maxRetries: 0, fetch });
  const person = ({ id, name }: NotificationPerson) => ({
    id: String(id),
    name,
  });

  return {
    async send(notification) {
      const { workflow_run_id } = await knock.workflows.trigger(
        notification.kind,
        {
          recipients: notification.recipients.map(person),
          actor: notification.actor ? person(notification.actor) : null,
          data: notification.data,
        },
        { idempotencyKey: notification.idempotencyKey }
      );

      if (notification.arrivesRead) {
        return () => markRunSeenAndRead(knock, workflow_run_id, notification);
      }
    },

    async readPreferences(userId) {
      try {
        const set = await knock.users.getPreferences(
          String(userId),
          KNOCK_PREFERENCE_SET
        );
        const preferences: CategoryPreferences = {};
        for (const [category, setting] of Object.entries(
          set.categories ?? {}
        )) {
          // A settings object (per-channel or conditions) still means "on".
          preferences[category as NotificationCategory] = setting !== false;
        }
        return preferences;
      } catch (error) {
        // Knock doesn't know the user until their first Notification.
        if (error instanceof NotFoundError) return {};
        throw error;
      }
    },

    async writePreference(userId, category, enabled) {
      await knock.users.setPreferences(String(userId), KNOCK_PREFERENCE_SET, {
        __persistence_strategy__: "merge",
        categories: { [category]: enabled },
      });
    },
  };
}

const ARRIVES_READ_ATTEMPTS = 5;
const ARRIVES_READ_DELAY_MS = 300;

async function markRunSeenAndRead(
  knock: Knock,
  workflowRunId: string,
  notification: Notification
) {
  const pending = new Set(notification.recipients.map(({ id }) => String(id)));

  for (let attempt = 0; attempt < ARRIVES_READ_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, ARRIVES_READ_DELAY_MS));

    for (const userId of [...pending]) {
      const messageIds: string[] = [];
      for await (const message of knock.users.listMessages(userId, {
        workflow_run_id: workflowRunId,
      })) {
        if (message.id) messageIds.push(message.id);
      }
      if (messageIds.length === 0) continue;

      await knock.messages.batch.markAsSeen({ message_ids: messageIds });
      await knock.messages.batch.markAsRead({ message_ids: messageIds });
      pending.delete(userId);
    }

    if (pending.size === 0) return;
  }

  throw new Error(
    `trigger sent, but its message was not found to mark read (run ${workflowRunId})`
  );
}

/**
 * Without a Knock key, Notifications go to `directory` and each user's
 * category preferences to `<preferencesDirectory>/<userId>.json`.
 */
export function localFileTransport(
  directory: string,
  {
    preferencesDirectory = join(directory, "..", "preferences"),
  }: { preferencesDirectory?: string } = {}
): NotificationTransport & PreferenceStore {
  const preferencesFile = (userId: number) =>
    join(preferencesDirectory, `${userId}.json`);

  const readPreferences = async (
    userId: number
  ): Promise<CategoryPreferences> => {
    const file = preferencesFile(userId);
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8"));
  };

  return {
    readPreferences,

    async writePreference(userId, category, enabled) {
      const preferences = await readPreferences(userId);
      mkdirSync(preferencesDirectory, { recursive: true });
      writeFileSync(
        preferencesFile(userId),
        JSON.stringify({ ...preferences, [category]: enabled }, null, 2)
      );
    },

    async send(notification) {
      mkdirSync(directory, { recursive: true });
      const key = notification.idempotencyKey.replace(/[^a-z0-9-]/gi, "-");
      const file = join(directory, `${Date.now()}-${key}.json`);
      writeFileSync(file, JSON.stringify(notification, null, 2));
    },
  };
}

/** Keeps what was sent in memory, for tests. */
export function recordingTransport(): NotificationTransport &
  PreferenceStore & { sent: Notification[] } {
  const sent: Notification[] = [];
  const preferences = new Map<number, CategoryPreferences>();
  return {
    sent,
    async readPreferences(userId) {
      return { ...preferences.get(userId) };
    },
    async writePreference(userId, category, enabled) {
      preferences.set(userId, {
        ...preferences.get(userId),
        [category]: enabled,
      });
    },
    async send(notification) {
      sent.push(notification);
    },
  };
}

/** Knock when KNOCK_API_KEY is set, otherwise local files under .outbox/. */
export function defaultTransport(): NotificationTransport & PreferenceStore {
  const { apiKey } = knockEnv();
  return apiKey
    ? knockTransport(apiKey)
    : localFileTransport(join(".outbox", "notifications"));
}

// ─── Sending ───

const DEFAULT_TIMEOUT_MS = 3000;
/** Long enough for Knock to create the messages a follow-up marks read. */
const DEFAULT_FOLLOW_UP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function logFailure(notification: Notification, error: unknown) {
  console.error(
    `Notification ${notification.idempotencyKey} was not sent:`,
    error
  );
}

export type NotifyResult = {
  /**
   * Resolves once every follow-up (such as marking an arrives-read
   * Notification read) has finished, failed or timed out. Never rejects.
   * Actions don't wait for it.
   */
  settled: Promise<void>;
};

/**
 * Sends Notifications after the action's write has committed. Fail-open: a
 * Notification that errors or times out is logged and dropped, so the action
 * still succeeds. No retries.
 *
 * Each send gets the short `timeoutMs`. A transport's follow-up runs after
 * it in the background with its own, longer timeout, so it is never cut off
 * by the send's timeout and never holds up the action.
 */
export async function notify(
  notifications: Notification[],
  transport: NotificationTransport = defaultTransport(),
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    followUpTimeoutMs = DEFAULT_FOLLOW_UP_TIMEOUT_MS,
  }: { timeoutMs?: number; followUpTimeoutMs?: number } = {}
): Promise<NotifyResult> {
  const followUps = await Promise.all(
    notifications.map(async (notification) => {
      try {
        const followUp = await withTimeout(
          transport.send(notification),
          timeoutMs
        );
        return followUp ? { notification, followUp } : null;
      } catch (error) {
        logFailure(notification, error);
        return null;
      }
    })
  );

  const settled = Promise.all(
    followUps
      .filter((pending) => pending !== null)
      .map(async ({ notification, followUp }) => {
        try {
          await withTimeout(followUp(), followUpTimeoutMs);
        } catch (error) {
          logFailure(notification, error);
        }
      })
  ).then(() => undefined);

  return { settled };
}
