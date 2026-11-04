import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { childPids, isAlive, startServer, fixture, testCacheDir, waitFor } from "./harness.ts";

test("the Base theme is downloaded on first use and reused from the cache afterwards", async (t) => {
  // Make sure the shared test cache holds the jars, then serve them from a local Maven mirror,
  // so a cold cache is exercised without downloading ~17 MB from Maven Central on every run.
  await (await startServer(fixture("empty-project"))).stop();
  const mirror = await startMavenMirror();
  t.after(() => mirror.close());

  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const env = { FTL_PREVIEW_MAVEN_REPO: mirror.url };

  const first = await startServer(fixture("empty-project"), { cacheDir, env });
  await first.stop();
  assert.match(first.output(), /Downloading Base theme for Keycloak/);
  assert.deepEqual(mirror.requested.map((p) => path.basename(p)).sort(), [
    "keycloak-themes-26.8.1.jar",
    "keycloak-themes-vendor-26.8.1.jar",
  ]);

  const second = await startServer(fixture("empty-project"), { cacheDir, env });
  try {
    const res = await fetch(`${second.baseUrl}/preview/login/login.ftl/Default`);
    assert.equal(res.status, 200);
  } finally {
    await second.stop();
  }
  assert.doesNotMatch(second.output(), /Downloading/);
  assert.equal(mirror.requested.length, 2, "the second start must not download again");
});

/** Serves /org/keycloak/<artifact>/<version>/<file> from the shared test cache, recording each request. */
async function startMavenMirror() {
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    const match = /^\/org\/keycloak\/[\w.-]+\/([\w.-]+)\/([\w.-]+\.jar)$/.exec(req.url ?? "");
    const file = match && path.join(testCacheDir, "keycloak", match[1], match[2]);
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    requested.push(req.url!);
    res.writeHead(200, { "content-type": "application/java-archive" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requested,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("stopping serve also stops the Renderer", async () => {
  const server = await startServer(fixture("empty-project"));
  const rendererPids = childPids(server.process.pid!);
  assert.ok(rendererPids.length > 0, "expected serve to have started a Renderer process");

  await server.stop();

  await waitFor(() => rendererPids.every((pid) => !isAlive(pid)), 10_000);
});
