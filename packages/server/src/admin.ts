// SPEC2 5: the admin socket. `notes-admin` (admin-cli.ts) sends one JSON line and reads one JSON
// line back. The socket's folder has mode 0700 and the socket mode 0600.

import * as fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { newNoteId } from "../../contract/src/index.ts";
import type { Context } from "./context.ts";
import { HttpError } from "./errors.ts";

export interface AdminRequest {
  command: string;
  username?: string;
  password?: string;
}

export async function handleAdmin(ctx: Context, req: AdminRequest): Promise<Record<string, unknown>> {
  switch (req.command) {
    case "add-user": {
      const u = await ctx.addUser(req.username ?? "", req.password ?? "");
      return { ok: true, message: `Added ${u.username} (user id ${u.id}).` };
    }
    case "reset-password":
      await ctx.accounts.resetPassword(req.username ?? "", req.password ?? "");
      return { ok: true, message: `Password set; all sessions of ${req.username} ended.` };
    case "remove-user": {
      const folder = await ctx.removeUser(req.username ?? "");
      return { ok: true, message: `Removed ${req.username}. Their notes are in removed/${folder}/ until deleted by hand.` };
    }
    case "list-users":
      return { ok: true, users: ctx.accounts.users.map((u) => ({ username: u.username, id: u.id, created: u.created })) };
    case "new-id":
      return { ok: true, message: newNoteId() };
    case "pause-writes":
      await ctx.pauseWrites();
      return { ok: true, message: "Writes paused (for at most two minutes)." };
    case "resume-writes": {
      const held = ctx.resumeWrites();
      return { ok: true, wasPaused: held, message: held ? "Writes resumed." : "The pause was no longer in force." };
    }
    case "backup-done": {
      const t = await ctx.backupDone();
      return { ok: true, message: `Backup time recorded: ${t}` };
    }
    default:
      throw new HttpError(400, "Unknown command.");
  }
}

export async function startAdminSocket(ctx: Context, socketPath: string): Promise<net.Server> {
  const dir = path.dirname(socketPath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
  await fs.rm(socketPath, { force: true });
  const server = net.createServer((sock) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => {
      buf += chunk;
      if (buf.length > 4096) return sock.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      void (async () => {
        let out: Record<string, unknown>;
        try {
          out = await handleAdmin(ctx, JSON.parse(line) as AdminRequest);
        } catch (e) {
          out = { ok: false, error: e instanceof HttpError ? e.message : "The command failed." };
          if (!(e instanceof HttpError)) ctx.log.error(`admin command failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`);
        }
        sock.end(JSON.stringify(out) + "\n");
      })();
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await fs.chmod(socketPath, 0o600);
  return server;
}
