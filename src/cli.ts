import { parseArgs } from "node:util";
import { ensureBaseThemes } from "./keycloak-themes.ts";
import { startRenderer } from "./renderer-process.ts";
import { startPreviewServer } from "./preview-server.ts";
import { CONFIG_FILE, CONFIG_KEYS, loadConfig } from "./config.ts";
import { mockModelCatalog } from "./mock-models.ts";
import { resolveThemeChain } from "./theme-chain.ts";
import { addStories, listPages, type ThemePage } from "./scaffold.ts";
import { DEFAULT_STORY, storyUrl } from "./stories.ts";
import { createInterface } from "node:readline";
import path from "node:path";

const USAGE = `Usage: ftl-preview <command>

Commands:
  serve [--port <n>] [--lenient]
                       Start the preview server. --port overrides the configured port. --lenient
                       turns off strict mode: missing Mock model values are skipped (and logged)
                       instead of failing the render; it overrides "strict" in the config
  add-story [--page <page>]... [--story <name>]
                       Scaffold: add a Story (default name: Default) for Pages of the Theme or its
                       Base theme. Without --page, lists every Page and asks which to add
  model <page>         Print the default Mock model of a Page (e.g. login.ftl) as JSON: the
                       fields a Story can override

Config: optional ${CONFIG_FILE} at the project root, with the keys ${CONFIG_KEYS.join(", ")}.`;

/** Progress goes to stderr, so stdout carries only a command's result. */
const progress = (msg: string) => console.error(msg);

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "serve") return serve(rest);
  if (command === "model") return model(rest);
  if (command === "add-story") return addStory(rest);
  console.error(USAGE);
  process.exitCode = 1;
}

async function serve(args: string[]) {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, lenient: { type: "boolean" } } });
  if (values.port !== undefined && (!/^\d+$/.test(values.port) || Number(values.port) > 65535)) {
    throw new Error(`Invalid --port: ${values.port} (expected 0-65535)`);
  }
  const config = await loadConfig(process.cwd());

  const baseThemesDir = await ensureBaseThemes(config.keycloakVersion, config.mavenRepository, progress);

  const mockModels = await mockModelCatalog(config.keycloakVersion, config.themeType);
  if (mockModels.warning) console.warn(mockModels.warning);

  const renderer = await startRenderer();
  const server = await startPreviewServer({
    renderer,
    loginThemeDir: config.themeDir,
    baseThemesDir,
    storiesDir: config.storiesDir,
    strict: config.strict && !values.lenient,
    mockModels,
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

async function addStory(args: string[]) {
  const { values } = parseArgs({ args, options: { page: { type: "string", multiple: true }, story: { type: "string" } } });
  const config = await loadConfig(process.cwd());
  const baseThemesDir = await ensureBaseThemes(config.keycloakVersion, config.mavenRepository, progress);
  const themePages = await listPages(await resolveThemeChain(config.themeDir, baseThemesDir, config.themeType));
  const mockModels = await mockModelCatalog(config.keycloakVersion, config.themeType);
  if (mockModels.warning) console.warn(mockModels.warning);
  const withDefaults = new Set(await mockModels.pages());

  let pages = values.page ?? [];
  let name = values.story;
  if (pages.length === 0) {
    const answers = stdinPrompts();
    console.log("Pages of the Theme and its Base theme:");
    themePages.forEach((p, i) => console.log(`  ${String(i + 1).padStart(3)}. ${pageLabel(p, config.themeDir, withDefaults)}`));
    const choice = await answers.ask("Pages to add a Story for (numbers or names, comma-separated): ");
    pages = choice
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => (/^\d+$/.test(c) ? (themePages[Number(c) - 1]?.page ?? c) : c));
    name ??= (await answers.ask(`Story name [${DEFAULT_STORY}]: `)).trim() || undefined;
    answers.close();
  }
  name = (name ?? DEFAULT_STORY).trim();
  if (pages.length === 0) throw new Error("No Pages chosen");
  if (name === "") throw new Error("The Story name must not be empty");
  const unknown = pages.filter((page) => !themePages.some((p) => p.page === page));
  if (unknown.length > 0) throw new Error(`Not a Page of the Theme or its Base theme: ${unknown.join(", ")}`);

  const written = await addStories(config.storiesDir, [...new Set(pages)], name);
  for (const [page, file] of written) {
    console.log(`Added Story "${name}" for ${page} to ${path.relative(process.cwd(), file)}: ${storyUrl(config.themeType, page, name)}`);
    if (!withDefaults.has(page)) {
      console.warn(`Warning: ${page} has no default Mock model yet, so its Stories cannot render until one is added.`);
    }
  }
}

function pageLabel(page: ThemePage, themeDir: string | undefined, withDefaults: Set<string>): string {
  // Base themes are extracted to theme/<name>/<type>
  const origin = page.themeDir === themeDir ? "Theme" : `Base theme ${path.basename(path.dirname(page.themeDir))}`;
  const note = withDefaults.has(page.page) ? "" : ", no default Mock model yet";
  return `${page.page.padEnd(45)} (${origin}${note})`;
}

/** Prompts answered line by line from stdin; works for a terminal and for piped input. */
function stdinPrompts() {
  const rl = createInterface({ input: process.stdin });
  const iterator = rl[Symbol.asyncIterator]();
  return {
    async ask(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      const { value, done } = await iterator.next();
      return done ? "" : value;
    },
    close: () => rl.close(),
  };
}

async function model(args: string[]) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length !== 1) throw new Error(`Usage: ftl-preview model <page>, e.g. ftl-preview model login.ftl`);
  const [page] = positionals;
  const config = await loadConfig(process.cwd());
  const mockModels = await mockModelCatalog(config.keycloakVersion, config.themeType);
  // stdout carries only the JSON, so it can be piped
  if (mockModels.warning) console.warn(mockModels.warning);

  const defaults = await mockModels.defaultFor(page);
  if (!defaults) {
    const pages = await mockModels.pages();
    throw new Error(`No default Mock model for ${page}. Pages with one: ${pages.join(", ")}`);
  }
  console.log(JSON.stringify(defaults, null, 2));
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
