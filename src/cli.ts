#!/usr/bin/env node
import { parseArgs } from "node:util";
import { DEFAULT_KEYCLOAK_VERSION, ensureBaseThemes } from "./keycloak-themes.ts";
import { startRenderer } from "./renderer-process.ts";
import { startPreviewServer } from "./preview-server.ts";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_PORT = 6006;

const USAGE = `Usage: ftl-preview <command>

Commands:
  serve [--port <n>] [--lenient]
                       Start the preview server. --lenient turns off strict mode: missing
                       Mock model values are skipped (and logged) instead of failing the render`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "serve") return serve(rest);
  console.error(USAGE);
  process.exitCode = 1;
}

async function serve(args: string[]) {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, lenient: { type: "boolean" } } });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!/^\d+$/.test(values.port ?? String(DEFAULT_PORT)) || port > 65535) {
    throw new Error(`Invalid --port: ${values.port} (expected 0-65535)`);
  }

  const log = (msg: string) => console.log(msg);
  const baseThemesDir = await ensureBaseThemes(DEFAULT_KEYCLOAK_VERSION, log);
  // Zero config: the customer login Theme lives in theme/login; without it the Base theme renders alone
  const themeDirCandidate = path.resolve("theme", "login");
  const loginThemeDir = existsSync(themeDirCandidate) ? themeDirCandidate : undefined;

  // Zero config: Story files live in stories/
  const storiesDir = path.resolve("stories");

  const renderer = await startRenderer();
  const server = await startPreviewServer({
    renderer,
    loginThemeDir,
    baseThemesDir,
    storiesDir,
    strict: !values.lenient,
    port,
  });

  const shutdown = async () => {
    await server.close();
    renderer.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(`Preview running at ${server.url}`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
