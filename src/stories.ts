import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Every Page has this Story, even without a Story file: the default Mock model as is. */
export const DEFAULT_STORY = "Default";

const STORY_FILE = /\.stories\.json$/;

export type JsonObject = { [key: string]: Json };
export type Json = string | number | boolean | null | Json[] | JsonObject;

/** A named preview of one Page: the locale and the Mock model overrides to apply. */
export interface Story {
  name: string;
  page: string;
  locale?: string;
  model: JsonObject;
  /** Story file it was defined in; undefined for the implicit Default Story. */
  file?: string;
}

/** A Story file that cannot be used; the message names the file and the problem. */
export class StoryFileError extends Error {}

/**
 * Finds a Story by Page and name in the stories directory (all `*.stories.json` files, read fresh
 * on every call). Returns the implicit Default Story when the files define no `Default` for the Page.
 */
export async function findStory(storiesDir: string, page: string, name: string): Promise<Story | undefined> {
  const stories = await loadStories(storiesDir);
  const found = stories.find((s) => s.page === page && s.name === name);
  if (found) return found;
  if (name === DEFAULT_STORY) return { name, page, model: {} };
  return undefined;
}

/** All Stories defined in the stories directory, in file order. */
export async function loadStories(storiesDir: string): Promise<Story[]> {
  const stories: Story[] = [];
  for (const file of await storyFiles(storiesDir)) {
    for (const story of parseStoryFile(file, await readFile(file, "utf8"))) {
      const clash = stories.find((s) => s.page === story.page && s.name === story.name);
      if (clash) {
        throw new StoryFileError(`Story "${story.name}" for ${story.page} is defined twice: in ${clash.file} and ${file}`);
      }
      stories.push(story);
    }
  }
  return stories;
}

async function storyFiles(storiesDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(storiesDir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && STORY_FILE.test(e.name))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

function parseStoryFile(file: string, text: string): Story[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new StoryFileError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  const fail = (problem: string): never => {
    throw new StoryFileError(`${file}: ${problem}`);
  };
  if (!isObject(json)) return fail('expected an object with "page" and "stories"');
  const { page, stories } = json;
  if (typeof page !== "string" || !/^[\w.-]+\.ftl$/.test(page)) {
    return fail('"page" must name an FTL file of the Theme, e.g. "login.ftl"');
  }
  if (!isObject(stories)) return fail('"stories" must be an object of named Stories');

  return Object.entries(stories).map(([name, definition]) => {
    if (!isObject(definition)) return fail(`Story "${name}" must be an object`);
    const { locale, model = {}, ...extraKeys } = definition;
    if (Object.keys(extraKeys).length > 0) {
      return fail(`Story "${name}" has unknown keys ${Object.keys(extraKeys).join(", ")}; overrides go under "model"`);
    }
    if (locale !== undefined && typeof locale !== "string") return fail(`Story "${name}": "locale" must be a string`);
    if (!isObject(model)) return fail(`Story "${name}": "model" must be an object`);
    return { name, page, locale, model, file };
  });
}

/**
 * Applies Story overrides to a Mock model: objects merge recursively, arrays and other values
 * replace, and `null` deletes the key (Keycloak omits absent attributes; templates test presence).
 */
export function applyOverrides(base: JsonObject, overrides: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(base)) setOwn(result, key, value);
  for (const [key, value] of Object.entries(overrides)) {
    const current = Object.hasOwn(result, key) ? result[key] : undefined;
    if (value === null) {
      delete result[key];
    } else if (isObject(value)) {
      // Merge into the default object; with no default object, still apply it so nested nulls are dropped
      setOwn(result, key, applyOverrides(isObject(current) ? current : {}, value));
    } else {
      setOwn(result, key, value);
    }
  }
  return result;
}

/** Plain assignment would hit the __proto__ setter for a "__proto__" key from JSON; define it as data instead. */
function setOwn(target: JsonObject, key: string, value: Json) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
