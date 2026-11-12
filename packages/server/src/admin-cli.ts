#!/usr/bin/env node
// notes-admin: talks to the running server through its admin socket (SPEC2 5).
//
//   notes-admin add-user <username>          asks for the password at a hidden prompt
//   notes-admin reset-password <username>
//   notes-admin remove-user <username>
//   notes-admin list-users
//   notes-admin new-id                      a fresh note id, for a note added by hand (4.5)
//   notes-admin pause-writes | resume-writes | backup-done
//
// When standard input is not a terminal, the password is read from its first line, so that
// scripts can use `docker compose exec -T app notes-admin add-user bob < password-file`.

import net from "node:net";

const SOCKET = process.env.NOTES_ADMIN_SOCKET ?? "/run/notes/admin.sock";
const USAGE = `usage: notes-admin add-user|reset-password|remove-user <username>
       notes-admin list-users|new-id|pause-writes|resume-writes|backup-done`;

async function hiddenPrompt(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // First line of standard input.
    let data = "";
    for await (const chunk of stdin) {
      data += chunk;
      if (data.includes("\n")) break;
    }
    return data.split(/\r?\n/)[0];
  }
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let pw = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(pw);
          return;
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") pw = [...pw].slice(0, -1).join("");
        else pw += c;
      }
    };
    stdin.on("data", onData);
  });
}

function send(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (c) => (buf += c));
    sock.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new Error("no answer from the server"));
      }
    });
    sock.on("error", reject);
  });
}

async function main(): Promise<number> {
  const [command, username] = process.argv.slice(2);
  const needsName = ["add-user", "reset-password", "remove-user"];
  const plain = ["list-users", "new-id", "pause-writes", "resume-writes", "backup-done"];
  if (!command || (!needsName.includes(command) && !plain.includes(command)) || (needsName.includes(command) && !username)) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }
  const req: Record<string, unknown> = { command };
  if (username) req.username = username;
  if (command === "add-user" || command === "reset-password") {
    const pw = await hiddenPrompt("Password (at least 12 characters): ");
    if (process.stdin.isTTY) {
      const again = await hiddenPrompt("Again: ");
      if (again !== pw) {
        process.stderr.write("The passwords differ.\n");
        return 1;
      }
    }
    req.password = pw;
  }
  let res: Record<string, unknown>;
  try {
    res = await send(req);
  } catch (e) {
    process.stderr.write(`Cannot reach the server at ${SOCKET}: ${(e as Error).message}\n`);
    return 1;
  }
  if (!res.ok) {
    process.stderr.write(`${res.error}\n`);
    return 1;
  }
  if (res.users) {
    for (const u of res.users as { username: string; id: string; created: string }[]) {
      process.stdout.write(`${u.username}\t${u.id}\t${u.created}\n`);
    }
  } else {
    process.stdout.write(`${res.message}\n`);
  }
  // resume-writes fails when the pause was no longer in force, so the backup script stops.
  if (command === "resume-writes" && res.wasPaused === false) return 3;
  return 0;
}

process.exitCode = await main();
