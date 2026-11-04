import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import os from "node:os";
import path from "node:path";
import { extractJar, requireJava } from "./java.ts";

/** Keycloak version used when the project does not pin one. */
export const DEFAULT_KEYCLOAK_VERSION = "26.8.1";

const MAVEN_CENTRAL = "https://repo1.maven.org/maven2";

/** Base theme artifacts: templates, messages and resources, plus vendor web assets (PatternFly, ...). */
const BASE_THEME_ARTIFACTS = ["keycloak-themes", "keycloak-themes-vendor"] as const;

export function cacheDir(): string {
  if (process.env.FTL_PREVIEW_CACHE_DIR) return path.resolve(process.env.FTL_PREVIEW_CACHE_DIR);
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(base, "ftl-preview");
}

/**
 * Maven repository to download from: FTL_PREVIEW_MAVEN_REPO (a machine's mirror, e.g. an internal Nexus)
 * wins over the project's configured repository, which wins over Maven Central.
 */
function mavenRepository(configured: string | undefined): string {
  return (process.env.FTL_PREVIEW_MAVEN_REPO ?? configured ?? MAVEN_CENTRAL).replace(/\/+$/, "");
}

/**
 * Path to an `org.keycloak` jar for a Keycloak version, downloaded on first use and reused
 * from the cache afterwards. Never bundled.
 */
async function ensureKeycloakJar(
  artifact: string,
  version: string,
  repository: string | undefined,
  log: (msg: string) => void,
): Promise<string> {
  const file = path.join(cacheDir(), "keycloak", version, `${artifact}-${version}.jar`);
  if (await exists(file)) return file;

  const url = `${mavenRepository(repository)}/org/keycloak/${artifact}/${version}/${artifact}-${version}.jar`;
  log(`Downloading Base theme for Keycloak ${version}: ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Could not download ${artifact} ${version} (HTTP ${res.status} from ${url})`);
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
 * Directory holding the extracted Base themes (`theme/<name>/<type>/...`, vendor assets included)
 * for a Keycloak version. The jars are unpacked once, with the Renderer jar's extractor, so the CLI
 * and Renderer read plain directories.
 */
export async function ensureBaseThemes(
  version: string,
  repository: string | undefined,
  log: (msg: string) => void,
): Promise<string> {
  // A command needing the Base themes needs Java (to extract them, or to render): fail first, before
  // any download, and also when they are already cached, so a missing JDK shows up straight away
  await requireJava();
  const dir = path.join(cacheDir(), "keycloak", version, "base-themes");
  if (await isDirectory(dir)) return dir;

  const jars: string[] = [];
  for (const artifact of BASE_THEME_ARTIFACTS) jars.push(await ensureKeycloakJar(artifact, version, repository, log));

  const partial = `${dir}.${process.pid}.part`;
  try {
    // Both jars unpack into one tree; their paths do not overlap (vendor assets live under */resources/vendor)
    for (const jar of jars) await extractJar(jar, partial);
    await rename(partial, dir);
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    if (await isDirectory(dir)) return dir; // another process finished first
    throw err;
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
