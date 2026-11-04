#!/usr/bin/env node
import { parseArgs } from "node:util";
import { DEFAULT_KEYCLOAK_VERSION, ensureKeycloakThemesJar } from "./keycloak-themes.ts";
import { startRenderer } from "./renderer-process.ts";
import { startPreviewServer } from "./preview-server.ts";
import type { ThemeRoot } from "./renderer-process.ts";

const DEFAULT_PORT = 6006;

const USAGE = `Usage: ftl-preview <command>

Commands:
  serve [--port <n>]   Start the preview server`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "serve") return serve(rest);
  console.error(USAGE);
  process.exitCode = 1;
}

async function serve(args: string[]) {
  const { values } = parseArgs({ args, options: { port: { type: "string" } } });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!/^\d+$/.test(values.port ?? String(DEFAULT_PORT)) || port > 65535) {
    throw new Error(`Invalid --port: ${values.port} (expected 0-65535)`);
  }

  const log = (msg: string) => console.log(msg);
  const jar = await ensureKeycloakThemesJar(DEFAULT_KEYCLOAK_VERSION, log);
  // keycloak.v2 login chain as Keycloak builds it: theme, its import (common/keycloak), its parent (base).
  // Fixed until ticket 02 reads parent/import from theme.properties.
  const themes: ThemeRoot[] = [
    { jar, path: "theme/keycloak.v2/login" },
    { jar, path: "theme/keycloak/common" },
    { jar, path: "theme/base/login" },
  ];

  const renderer = await startRenderer();
  const server = await startPreviewServer({ renderer, themes, port });

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
