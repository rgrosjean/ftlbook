import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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

/** The part of a node:test context the helpers below need. */
type TestContext = { after: (fn: () => Promise<void>) => void };

/** A new empty temporary directory, removed after the test. */
export async function tempDir(t: TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `ftl-preview-${prefix}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A writable copy of a fixture project, removed after the test. */
export async function copyProject(t: TestContext, name: string): Promise<string> {
  const project = await tempDir(t, "project");
  await cp(fixture(name), project, { recursive: true });
  return project;
}

/** Merges settings into the project's ftl-preview.json. */
export async function configure(project: string, settings: Record<string, unknown>) {
  const file = path.join(project, "ftl-preview.json");
  const current = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  await writeFile(file, JSON.stringify({ ...current, ...settings }));
}

export interface RunningServer {
  baseUrl: string;
  process: ChildProcess;
  /** stdout and stderr interleaved. */
  output: () => string;
  stdout: () => string;
  stderr: () => string;
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
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    output += d;
    stdout += d;
  });
  child.stderr.on("data", (d) => {
    output += d;
    stderr += d;
  });

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
    stdout: () => stdout,
    stderr: () => stderr,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}

/** Process ids of a process's direct children. Needs `pgrep` (Linux, macOS). */
export function childPids(pid: number): number[] {
  const found = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  return found.stdout.split("\n").filter(Boolean).map(Number);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until `condition` holds, failing after `timeoutMs`. */
export async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Kills the Renderer (the JVM child process) of a running server, as a crash would, and waits until it is gone. */
export async function killRenderer(server: RunningServer): Promise<void> {
  const pids = childPids(server.process.pid!);
  if (pids.length !== 1) throw new Error(`expected one Renderer process, found ${pids.length}`);
  process.kill(pids[0], "SIGKILL");
  await waitFor(() => !isAlive(pids[0]), 10_000);
}

/** Runs an ftl-preview command in `cwd` to completion, as a user would, feeding `input` to stdin. */
export function runCli(
  cwd: string,
  args: string[],
  { input = "", env = {} }: { input?: string; env?: Record<string, string> } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, FTL_PREVIEW_CACHE_DIR: testCacheDir, ...env },
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * runCli without blocking the test process, for commands that call back into it (e.g. download
 * from a fake Maven repository served by the test itself).
 */
export function runCliAsync(
  cwd: string,
  args: string[],
  { input = "", env = {} }: { input?: string; env?: Record<string, string> } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, FTL_PREVIEW_CACHE_DIR: testCacheDir, ...env },
    timeout: 120_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
