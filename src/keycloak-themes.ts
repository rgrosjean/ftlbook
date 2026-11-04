import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { RENDERER_JAR } from "./renderer-process.ts";

const execFileAsync = promisify(execFile);

/** Keycloak version used when the project does not pin one. */
export const DEFAULT_KEYCLOAK_VERSION = "26.8.1";

const MAVEN_CENTRAL = "https://repo1.maven.org/maven2";

export function cacheDir(): string {
  if (process.env.FTL_PREVIEW_CACHE_DIR) return path.resolve(process.env.FTL_PREVIEW_CACHE_DIR);
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(base, "ftl-preview");
}

/**
 * Path to the `org.keycloak:keycloak-themes` jar for a Keycloak version, downloaded from
 * Maven Central on first use and reused from the cache afterwards. Never bundled.
 */
async function ensureKeycloakThemesJar(version: string, log: (msg: string) => void): Promise<string> {
  const file = path.join(cacheDir(), "keycloak", version, `keycloak-themes-${version}.jar`);
  if (await exists(file)) return file;

  const url = `${MAVEN_CENTRAL}/org/keycloak/keycloak-themes/${version}/keycloak-themes-${version}.jar`;
  log(`Downloading Base theme for Keycloak ${version} from ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Could not download keycloak-themes ${version} (HTTP ${res.status} from ${url})`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(partial));
    await rename(partial, file);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
  return file;
}

/**
 * Directory holding the extracted Base themes (`theme/<name>/<type>/...`) for a Keycloak version.
 * The jar is unpacked once, with the Renderer jar's extractor, so the CLI and Renderer read plain directories.
 */
export async function ensureBaseThemes(version: string, log: (msg: string) => void): Promise<string> {
  const dir = path.join(cacheDir(), "keycloak", version, "themes");
  if (await isDirectory(dir)) return dir;

  const jar = await ensureKeycloakThemesJar(version, log);
  const partial = `${dir}.${process.pid}.part`;
  try {
    await execFileAsync("java", ["-cp", RENDERER_JAR, "ftlpreview.ExtractJar", jar, partial]);
    await rename(partial, dir);
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    if (await isDirectory(dir)) return dir; // another process finished first
    throw new Error(`Could not extract ${jar}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return dir;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
