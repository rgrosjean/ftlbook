import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadStories, setOwn, StoryFileError, type JsonObject } from "./stories.ts";

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
