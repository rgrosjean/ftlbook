import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { JsonObject } from "./stories.ts";

/**
 * Default Mock models, one directory per supported Keycloak major: `<major>/<theme-type>/<page>.json`,
 * plus `<major>/source.json` naming the Keycloak version they were taken from.
 */
const MOCK_MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "mock-models");

/** The default Mock models chosen for a pinned Keycloak version. */
export interface MockModelSelection {
  /** Keycloak major whose defaults are used. */
  major: number;
  /**
   * Set when the defaults were not taken from the pinned Keycloak minor: another minor of the same
   * major, or the nearest supported major when the pinned major has none.
   */
  warning?: string;
}

/**
 * Picks the defaults for the pinned Keycloak version: its major's when the tool ships them,
 * else the nearest supported major's (the newer one on a tie). Warns unless the defaults were
 * taken from the pinned major and minor; patch releases share defaults.
 */
export async function selectMockModels(keycloakVersion: string): Promise<MockModelSelection> {
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
  if (sourceMajor === requestedMajor && sourceMinor === requestedMinor) return { major };
  return {
    major,
    warning:
      `Warning: no default Mock models for Keycloak ${keycloakVersion}; using those taken from Keycloak ${source}. ` +
      `Fields may differ from what Keycloak ${keycloakVersion} provides.`,
  };
}

/** The Keycloak version a major's defaults were taken from. */
async function sourceVersion(major: number): Promise<string> {
  const file = path.join(MOCK_MODELS_DIR, String(major), "source.json");
  const { keycloakVersion } = JSON.parse(await readFile(file, "utf8")) as { keycloakVersion?: unknown };
  if (typeof keycloakVersion !== "string") throw new Error(`${file}: "keycloakVersion" is missing`);
  return keycloakVersion;
}

/** The default Mock model for a Page, or undefined when the tool ships none. */
export async function defaultMockModel(major: number, themeType: string, page: string): Promise<JsonObject | undefined> {
  if (!/^[\w.-]+\.ftl$/.test(page)) return undefined;
  try {
    return JSON.parse(await readFile(path.join(MOCK_MODELS_DIR, String(major), themeType, `${page}.json`), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
