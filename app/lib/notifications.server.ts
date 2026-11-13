import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Knock from "@knocklabs/node";
import { knockEnv } from "~/lib/knock.server";

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
  | "discussion-question"
  | "discussion-reply";

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

export interface NotificationTransport {
  send(notification: Notification): Promise<void>;
}

/**
 * Knock upserts recipients and actor inline from the trigger, which is the only
 * user sync: id is `String(user.id)` and only the name goes with it.
 *
 * TODO(row 8): "arrives read" should mark the recipient's new message seen and
 * read once the receipt Notification exists.
 */
export function knockTransport(apiKey: string): NotificationTransport {
  const knock = new Knock({ apiKey, maxRetries: 0 });
  const person = ({ id, name }: NotificationPerson) => ({
    id: String(id),
    name,
  });

  return {
    async send(notification) {
      await knock.workflows.trigger(
        notification.kind,
        {
          recipients: notification.recipients.map(person),
          actor: notification.actor ? person(notification.actor) : null,
          data: notification.data,
        },
        { idempotencyKey: notification.idempotencyKey }
      );
    },
  };
}

export function localFileTransport(directory: string): NotificationTransport {
  return {
    async send(notification) {
      mkdirSync(directory, { recursive: true });
      const key = notification.idempotencyKey.replace(/[^a-z0-9-]/gi, "-");
      const file = join(directory, `${Date.now()}-${key}.json`);
      writeFileSync(file, JSON.stringify(notification, null, 2));
    },
  };
}

/** Keeps what was sent in memory, for tests. */
export function recordingTransport(): NotificationTransport & {
  sent: Notification[];
} {
  const sent: Notification[] = [];
  return {
    sent,
    async send(notification) {
      sent.push(notification);
    },
  };
}

function defaultTransport(): NotificationTransport {
  const { apiKey } = knockEnv();
  return apiKey
    ? knockTransport(apiKey)
    : localFileTransport(join(".outbox", "notifications"));
}

// ─── Sending ───

const DEFAULT_TIMEOUT_MS = 3000;

function withTimeout(promise: Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sends Notifications after the action's write has committed. Fail-open: a
 * Notification that errors or times out is logged and dropped, so the action
 * still succeeds. No retries.
 */
export async function notify(
  notifications: Notification[],
  transport: NotificationTransport = defaultTransport(),
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<void> {
  await Promise.all(
    notifications.map(async (notification) => {
      try {
        await withTimeout(transport.send(notification), timeoutMs);
      } catch (error) {
        console.error(
          `Notification ${notification.idempotencyKey} was not sent:`,
          error
        );
      }
    })
  );
}
