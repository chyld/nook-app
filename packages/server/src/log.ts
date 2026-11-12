// Logs go to standard output (journald through Docker). DESIGN 13: for each request only the
// method, the route pattern, the status and the time taken. Never query strings, bodies, note
// text, file names or passwords.

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (msg) => process.stdout.write(`${msg}\n`),
  error: (msg) => process.stderr.write(`${msg}\n`),
};

export const silentLogger: Logger = { info: () => {}, error: () => {} };
