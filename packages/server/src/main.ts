// The server process (SPEC2 4.1, rule 1): one Node process for everything.

import { buildApp } from "./app.ts";
import { startAdminSocket } from "./admin.ts";
import { configFromEnv } from "./config.ts";
import { Context } from "./context.ts";
import { consoleLogger } from "./log.ts";

const config = configFromEnv();
const ctx = new Context(config, consoleLogger);
await ctx.start();
const app = await buildApp(ctx);
const admin = await startAdminSocket(ctx, config.adminSocket);

// Ended sessions are removed at startup (in ctx.start) and once a day.
const daily = setInterval(() => void ctx.accounts.removeEndedSessions().catch(() => {}), 24 * 3600 * 1000);
daily.unref();

await app.listen({ host: config.host, port: config.port });
consoleLogger.info(`notes: listening on ${config.host}:${config.port}`);

const stop = async () => {
  clearInterval(daily);
  admin.close();
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
