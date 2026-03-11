export type Env = {
  AI: Ai;
  DB: D1Database;
  DataAgent: DurableObjectNamespace;
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
};

declare global {
  // Used to pass ctx.waitUntil to the Slack handler
  var __SLACK_WAIT_UNTIL: ((p: Promise<unknown>) => void) | undefined;
}
