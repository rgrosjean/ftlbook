import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MOCK_MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "mock-models");

/** The default Mock model for a Page, or undefined when the tool ships none. */
export async function defaultMockModel(themeType: string, page: string): Promise<Record<string, unknown> | undefined> {
  if (!/^[\w.-]+\.ftl$/.test(page)) return undefined;
  try {
    return JSON.parse(await readFile(path.join(MOCK_MODELS_DIR, themeType, `${page}.json`), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
