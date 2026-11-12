// Settings, from the environment (compose.yaml sets them from .env; SPEC2 13).

import { LIMITS } from "../../contract/src/index.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface GoogleBases {
  /** Google's public font list (`/metadata/fonts`). */
  list: string;
  /** The CSS endpoint. */
  css: string;
  /** Where the font files are. */
  files: string;
}

export const GOOGLE: GoogleBases = {
  list: "https://fonts.google.com",
  css: "https://fonts.googleapis.com",
  files: "https://fonts.gstatic.com",
};

export interface Config {
  dataDir: string;
  host: string;
  port: number;
  adminSocket: string;
  /** Host name or address of the reverse proxy whose X-Forwarded-For is trusted. */
  trustedProxy: string | null;
  webDist: string;
  google: GoogleBases;
  /** Test only: allow http:// to the (fake) Google bases. */
  googleInsecure: boolean;
  /** How long a fetch from Google may take: 20 seconds (section 5); shorter in tests. */
  fontFetchMs: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const testBases = env.NOTES_TEST_GOOGLE_LIST && env.NOTES_TEST_GOOGLE_CSS && env.NOTES_TEST_GOOGLE_FILES;
  return {
    dataDir: env.NOTES_DATA ?? "/srv/notes",
    host: env.NOTES_HOST ?? "0.0.0.0",
    port: Number(env.NOTES_PORT ?? 3000),
    adminSocket: env.NOTES_ADMIN_SOCKET ?? "/run/notes/admin.sock",
    trustedProxy: env.NOTES_TRUSTED_PROXY || null,
    webDist: env.NOTES_WEB_DIST ?? path.join(here, "..", "..", "web", "dist"),
    google: testBases ? { list: env.NOTES_TEST_GOOGLE_LIST!, css: env.NOTES_TEST_GOOGLE_CSS!, files: env.NOTES_TEST_GOOGLE_FILES! } : GOOGLE,
    googleInsecure: Boolean(testBases) && env.NOTES_TEST_GOOGLE_INSECURE === "1",
    fontFetchMs: LIMITS.fontFetchMs,
  };
}
