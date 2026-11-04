import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, fixture } from "./harness.ts";

test("the Base theme is downloaded on first use and reused from the cache afterwards", async (t) => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));

  const first = await startServer(fixture("empty-project"), { cacheDir });
  await first.stop();
  assert.match(first.output(), /Downloading Base theme for Keycloak/);

  const second = await startServer(fixture("empty-project"), { cacheDir });
  try {
    const res = await fetch(`${second.baseUrl}/preview/login/login.ftl/Default`);
    assert.equal(res.status, 200);
  } finally {
    await second.stop();
  }
  assert.doesNotMatch(second.output(), /Downloading/);
});

test("stopping serve also stops the Renderer", async () => {
  const server = await startServer(fixture("empty-project"));
  const rendererPids = childPids(server.process.pid!);
  assert.ok(rendererPids.length > 0, "expected serve to have started a Renderer process");

  await server.stop();

  await waitFor(() => rendererPids.every((pid) => !isAlive(pid)), 10_000);
});

function childPids(pid: number): number[] {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail("condition not met in time");
    await new Promise((r) => setTimeout(r, 100));
  }
}
