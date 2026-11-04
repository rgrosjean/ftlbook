import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The ftl-preview command, as installed. */
export const bin = path.join(repoRoot, "bin", "ftl-preview.js");

/** Shared download cache so the keycloak-themes jar is fetched once across test runs. */
export const testCacheDir = path.join(repoRoot, ".cache", "test");

export function fixture(name: string): string {
  return path.join(repoRoot, "test", "fixtures", name);
}

export interface RunningServer {
  baseUrl: string;
  process: ChildProcess;
  output: () => string;
  stop: () => Promise<void>;
}

/** Starts `ftl-preview serve` in `cwd`, as a user would, and waits until it reports its URL. */
export async function startServer(
  cwd: string,
  {
    cacheDir = testCacheDir,
    env = {},
    args = [],
    port = 0,
    timeoutMs = 120_000,
  }: {
    cacheDir?: string;
    env?: Record<string, string>;
    args?: string[];
    /** Passed as --port; null leaves the port to the project's config. */
    port?: number | null;
    timeoutMs?: number;
  } = {},
): Promise<RunningServer> {
  const portArgs = port === null ? [] : ["--port", String(port)];
  const child = spawn(process.execPath, [bin, "serve", ...portArgs, ...args], {
    cwd,
    env: { ...process.env, FTL_PREVIEW_CACHE_DIR: cacheDir, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  const baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), timeoutMs);
    const check = () => {
      const match = output.match(/Preview running at (http:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", check);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });

  return {
    baseUrl,
    process: child,
    output: () => output,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
