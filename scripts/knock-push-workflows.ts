// Pushes the Knock workflows in knock/workflows.ts to Knock's Development
// environment through the Management API, then commits them so triggers work.
//
//   npm run knock:push-workflows
//
// Needs KNOCK_SERVICE_TOKEN (a Knock service token, created by hand in the
// dashboard: see docs/knock-setup.md). KNOCK_FEED_CHANNEL_KEY names the in-app
// feed channel's key, `in-app-feed` by default.
import { workflows, type KnockWorkflow } from "../knock/workflows";

const MANAGEMENT_API = "https://control.knock.app/v1";
const ENVIRONMENT = "development";

try {
  process.loadEnvFile();
} catch {
  // No .env file: use whatever the environment already has.
}

const serviceToken = process.env.KNOCK_SERVICE_TOKEN;
const feedChannelKey = process.env.KNOCK_FEED_CHANNEL_KEY || "in-app-feed";

if (!serviceToken) {
  console.error(
    "KNOCK_SERVICE_TOKEN is not set. Create a service token in the Knock dashboard (see docs/knock-setup.md) and add it to .env."
  );
  process.exit(1);
}

async function push(workflow: KnockWorkflow) {
  const url = new URL(`${MANAGEMENT_API}/workflows/${workflow.key}`);
  url.searchParams.set("environment", ENVIRONMENT);
  url.searchParams.set("commit", "true");
  url.searchParams.set("commit_message", `Push ${workflow.key} from Cadence`);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
    },
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

  if (!response.ok) {
    throw new Error(
      `${workflow.key}: ${response.status} ${await response.text()}`
    );
  }
  console.log(`✓ ${workflow.key} (${workflow.category}) pushed and committed`);
}

let failed = false;
for (const workflow of workflows) {
  try {
    await push(workflow);
  } catch (error) {
    failed = true;
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
