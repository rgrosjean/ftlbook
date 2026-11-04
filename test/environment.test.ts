import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, fixture, bin } from "./harness.ts";

/** A directory to use as PATH, holding only the given executables (shell scripts). */
async function pathWith(t: { after: (fn: () => Promise<void>) => void }, scripts: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(path.join(dir, name), `#!/bin/sh\n${body}\n`);
    await chmod(path.join(dir, name), 0o755);
  }
  return dir;
}

test("without Java on the PATH, serve fails naming the JDK requirement", async (t) => {
  const emptyPath = await pathWith(t, {});
  await assert.rejects(
    startServer(fixture("empty-project"), { env: { PATH: emptyPath } }),
    /server exited with 1:[\s\S]*Java was not found on the PATH\. FTL Preview needs a JDK 21 or newer/,
  );
});

test("with a too old Java on the PATH, serve fails naming the found and required versions", async (t) => {
  const oldJava = await pathWith(t, {
    java: `echo 'openjdk version "17.0.2" 2022-01-18' >&2\necho 'OpenJDK Runtime Environment (build 17.0.2+8-86)' >&2`,
  });
  await assert.rejects(
    startServer(fixture("empty-project"), { env: { PATH: oldJava } }),
    /server exited with 1:[\s\S]*FTL Preview needs a JDK 21 or newer, but java on the PATH is version 17/,
  );
});

test("with a too old Node, the ftl-preview command fails naming the found and required versions", async (t) => {
  const oldNode = await findOldNode();
  if (!oldNode) return t.skip("no Node older than 22.18 found (set FTL_PREVIEW_TEST_OLD_NODE to one)");

  const result = spawnSync(oldNode.path, [bin, "serve"], { cwd: fixture("empty-project"), encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, new RegExp(`FTL Preview needs Node\\.js 22\\.18 or newer \\(found ${oldNode.version.replaceAll(".", "\\.")}\\)`));
});

/** An installed Node older than the required 22.18: FTL_PREVIEW_TEST_OLD_NODE, or one managed by nvm. */
async function findOldNode(): Promise<{ path: string; version: string } | undefined> {
  const candidates = process.env.FTL_PREVIEW_TEST_OLD_NODE
    ? [process.env.FTL_PREVIEW_TEST_OLD_NODE]
    : await readdir(path.join(os.homedir(), ".nvm", "versions", "node"))
        .then((versions) => versions.map((v) => path.join(os.homedir(), ".nvm", "versions", "node", v, "bin", "node")))
        .catch(() => []);
  for (const candidate of candidates) {
    const version = spawnSync(candidate, ["--version"], { encoding: "utf8" }).stdout?.trim().replace(/^v/, "");
    const [major, minor] = (version ?? "").split(".").map(Number);
    if (version && (major < 22 || (major === 22 && minor < 18))) return { path: candidate, version };
  }
  return undefined;
}
