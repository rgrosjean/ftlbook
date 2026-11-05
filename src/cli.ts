import { parseArgs } from "node:util";
import { startRenderer } from "./renderer-process.ts";
import { startPreviewServer } from "./preview-server.ts";
import { CONFIG_FILE, CONFIG_KEYS } from "./config.ts";
import { openProject, type Project, type ScaffoldPage } from "./project.ts";
import { DEFAULT_STORY } from "./stories.ts";
import { createInterface } from "node:readline";
import path from "node:path";
import { errorMessage } from "./errors.ts";

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

/**
 * Opens the Project in the working directory and shows its warnings (on stderr, so stdout carries
 * only the result). With `setUp`, Java and the Base themes are set up first, so a missing JDK or a
 * failed download fails the command before anything else.
 */
async function openProjectInCwd({ setUp }: { setUp: boolean }): Promise<Project> {
  const project = await openProject(process.cwd(), progress);
  if (setUp) await project.setUp();
  if (project.mockModels.warning) console.warn(project.mockModels.warning);
  return project;
}

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
  const project = await openProjectInCwd({ setUp: true });

  const renderer = await startRenderer();
  const server = await startPreviewServer({
    project,
    renderer,
    strict: project.strict && !values.lenient,
    port: values.port === undefined ? project.port : Number(values.port),
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
  const project = await openProjectInCwd({ setUp: true });
  let pages = values.page ?? [];
  let name = values.story;
  if (pages.length === 0) {
    const themePages = await project.scaffoldPages();
    const answers = stdinPrompts();
    console.log("Pages of the Theme and its Base theme:");
    themePages.forEach((p, i) => console.log(`  ${String(i + 1).padStart(3)}. ${pageLabel(p)}`));
    const choice = await answers.ask("Pages to add a Story for (numbers or names, comma-separated): ");
    pages = choice
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => (/^\d+$/.test(c) ? (themePages[Number(c) - 1]?.page ?? c) : c));
    // A blank answer takes the default name the prompt shows
    name ??= (await answers.ask(`Story name [${DEFAULT_STORY}]: `)).trim() || undefined;
    answers.close();
  }

  const added = await project.addStories(pages, name);
  for (const { page, file, url, hasDefaultMockModel } of added.stories) {
    console.log(`Added Story "${added.name}" for ${page} to ${path.relative(process.cwd(), file)}: ${url}`);
    if (!hasDefaultMockModel) {
      console.warn(`Warning: ${page} has no default Mock model yet, so its Stories cannot render until one is added.`);
    }
  }
}

function pageLabel(page: ScaffoldPage): string {
  const origin = page.baseTheme === undefined ? "Theme" : `Base theme ${page.baseTheme}`;
  const note = page.hasDefaultMockModel ? "" : ", no default Mock model yet";
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
  // Java-free: the default Mock models need no Base themes. stdout carries only the JSON, so it can be piped
  const project = await openProjectInCwd({ setUp: false });

  const defaults = await project.mockModels.defaultFor(page);
  if (!defaults) {
    const pages = await project.mockModels.pages();
    throw new Error(`No default Mock model for ${page}. Pages with one: ${pages.join(", ")}`);
  }
  console.log(JSON.stringify(defaults, null, 2));
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(errorMessage(err));
  process.exit(1);
});
