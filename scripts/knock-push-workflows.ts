// Sets Knock up from code through the Management API:
//
//   npm run knock:push-workflows                  # Development
//   npm run knock:push-workflows -- --production  # then promote to Production
//
// 1. Upserts every category in knock/workflows.ts into the project's
//    preference category catalog (a workflow can't be tagged otherwise).
// 2. Upserts and commits every workflow in Development, with one in-app feed
//    step on the channel whose id is KNOCK_FEED_CHANNEL_ID.
// 3. Makes sure Development's environment default preference set holds
//    `categories.enrollment: false`, keeping its other keys.
// 4. With --production: promotes each of those workflows' commits to
//    Production and makes sure Production's default holds the same.
//
// Needs KNOCK_SERVICE_TOKEN and KNOCK_FEED_CHANNEL_ID (see docs/knock-setup.md).
// Every step is safe to run again.
import { z } from "zod";
import { workflows, type KnockWorkflow } from "../knock/workflows";

const MANAGEMENT_API = "https://control.knock.app/v1";

try {
  process.loadEnvFile();
} catch {
  // No .env file: use whatever the environment already has.
}

const serviceToken = process.env.KNOCK_SERVICE_TOKEN;
const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID;
const toProduction = process.argv.includes("--production");

if (!serviceToken || !feedChannelId) {
  console.error(
    "KNOCK_SERVICE_TOKEN and KNOCK_FEED_CHANNEL_ID must both be set. See docs/knock-setup.md."
  );
  process.exit(1);
}

async function knock(path: string, init: RequestInit = {}) {
  const response = await fetch(`${MANAGEMENT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Runs one step, printing ✓ or ✗. Returns false if it failed. */
async function step(label: string, run: () => Promise<unknown>) {
  try {
    await run();
    console.log(`✓ ${label}`);
    return true;
  } catch (error) {
    console.error(
      `✗ ${label}: ${error instanceof Error ? error.message : error}`
    );
    return false;
  }
}

const channelsSchema = z.object({
  entries: z.array(z.object({ id: z.string(), key: z.string() })),
});

// The workflow step names its channel by key; the app knows it by id.
async function feedChannelKeyFor(id: string) {
  const channel = channelsSchema
    .parse(await knock("/channels"))
    .entries.find((entry) => entry.id === id);
  if (!channel) {
    throw new Error(
      `No channel has id ${id} (KNOCK_FEED_CHANNEL_ID). Check it against Integrations → Channels.`
    );
  }
  return channel.key;
}

async function pushWorkflow(workflow: KnockWorkflow, feedChannelKey: string) {
  const query = new URLSearchParams({
    environment: "development",
    commit: "true",
    commit_message: `Push ${workflow.key} from Cadence`,
  });
  await knock(`/workflows/${workflow.key}?${query}`, {
    method: "PUT",
    body: JSON.stringify({
      workflow: {
        name: workflow.name,
        categories: [workflow.category],
        steps: [
          {
            type: "channel",
            channel_key: feedChannelKey,
            ref: "in_app_feed",
            name: "In-app feed",
            template: {
              markdown_body: workflow.markdownBody,
              action_url: workflow.actionUrl,
            },
          },
        ],
      },
    }),
  });
}

const defaultsSchema = z.object({
  preference_set: z
    .object({ categories: z.record(z.string(), z.unknown()).optional() })
    .passthrough()
    .nullable(),
});

// The default replaces in full, so read it and keep everything else.
async function keepEnrollmentOffByDefault(environment: string) {
  const path = `/environments/${environment}/defaults`;
  const current = defaultsSchema.parse(await knock(path)).preference_set ?? {};
  if (current.categories?.enrollment === false) return;
  await knock(path, {
    method: "PUT",
    body: JSON.stringify({
      preference_set: {
        ...current,
        categories: { ...current.categories, enrollment: false },
      },
    }),
  });
}

async function promoteWorkflow(workflow: KnockWorkflow) {
  const query = new URLSearchParams({
    to_environment: "production",
    resource_type: "workflow",
    resource_id: workflow.key,
  });
  await knock(`/commits/promote?${query}`, { method: "PUT" });
}

let ok = true;
let feedChannelKey = "";
ok &&= await step("feed channel", async () => {
  feedChannelKey = await feedChannelKeyFor(feedChannelId);
});

if (ok) {
  for (const category of new Set(workflows.map((w) => w.category))) {
    ok =
      (await step(`category ${category}`, () =>
        knock(`/preference_categories/${encodeURIComponent(category)}`, {
          method: "PUT",
        })
      )) && ok;
  }
  for (const workflow of workflows) {
    ok =
      (await step(
        `${workflow.key} (${workflow.category}) pushed and committed`,
        () => pushWorkflow(workflow, feedChannelKey)
      )) && ok;
  }
  ok =
    (await step("development default: enrollment off", () =>
      keepEnrollmentOffByDefault("development")
    )) && ok;
}

if (ok && toProduction) {
  for (const workflow of workflows) {
    ok =
      (await step(`${workflow.key} promoted to production`, () =>
        promoteWorkflow(workflow)
      )) && ok;
  }
  ok =
    (await step("production default: enrollment off", () =>
      keepEnrollmentOffByDefault("production")
    )) && ok;
} else if (toProduction) {
  console.error("Not promoting to production: fix the errors above first.");
}

process.exit(ok ? 0 : 1);
