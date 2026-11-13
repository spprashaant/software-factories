import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  localFileTransport,
  notify,
  recordingTransport,
  type Notification,
  type NotificationTransport,
} from "./notifications.server";

const refundOpened: Notification = {
  kind: "refund-opened",
  recipients: [
    { id: 3, name: "Pat Admin" },
    { id: 4, name: "Quinn Admin" },
  ],
  actor: { id: 1, name: "Liam Buyer" },
  data: {
    refundRequestId: 7,
    courseId: 2,
    courseTitle: "Intro to TypeScript",
    purchaseKind: "individual_purchase",
  },
  idempotencyKey: "refund-opened:7",
  arrivesRead: false,
};

describe("notify", () => {
  it("hands every Notification to the transport", async () => {
    const transport = recordingTransport();

    await notify([refundOpened], transport);

    expect(transport.sent).toEqual([refundOpened]);
  });

  it("writes each Notification to a local folder when there is no Knock key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "notifications-"));

    await notify([refundOpened], localFileTransport(directory));

    const files = readdirSync(directory);
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
    expect(written).toEqual(refundOpened);
  });

  it("does not throw when the transport fails", async () => {
    const broken: NotificationTransport = {
      async send() {
        throw new Error("Knock is down");
      },
    };

    await expect(notify([refundOpened], broken)).resolves.toBeUndefined();
  });

  it("still sends the rest when one Notification fails", async () => {
    const recording = recordingTransport();
    let calls = 0;
    const flaky: NotificationTransport = {
      async send(notification) {
        calls += 1;
        if (calls === 1) throw new Error("Knock is down");
        await recording.send(notification);
      },
    };
    const second = { ...refundOpened, idempotencyKey: "refund-opened:8" };

    await notify([refundOpened, second], flaky);

    expect(recording.sent).toEqual([second]);
  });

  it("gives up on a transport that hangs", async () => {
    const hanging: NotificationTransport = {
      send: () => new Promise(() => {}),
    };

    await expect(
      notify([refundOpened], hanging, { timeoutMs: 10 })
    ).resolves.toBeUndefined();
  });
});
