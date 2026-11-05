import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_KEYCLOAK_VERSION } from "./keycloak-themes.ts";
import { errorMessage } from "./errors.ts";

/** The project's config file, at the project root. Every key is optional. */
export const CONFIG_FILE = "ftl-preview.json";

/** Theme types v1 can preview; the config key exists so account and email can be added later. */
const SUPPORTED_THEME_TYPES = ["login"];

const DEFAULT_PORT = 6006;

export interface ProjectConfig {
  /** Pinned Keycloak version; its Base theme is downloaded and cached. */
  keycloakVersion: string;
  themeType: string;
  /** Customer Theme directory (absolute); undefined when the project has none and the Base theme renders alone. */
  themeDir: string | undefined;
  /** Directory with the `*.stories.json` files (absolute). */
  storiesDir: string;
  port: number;
  /** Strict mode (default): a missing Mock model value fails the render. */
  strict: boolean;
  /** Maven repository to download the Base theme from, e.g. an internal mirror; Maven Central when unset. */
  mavenRepository: string | undefined;
}

/** A config file that cannot be used; the message names the file and the problem. */
export class ConfigError extends Error {}

export const CONFIG_KEYS = ["keycloakVersion", "themeType", "themeDir", "storiesDir", "port", "strict", "mavenRepository"];

/**
 * Reads `ftl-preview.json` from the project root. Without one, the defaults make a project
 * with `theme/login` and `stories/` work. Relative paths are resolved against the project root.
 */
export async function loadConfig(projectDir: string): Promise<ProjectConfig> {
  const file = path.join(projectDir, CONFIG_FILE);
  let json: unknown = {};
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(`${file} is not valid JSON: ${errorMessage(err)}`);
    }
  }
  const fail = (problem: string): never => {
    throw new ConfigError(`${file}: ${problem}`);
  };
  if (typeof json !== "object" || json === null || Array.isArray(json)) return fail("expected a JSON object");
  const config = json as Record<string, unknown>;

  const unknownKeys = Object.keys(config).filter((key) => !CONFIG_KEYS.includes(key));
  if (unknownKeys.length > 0) fail(`unknown keys ${unknownKeys.join(", ")} (known keys: ${CONFIG_KEYS.join(", ")})`);

  const optionalString = (key: string): string | undefined => {
    const value = config[key];
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) fail(`"${key}" must be a non-empty string`);
    return value as string | undefined;
  };

  const keycloakVersion = optionalString("keycloakVersion") ?? DEFAULT_KEYCLOAK_VERSION;
  // Any Maven version (26.8.1, 26.0.0-rc1, ...); the value becomes part of download URLs and cache paths
  if (!/^\d[\w.-]*$/.test(keycloakVersion)) fail(`"keycloakVersion" must be a version like "26.8.1", got "${keycloakVersion}"`);

  const themeType = optionalString("themeType") ?? "login";
  if (!SUPPORTED_THEME_TYPES.includes(themeType)) {
    fail(`Theme type "${themeType}" is not supported; supported: ${SUPPORTED_THEME_TYPES.join(", ")}`);
  }

  const port = config.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65535) {
    fail(`"port" must be an integer from 0 to 65535`);
  }

  const strict = config.strict ?? true;
  if (typeof strict !== "boolean") fail(`"strict" must be true or false`);

  const configuredThemeDir = optionalString("themeDir");
  const themeDir = path.resolve(projectDir, configuredThemeDir ?? path.join("theme", themeType));
  // A configured Theme directory must exist; the default one is optional
  if (configuredThemeDir !== undefined && !existsSync(themeDir)) fail(`"themeDir": ${themeDir} does not exist`);

  return {
    keycloakVersion,
    themeType,
    themeDir: existsSync(themeDir) ? themeDir : undefined,
    storiesDir: path.resolve(projectDir, optionalString("storiesDir") ?? "stories"),
    port: port as number,
    strict: strict as boolean,
    mavenRepository: optionalString("mavenRepository"),
  };
}
