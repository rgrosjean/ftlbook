import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "src", "cli.ts");

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
  { cacheDir = testCacheDir, timeoutMs = 120_000 }: { cacheDir?: string; timeoutMs?: number } = {},
): Promise<RunningServer> {
  const child = spawn(process.execPath, [cli, "serve", "--port", "0"], {
    cwd,
    env: { ...process.env, FTL_PREVIEW_CACHE_DIR: cacheDir },
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
