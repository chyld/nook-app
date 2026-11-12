// The child of storage.test.ts's `crashAt` (review, 42): a server on the folder given, one
// request, and SIGKILL at the step named, so no clean-up code of the server runs, as in a real
// crash. Exits 3 if the request finished without reaching the step.

import { faults } from "../src/fsutil.ts";
import { Client, startServer } from "./http.ts";

const job = JSON.parse(process.argv[2]) as { root: string; step: string; cookie: string; method: string; url: string; body?: unknown; text?: string; headers?: Record<string, string> };
const s = await startServer({}, job.root);
const c = new Client(s.app);
c.cookie = job.cookie;
faults.before = (name) => {
  if (name === job.step) process.kill(process.pid, "SIGKILL");
};
await c.req(job.method, job.url, job.text !== undefined ? Buffer.from(job.text, "utf8") : job.body, job.headers ?? {});
process.exit(3);
