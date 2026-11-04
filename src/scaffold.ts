import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadStories, setOwn, StoryFileError, type JsonObject } from "./stories.ts";

/** A Page found in the Theme chain, with the Theme directory whose file wins. */
export interface ThemePage {
  page: string;
  themeDir: string;
}

const IMPORT_OR_INCLUDE = /<#(?:import|include)\s+"([^"]+)"/g;

/**
 * Every Page across the Theme chain (most specific first), sorted by name. A Page is an FTL file
 * that no other FTL file of the chain imports or includes: `template.ftl`, `field.ftl` and other
 * macro libraries are not Pages.
 */
export async function listPages(chain: string[]): Promise<ThemePage[]> {
  const pages = new Map<string, string>();
  const used = new Set<string>();
  for (const themeDir of chain) {
    let files: string[];
    try {
      files = (await readdir(themeDir)).filter((f) => f.endsWith(".ftl"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const file of files) {
      if (!pages.has(file)) pages.set(file, themeDir);
      for (const match of (await readFile(path.join(themeDir, file), "utf8")).matchAll(IMPORT_OR_INCLUDE)) {
        used.add(path.basename(match[1]));
      }
    }
  }
  return [...pages]
    .filter(([page]) => !used.has(page))
    .map(([page, themeDir]) => ({ page, themeDir }))
    .sort((a, b) => a.page.localeCompare(b.page));
}

/**
 * Adds an empty Story (the Page's default Mock model as is) named `name` to each Page. A Story goes
 * into the Story file that already has Stories for its Page, keeping them, else into a new
 * `<page>.stories.json`. Nothing is written when any Page already has a Story of that name.
 * Returns the file written for each Page.
 */
export async function addStories(storiesDir: string, pages: string[], name: string): Promise<Map<string, string>> {
  const stories = await loadStories(storiesDir);
  const clash = stories.find((s) => pages.includes(s.page) && s.name === name);
  if (clash) throw new StoryFileError(`${clash.page} already has a Story "${name}" (in ${clash.file})`);

  // Read and check every target file before writing any
  const updates: { page: string; file: string; json: JsonObject }[] = [];
  for (const page of pages) {
    const file =
      stories.find((s) => s.page === page)?.file ?? path.join(storiesDir, `${page.replace(/\.ftl$/, "")}.stories.json`);
    let json: JsonObject = { page, stories: {} };
    if (existsSync(file)) {
      json = JSON.parse(await readFile(file, "utf8"));
      if (json.page !== page) throw new StoryFileError(`${file} already exists for another Page (${json.page})`);
    }
    updates.push({ page, file, json });
  }

  const written = new Map<string, string>();
  for (const { page, file, json } of updates) {
    setOwn(json.stories as JsonObject, name, {});
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
    written.set(page, file);
  }
  return written;
}
