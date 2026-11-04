import { parseArgs } from "node:util";
import { ensureBaseThemes } from "./keycloak-themes.ts";
import { startRenderer } from "./renderer-process.ts";
import { startPreviewServer } from "./preview-server.ts";
import { CONFIG_FILE, CONFIG_KEYS, loadConfig } from "./config.ts";
import { checkJava } from "./environment.ts";

const USAGE = `Usage: ftl-preview <command>

Commands:
  serve [--port <n>] [--lenient]
                       Start the preview server. --port overrides the configured port. --lenient
                       turns off strict mode: missing Mock model values are skipped (and logged)
                       instead of failing the render; it overrides "strict" in the config

Config: optional ${CONFIG_FILE} at the project root, with the keys ${CONFIG_KEYS.join(", ")}.`;

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "serve") return serve(rest);
  console.error(USAGE);
  process.exitCode = 1;
}

async function serve(args: string[]) {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, lenient: { type: "boolean" } } });
  if (values.port !== undefined && (!/^\d+$/.test(values.port) || Number(values.port) > 65535)) {
    throw new Error(`Invalid --port: ${values.port} (expected 0-65535)`);
  }
  const config = await loadConfig(process.cwd());

  // Java runs the Renderer and unpacks the Base theme jars
  await checkJava();

  const log = (msg: string) => console.log(msg);
  const baseThemesDir = await ensureBaseThemes(config.keycloakVersion, config.mavenRepository, log);

  const renderer = await startRenderer();
  const server = await startPreviewServer({
    renderer,
    loginThemeDir: config.themeDir,
    baseThemesDir,
    storiesDir: config.storiesDir,
    strict: config.strict && !values.lenient,
    port: values.port === undefined ? config.port : Number(values.port),
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
