import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { JsonObject } from "./stories.ts";

/**
 * Default Mock models, one directory per supported Keycloak major: `<major>/<theme-type>/<page>.json`,
 * plus `<major>/source.json` naming the Keycloak version they were taken from.
 */
const MOCK_MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "mock-models");

/** The default Mock models of one Theme type, chosen for the pinned Keycloak version. */
export interface MockModelCatalog {
  /**
   * Set when the defaults were not taken from the pinned Keycloak minor: another minor of the same
   * major, or the nearest supported major when the pinned major has none.
   */
  warning?: string;
  /** The default Mock model of a Page, or undefined when the tool ships none. */
  defaultFor(page: string): Promise<JsonObject | undefined>;
  /** Pages the tool ships a default Mock model for, sorted. */
  pages(): Promise<string[]>;
}

/**
 * Picks the defaults for the pinned Keycloak version: its major's when the tool ships them,
 * else the nearest supported major's (the newer one on a tie). Warns unless the defaults were
 * taken from the pinned major and minor; patch releases share defaults.
 */
export async function mockModelCatalog(keycloakVersion: string, themeType: string): Promise<MockModelCatalog> {
  const [requestedMajor, requestedMinor] = keycloakVersion.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const supported = (await readdir(MOCK_MODELS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  if (supported.length === 0) throw new Error(`No default Mock models found in ${MOCK_MODELS_DIR}`);

  const major = supported.reduce((best, candidate) => {
    const distance = Math.abs(candidate - requestedMajor);
    const bestDistance = Math.abs(best - requestedMajor);
    return distance < bestDistance || (distance === bestDistance && candidate > best) ? candidate : best;
  });
  const source = await sourceVersion(major);
  const [sourceMajor, sourceMinor] = source.split(".").map(Number);
  const warning =
    sourceMajor === requestedMajor && sourceMinor === requestedMinor
      ? undefined
      : `Warning: no default Mock models for Keycloak ${keycloakVersion}; using those taken from Keycloak ${source}. ` +
        `Fields may differ from what Keycloak ${keycloakVersion} provides.`;

  const dir = path.join(MOCK_MODELS_DIR, String(major), themeType);
  return {
    warning,
    async defaultFor(page) {
      if (!/^[\w.-]+\.ftl$/.test(page)) return undefined;
      try {
        return JSON.parse(await readFile(path.join(dir, `${page}.json`), "utf8"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async pages() {
      const files = await readdir(dir);
      return files.filter((f) => f.endsWith(".ftl.json")).map((f) => f.replace(/\.json$/, "")).sort();
    },
  };
}

/** The Keycloak version a major's defaults were taken from. */
async function sourceVersion(major: number): Promise<string> {
  const file = path.join(MOCK_MODELS_DIR, String(major), "source.json");
  const { keycloakVersion } = JSON.parse(await readFile(file, "utf8")) as { keycloakVersion?: unknown };
  if (typeof keycloakVersion !== "string") throw new Error(`${file}: "keycloakVersion" is missing`);
  return keycloakVersion;
}
