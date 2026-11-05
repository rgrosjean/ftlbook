import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { findResource, type Resource } from "./resources.ts";

/** The locale Keycloak falls back to when nothing else names one, and the Theme's only locale when it lists none. */
export const DEFAULT_LOCALE = "en";

/** Base theme Keycloak renders login with when the Project has no Previewed theme (LOGIN_V2 feature on). */
export const FALLBACK_LOGIN_BASE_THEME = "keycloak.v2";

/** A Page of the Theme chain: an FTL file no other FTL file of the chain imports or includes. */
export interface ThemePage {
  page: string;
  /** Name of the Base theme whose file wins, or undefined when a Theme of the Project's file does. */
  baseTheme: string | undefined;
}

/** Where the preview server serves resources: Keycloak's theme root URL. */
export const RESOURCES_ROOT = "/resources";

/**
 * The Previewed theme followed by every Theme and Base theme it builds on, most specific first. Each theme.properties is read once,
 * while the chain is resolved; Pages and resources are read on every call.
 */
export interface ThemeChain {
  /** Theme directories, most specific first, for the Renderer. */
  readonly dirs: string[];
  /** theme.properties merged over the chain, so the most specific Theme wins (like Keycloak). */
  readonly properties: Record<string, string>;
  /** Locales the Previewed theme supports: theme.properties `locales` over the chain (DEFAULT_LOCALE when none are listed). */
  readonly locales: string[];
  /**
   * Keycloak's UrlBean resource URLs: `resourcesPath` is the theme root, Theme type and Theme name;
   * `resourcesCommonPath` the theme root and the `common` theme property, else common/keycloak.
   */
  readonly resourceUrls: ResourceUrls;
  /** Every Page of the chain, sorted by name. */
  pages(): Promise<ThemePage[]>;
  /**
   * The resource a URL below RESOURCES_ROOT names, as `resourceUrls` build them: Theme resources from the chain
   * (the Theme name in the URL is not checked, as there is one Previewed theme), common resources from the named
   * common Theme of the Project, else the named Base theme's common type. Undefined for any other URL. Throws URIError on a malformed escape.
   */
  findResource(urlPath: string): Promise<Resource | undefined>;
}

export interface ResourceUrls {
  resourcesPath: string;
  resourcesCommonPath: string;
}

interface ChainEntry {
  dir: string;
  /** Undefined for a Theme of the Project. */
  baseTheme: string | undefined;
  properties: Record<string, string>;
}

/**
 * The Theme chain, built like Keycloak's DefaultThemeManager.loadTheme: the Previewed theme, its import, then
 * each parent followed by that parent's import. Parents and imports are looked up among the Themes of the
 * Project first, then among the extracted Base themes, so a Theme of the Project takes the place of a Base
 * theme with the same name and type (as Keycloak's FolderThemeProvider outranks its ClasspathThemeProvider).
 *
 * @param themeDir Previewed theme directory, `<themes root>/<name>/<type>` like Keycloak's themes folder, or
 *   undefined to start at the fallback Base theme
 * @param baseThemesDir extracted keycloak-themes jar
 * @param keycloakVersion version of the Base themes, for errors
 */
export async function resolveThemeChain(
  themeDir: string | undefined,
  baseThemesDir: string,
  themeType: string,
  keycloakVersion: string,
): Promise<ThemeChain> {
  const previewedDir = themeDir && path.resolve(themeDir);
  const themesRoot = previewedDir && path.dirname(path.dirname(previewedDir));
  /** The Theme of the Project or else the Base theme with this name and type; undefined when there is neither. */
  const findTheme = async (name: string, type: string): Promise<Omit<ChainEntry, "properties"> | undefined> => {
    if (!isThemeName(name)) return undefined;
    const projectDir = themesRoot && path.join(themesRoot, name, type);
    if (projectDir && (await isDirectory(projectDir))) return { dir: projectDir, baseTheme: undefined };
    const baseDir = baseThemeDir(baseThemesDir, name, type);
    return (await isDirectory(baseDir)) ? { dir: baseDir, baseTheme: name } : undefined;
  };
  const loadTheme = async (name: string, type: string, referencedFrom: string): Promise<ChainEntry> => {
    const found = await findTheme(name, type);
    if (!found) {
      const where = themesRoot
        ? `neither a Theme of the Project (looked in ${themesRoot}) nor a Base theme of Keycloak ${keycloakVersion}`
        : `not a Base theme of Keycloak ${keycloakVersion}`;
      throw new Error(`${referencedFrom} refers to "${type}/${name}", which is ${where}`);
    }
    return { ...found, properties: await readThemeProperties(found.dir) };
  };

  const chain: ChainEntry[] = [];
  const visitedParents = new Set<string>();
  let current: ChainEntry | undefined = previewedDir
    ? { dir: previewedDir, baseTheme: undefined, properties: await readThemeProperties(previewedDir) }
    : await loadTheme(FALLBACK_LOGIN_BASE_THEME, themeType, "The fallback Base theme");

  while (current) {
    if (visitedParents.has(current.dir)) throw new Error(`Theme parent cycle at ${current.dir}`);
    visitedParents.add(current.dir);
    chain.push(current);

    const properties: Record<string, string> = current.properties;
    const propertiesFile = path.join(current.dir, "theme.properties");
    if (properties.import) {
      const [type, name] = properties.import.split("/", 2);
      if (!type || !name) throw new Error(`${propertiesFile}: import must be "<type>/<name>", got "${properties.import}"`);
      const imported = await loadTheme(name, type, `${propertiesFile} (import)`);
      if (!chain.some((entry) => entry.dir === imported.dir)) chain.push(imported);
    }
    current = properties.parent ? await loadTheme(properties.parent, themeType, `${propertiesFile} (parent)`) : undefined;
  }

  const dirs = chain.map((entry) => entry.dir);
  const properties = mergedThemeProperties(chain);
  // The Previewed theme's name as Keycloak would know it: its folder's parent (Keycloak's themes/<name>/<type> layout)
  const themeName = previewedDir ? path.basename(path.dirname(previewedDir)) : FALLBACK_LOGIN_BASE_THEME;
  return {
    dirs,
    properties,
    locales: themeLocales(properties),
    resourceUrls: {
      resourcesPath: `${RESOURCES_ROOT}/${themeType}/${themeName}`,
      resourcesCommonPath: `${RESOURCES_ROOT}/${properties.common || "common/keycloak"}`,
    },
    pages: () => listPages(chain),
    findResource: async (urlPath) => {
      const match = RESOURCE_URL.exec(urlPath);
      if (!match) return undefined;
      const [type, name, resourcePath] = match.slice(1).map(decodeURIComponent);
      if (type === themeType) return findResource(dirs, resourcePath);
      if (type !== "common") return undefined;
      const common = await findTheme(name, "common");
      return common && findResource([common.dir], resourcePath);
    },
  };
}

/** A URL `resourceUrls` build: RESOURCES_ROOT, then Theme type and Theme name, or common and the common theme's name. */
const RESOURCE_URL = new RegExp(`^${RESOURCES_ROOT}/([\\w.-]+)/([\\w.-]+)/(.+)$`);

/** A name that is safe to use as a directory: it cannot leave the themes folder it is looked up in. */
function isThemeName(name: string): boolean {
  return /^[\w.-]+$/.test(name) && name !== "." && name !== "..";
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
function mergedThemeProperties(chain: ChainEntry[]): Record<string, string> {
  // A Map, so a key such as __proto__ is kept like any other (Object.fromEntries defines own properties)
  const merged = new Map<string, string>();
  for (const entry of [...chain].reverse()) {
    for (const [key, value] of Object.entries(entry.properties)) merged.set(key, value);
  }
  return Object.fromEntries(merged);
}

function themeLocales(properties: Record<string, string>): string[] {
  const locales = (properties.locales ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  return locales.length > 0 ? locales : [DEFAULT_LOCALE];
}

async function readThemeProperties(dir: string): Promise<Record<string, string>> {
  try {
    const file = path.join(dir, "theme.properties");
    return parseProperties(decode(await readFile(file)), file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

/**
 * UTF-8, falling back to ISO-8859-1 for files that are not valid UTF-8: the reading the Renderer used for
 * theme.properties (Java's PropertyResourceBundle) before Node became its only reader. Like Java, a byte order
 * mark is kept, as part of the first key.
 */
function decode(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

/**
 * theme.properties as java.util.Properties reads it, which is what Keycloak loads it into: `#`/`!` comment lines, keys ending
 * at an unescaped `=`, `:` or whitespace, lines continued by an odd number of trailing backslashes, and the
 * escapes `\\uXXXX`, `\\t`, `\\n`, `\\r`, `\\f` and `\\<char>` in keys and values. Like Java, trailing
 * whitespace stays part of the value.
 */
function parseProperties(text: string, file: string): Record<string, string> {
  const result = new Map<string, string>();
  for (const line of logicalLines(text)) {
    let keyEnd = 0;
    while (keyEnd < line.length && !isSeparator(line[keyEnd]) && !isWhitespace(line[keyEnd])) {
      keyEnd += line[keyEnd] === "\\" ? 2 : 1;
    }
    keyEnd = Math.min(keyEnd, line.length);
    let valueStart = keyEnd;
    while (valueStart < line.length && isWhitespace(line[valueStart])) valueStart++;
    if (valueStart < line.length && isSeparator(line[valueStart])) valueStart++;
    while (valueStart < line.length && isWhitespace(line[valueStart])) valueStart++;
    result.set(unescape(line.slice(0, keyEnd), file), unescape(line.slice(valueStart), file));
  }
  return Object.fromEntries(result);
}

/** Non-blank, non-comment lines with continuations joined; leading whitespace of each natural line dropped. */
function* logicalLines(text: string): Generator<string> {
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = trimLeadingWhitespace(lines[i]);
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    while (endsWithContinuation(line)) {
      line = line.slice(0, -1) + (i + 1 < lines.length ? trimLeadingWhitespace(lines[++i]) : "");
    }
    yield line;
  }
}

function endsWithContinuation(line: string): boolean {
  let backslashes = 0;
  while (backslashes < line.length && line[line.length - 1 - backslashes] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

const ESCAPES: Record<string, string> = { t: "\t", n: "\n", r: "\r", f: "\f" };

function unescape(text: string, file: string): string {
  return text.replace(/\\(u(.{0,4})|.)/gs, (_, escape: string, hex: string | undefined) => {
    if (hex === undefined) return ESCAPES[escape] ?? escape;
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`${file}: malformed \\uXXXX escape "\\u${hex}"`);
    return String.fromCharCode(parseInt(hex, 16));
  });
}

function isSeparator(c: string): boolean {
  return c === "=" || c === ":";
}

/** Whitespace as java.util.Properties knows it: space, tab and form feed. */
function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\f";
}

function trimLeadingWhitespace(line: string): string {
  let start = 0;
  while (start < line.length && isWhitespace(line[start])) start++;
  return line.slice(start);
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
