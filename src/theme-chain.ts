import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { findResource, type Resource } from "./resources.ts";

/** The locale Keycloak falls back to when nothing else names one, and the Theme's only locale when it lists none. */
export const DEFAULT_LOCALE = "en";

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
  /**
   * The Theme's name as Keycloak would know it: the folder holding the Theme (Keycloak's
   * themes/<name>/<type> layout), or the fallback Base theme's name when the Project has none.
   */
  readonly themeName: string;
  /** Every Page of the chain, sorted by name. */
  pages(): Promise<ThemePage[]>;
  /** A resource below `resources/` of the first Theme in the chain that has it. */
  findResource(resourcePath: string): Promise<Resource | undefined>;
  /** theme.properties merged over the chain, so the most specific Theme wins (like Keycloak). */
  properties(): Promise<Record<string, string>>;
  /** Locales the Theme supports: theme.properties `locales` over the chain (DEFAULT_LOCALE when none are listed). */
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
    themeName: themeDir ? path.basename(path.dirname(path.resolve(themeDir))) : FALLBACK_LOGIN_BASE_THEME,
    pages: () => listPages(chain),
    findResource: (resourcePath) => findResource(dirs, resourcePath),
    properties: () => mergedThemeProperties(dirs),
    locales: async () => themeLocales(await mergedThemeProperties(dirs)),
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
  // A Map, so a key such as __proto__ is kept like any other (Object.fromEntries defines own properties)
  const merged = new Map<string, string>();
  for (const dir of [...dirs].reverse()) {
    for (const [key, value] of Object.entries(await readThemeProperties(dir))) merged.set(key, value);
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
