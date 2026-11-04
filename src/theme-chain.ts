import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Base theme Keycloak renders login with when no customer Theme is given (LOGIN_V2 feature on). */
export const FALLBACK_LOGIN_BASE_THEME = "keycloak.v2";

/**
 * The Theme chain, most specific first, built like Keycloak's DefaultThemeManager.loadTheme:
 * the Theme, its import, then each parent followed by that parent's import.
 * Parents and imports are looked up among the extracted Base themes.
 *
 * @param themeDir customer Theme directory, or undefined to start at the fallback Base theme
 * @param baseThemesDir extracted keycloak-themes jar (contains `theme/<name>/<type>`)
 */
export async function resolveThemeChain(
  themeDir: string | undefined,
  baseThemesDir: string,
  themeType: string,
): Promise<string[]> {
  const baseTheme = async (name: string, type: string, referencedFrom: string) => {
    const dir = path.join(baseThemesDir, "theme", name, type);
    if (!(await isDirectory(dir))) {
      throw new Error(`${referencedFrom} refers to "${type}/${name}", which is not a Base theme of this Keycloak version`);
    }
    return dir;
  };

  const chain: string[] = [];
  const visitedParents = new Set<string>();
  let current: string | undefined = themeDir
    ? path.resolve(themeDir)
    : await baseTheme(FALLBACK_LOGIN_BASE_THEME, themeType, "The fallback Base theme");

  while (current) {
    if (visitedParents.has(current)) throw new Error(`Theme parent cycle at ${current}`);
    visitedParents.add(current);
    chain.push(current);

    const properties = await readThemeProperties(current);
    const propertiesFile = path.join(current, "theme.properties");
    if (properties.import) {
      const [type, name] = properties.import.split("/", 2);
      if (!type || !name) throw new Error(`${propertiesFile}: import must be "<type>/<name>", got "${properties.import}"`);
      const imported = await baseTheme(name, type, `${propertiesFile} (import)`);
      if (!chain.includes(imported)) chain.push(imported);
    }
    current = properties.parent ? await baseTheme(properties.parent, themeType, `${propertiesFile} (parent)`) : undefined;
  }
  return chain;
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
