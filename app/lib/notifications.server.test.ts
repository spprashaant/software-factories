import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  knockTransport,
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

describe("category preferences", () => {
  const transports = {
    recording: () => recordingTransport(),
    "local file": () =>
      localFileTransport(mkdtempSync(join(tmpdir(), "notifications-")), {
        preferencesDirectory: mkdtempSync(join(tmpdir(), "preferences-")),
      }),
  };

  for (const [name, makeTransport] of Object.entries(transports)) {
    describe(`over the ${name} transport`, () => {
      it("has no choices for a user who hasn't chosen", async () => {
        const transport = makeTransport();

        expect(await transport.readPreferences(5)).toEqual({});
      });

      it("reads back what the user chose", async () => {
        const transport = makeTransport();

        await transport.writePreference(5, "my-refunds", false);

        expect(await transport.readPreferences(5)).toEqual({
          "my-refunds": false,
        });
      });

      it("leaves the other categories as they were", async () => {
        const transport = makeTransport();

        await transport.writePreference(5, "enrollment", true);
        await transport.writePreference(5, "discussion-questions", false);
        await transport.writePreference(5, "enrollment", false);

        expect(await transport.readPreferences(5)).toEqual({
          enrollment: false,
          "discussion-questions": false,
        });
      });

      it("keeps each user's choices apart", async () => {
        const transport = makeTransport();

        await transport.writePreference(5, "discussion-replies", false);

        expect(await transport.readPreferences(6)).toEqual({});
      });
    });
  }

  describe("over the Knock transport", () => {
    const knockAnswering = (status: number, body: unknown) =>
      knockTransport("sk_test", {
        fetch: async () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
      });

    it("has no choices for a user Knock doesn't know yet", async () => {
      const transport = knockAnswering(404, {
        code: "resource_missing",
        message: "The resource you requested does not exist",
      });

      expect(await transport.readPreferences(5)).toEqual({});
    });

    it("reads the user's category choices from their default preference set", async () => {
      const transport = knockAnswering(200, {
        id: "default",
        categories: { enrollment: true, "my-refunds": false },
      });

      expect(await transport.readPreferences(5)).toEqual({
        enrollment: true,
        "my-refunds": false,
      });
    });
  });
});
