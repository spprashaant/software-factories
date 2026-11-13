import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
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

    await expect(notify([refundOpened], broken)).resolves.toHaveProperty(
      "settled"
    );
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

  it("finishes the arrives-read step after the send timeout, without waiting for it", async () => {
    const steps: string[] = [];
    const slowFollowUp: NotificationTransport = {
      async send() {
        steps.push("triggered");
        return async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          steps.push("marked read");
        };
      },
    };

    const { settled } = await notify([refundOpened], slowFollowUp, {
      timeoutMs: 10,
    });
    expect(steps).toEqual(["triggered"]);

    await settled;
    expect(steps).toEqual(["triggered", "marked read"]);
  });

  it("does not throw when the arrives-read step fails", async () => {
    const failingFollowUp: NotificationTransport = {
      async send() {
        return async () => {
          throw new Error("Knock is down");
        };
      },
    };

    const { settled } = await notify([refundOpened], failingFollowUp);

    await expect(settled).resolves.toBeUndefined();
  });

  it("over Knock, sends an arrives-read Notification with the trigger alone and leaves marking it read to the follow-up", async () => {
    const requests: string[] = [];
    const transport = knockTransport("sk_test", {
      fetch: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ workflow_run_id: "run_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const receipt: Notification = {
      ...refundOpened,
      kind: "refund-received",
      recipients: [{ id: 1, name: "Liam Buyer" }],
      actor: null,
      idempotencyKey: "refund-received:7",
      arrivesRead: true,
    };

    const followUp = await transport.send(receipt);

    expect(requests).toEqual([
      "https://api.knock.app/v1/workflows/refund-received/trigger",
    ]);
    expect(followUp).toBeTypeOf("function");
  });

  it("gives up on a transport that hangs", async () => {
    const hanging: NotificationTransport = {
      send: () => new Promise(() => {}),
    };

    await expect(
      notify([refundOpened], hanging, { timeoutMs: 10 })
    ).resolves.toHaveProperty("settled");
  });
});

describe("muted categories, without Knock", () => {
  // Knock skips a recipient who muted the workflow's category. The recording
  // and local-file transports do the same, so local behaviour matches.
  function localFile() {
    const directory = mkdtempSync(join(tmpdir(), "notifications-"));
    const transport = localFileTransport(directory, {
      preferencesDirectory: mkdtempSync(join(tmpdir(), "preferences-")),
    });
    const written = (): Notification[] =>
      existsSync(directory)
        ? readdirSync(directory).map((file) =>
            JSON.parse(readFileSync(join(directory, file), "utf8"))
          )
        : [];
    return { transport, written };
  }

  function recording() {
    const transport = recordingTransport();
    return { transport, written: () => transport.sent };
  }

  const receipt: Notification = {
    kind: "refund-received",
    recipients: [{ id: 1, name: "Liam Buyer" }],
    actor: null,
    data: { refundRequestId: 7 },
    idempotencyKey: "refund-received:7",
    arrivesRead: true,
  };

  const enrollment: Notification = {
    kind: "enrollment",
    recipients: [{ id: 9, name: "Ivy Instructor" }],
    actor: { id: 1, name: "Liam Buyer" },
    data: { enrollmentId: 5, courseId: 2, courseTitle: "Intro to TypeScript" },
    idempotencyKey: "enrollment:5",
    arrivesRead: false,
  };

  for (const [name, make] of Object.entries({
    recording,
    "local file": localFile,
  })) {
    describe(`over the ${name} transport`, () => {
      it("sends nothing to a recipient who muted the category", async () => {
        const { transport, written } = make();
        await transport.writePreference(1, "my-refunds", false);

        await notify([receipt], transport);

        expect(written()).toEqual([]);
      });

      it("still sends to the recipients who didn't mute it", async () => {
        const { transport, written } = make();
        await transport.writePreference(3, "refund-requests", false);

        await notify([refundOpened], transport);

        expect(written().map((n) => n.recipients)).toEqual([
          [{ id: 4, name: "Quinn Admin" }],
        ]);
      });

      it("holds Enrollments back until the Instructor opts in", async () => {
        const { transport, written } = make();

        await notify([enrollment], transport);
        expect(written()).toEqual([]);

        await transport.writePreference(9, "enrollment", true);
        await notify([enrollment], transport);
        expect(written()).toEqual([enrollment]);
      });
    });
  }
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

    it("ignores categories Cadence doesn't know", async () => {
      const transport = knockAnswering(200, {
        id: "default",
        categories: { "spike-probe": false, "seat-claims": false },
      });

      expect(await transport.readPreferences(5)).toEqual({
        "seat-claims": false,
      });
    });
  });
});
