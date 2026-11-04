import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
};

export interface Resource {
  body: Buffer;
  contentType: string;
}

/**
 * A resource looked up like Keycloak's ExtendingTheme.getResourceAsStream: the first Theme in the
 * chain whose `resources/` directory has the file wins. Read from disk on every call.
 *
 * @param themeDirs Theme chain, most specific first
 * @param resourcePath path below `resources/`, as it appears in the URL
 */
export async function findResource(themeDirs: string[], resourcePath: string): Promise<Resource | undefined> {
  const relative = path.posix.normalize(resourcePath);
  if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) return undefined;

  for (const dir of themeDirs) {
    const root = path.join(dir, "resources");
    const file = path.join(root, relative);
    if (!file.startsWith(root + path.sep)) continue;
    if (await isFile(file)) {
      return {
        body: await readFile(file),
        contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      };
    }
  }
  return undefined;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
