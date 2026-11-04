import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { findResource, type Resource } from "./resources.ts";

/** Base theme Keycloak renders login with when no customer Theme is given (LOGIN_V2 feature on). */
export const FALLBACK_LOGIN_BASE_THEME = "keycloak.v2";

/** A Page of the Theme chain: an FTL file no other FTL file of the chain imports or includes. */
export interface ThemePage {
  page: string;
  /** Name of the Base theme whose file wins, or undefined when the Theme's own file does. */
  baseTheme: string | undefined;
}

/** The Theme followed by every Base theme it builds on, most specific first. Files are read on every call. */
export interface ThemeChain {
  /** Theme directories, most specific first, for the Renderer. */
  readonly dirs: string[];
  /** Every Page of the chain, sorted by name. */
  pages(): Promise<ThemePage[]>;
  /** A resource below `resources/` of the first Theme in the chain that has it. */
  findResource(resourcePath: string): Promise<Resource | undefined>;
  /** Locales the Theme supports: theme.properties `locales` over the chain (en when none are listed). */
  locales(): Promise<string[]>;
}

interface ChainEntry {
  dir: string;
  /** Undefined for the customer Theme. */
  baseTheme: string | undefined;
}

/**
 * The Theme chain, built like Keycloak's DefaultThemeManager.loadTheme: the Theme, its import, then
 * each parent followed by that parent's import. Parents and imports are looked up among the extracted
 * Base themes.
 *
 * @param themeDir customer Theme directory, or undefined to start at the fallback Base theme
 * @param baseThemesDir extracted keycloak-themes jar
 */
export async function resolveThemeChain(
  themeDir: string | undefined,
  baseThemesDir: string,
  themeType: string,
): Promise<ThemeChain> {
  const loadBaseTheme = async (name: string, type: string, referencedFrom: string): Promise<ChainEntry> => {
    const dir = baseThemeDir(baseThemesDir, name, type);
    if (!(await isDirectory(dir))) {
      throw new Error(`${referencedFrom} refers to "${type}/${name}", which is not a Base theme of this Keycloak version`);
    }
    return { dir, baseTheme: name };
  };

  const chain: ChainEntry[] = [];
  const visitedParents = new Set<string>();
  let current: ChainEntry | undefined = themeDir
    ? { dir: path.resolve(themeDir), baseTheme: undefined }
    : await loadBaseTheme(FALLBACK_LOGIN_BASE_THEME, themeType, "The fallback Base theme");

  while (current) {
    if (visitedParents.has(current.dir)) throw new Error(`Theme parent cycle at ${current.dir}`);
    visitedParents.add(current.dir);
    chain.push(current);

    const properties = await readThemeProperties(current.dir);
    const propertiesFile = path.join(current.dir, "theme.properties");
    if (properties.import) {
      const [type, name] = properties.import.split("/", 2);
      if (!type || !name) throw new Error(`${propertiesFile}: import must be "<type>/<name>", got "${properties.import}"`);
      const imported = await loadBaseTheme(name, type, `${propertiesFile} (import)`);
      if (!chain.some((entry) => entry.dir === imported.dir)) chain.push(imported);
    }
    current = properties.parent ? await loadBaseTheme(properties.parent, themeType, `${propertiesFile} (parent)`) : undefined;
  }

  const dirs = chain.map((entry) => entry.dir);
  return {
    dirs,
    pages: () => listPages(chain),
    findResource: (resourcePath) => findResource(dirs, resourcePath),
    locales: () => themeLocales(dirs),
  };
}

/**
 * A resource of a Base theme's common type (Keycloak's url.resourcesCommonPath), e.g. keycloak/common.
 * Undefined when there is no such Base theme or resource.
 */
export async function findCommonResource(
  baseThemesDir: string,
  baseTheme: string,
  resourcePath: string,
): Promise<Resource | undefined> {
  // The name becomes a directory: reject anything that could leave the Base themes
  if (!/^[\w.-]+$/.test(baseTheme) || baseTheme === "." || baseTheme === "..") return undefined;
  return findResource([baseThemeDir(baseThemesDir, baseTheme, "common")], resourcePath);
}

/** Base themes are extracted to `theme/<name>/<type>`. */
function baseThemeDir(baseThemesDir: string, name: string, type: string): string {
  return path.join(baseThemesDir, "theme", name, type);
}

const IMPORT_OR_INCLUDE = /<#(?:import|include)\s+"([^"]+)"/g;

/** Pages across the chain, each with the entry whose file wins; `template.ftl` and other macro libraries are not Pages. */
async function listPages(chain: ChainEntry[]): Promise<ThemePage[]> {
  const pages = new Map<string, ChainEntry>();
  const used = new Set<string>();
  for (const entry of chain) {
    let files: string[];
    try {
      files = (await readdir(entry.dir)).filter((f) => f.endsWith(".ftl"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const file of files) {
      if (!pages.has(file)) pages.set(file, entry);
      for (const match of (await readFile(path.join(entry.dir, file), "utf8")).matchAll(IMPORT_OR_INCLUDE)) {
        used.add(path.basename(match[1]));
      }
    }
  }
  return [...pages]
    .filter(([page]) => !used.has(page))
    .map(([page, entry]) => ({ page, baseTheme: entry.baseTheme }))
    .sort((a, b) => a.page.localeCompare(b.page));
}

/** theme.properties merged over the chain, least specific first, so the child wins (like Keycloak). */
async function mergedThemeProperties(dirs: string[]): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const dir of [...dirs].reverse()) Object.assign(merged, await readThemeProperties(dir));
  return merged;
}

async function themeLocales(dirs: string[]): Promise<string[]> {
  const listed = (await mergedThemeProperties(dirs)).locales ?? "";
  const locales = listed.split(",").map((l) => l.trim()).filter(Boolean);
  return locales.length > 0 ? locales : ["en"];
}

async function readThemeProperties(dir: string): Promise<Record<string, string>> {
  try {
    return parseProperties(await readFile(path.join(dir, "theme.properties"), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

/** Minimal java.util.Properties reader: comments, `=`/`:`/space separators, line continuations. */
function parseProperties(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimStart();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].trimStart();
    }
    const match = /^((?:\\.|[^=:\s\\])+)\s*[=:\s]\s*(.*)$/.exec(line);
    if (match) result[match[1]] = match[2].trim();
    else result[line] = "";
  }
  return result;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
