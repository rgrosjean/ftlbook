import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, runCliAsync, copyProject, configure, tempDir } from "./harness.ts";
import { startFakeKeycloakRepository } from "./maven-repository.ts";

const DOWNLOADING = /Downloading Base theme for Keycloak 99\.0\.0/;

/** A Project pinned to a made-up Keycloak version served by a local mirror, with an empty cache. */
async function projectNeedingDownload(t: Parameters<typeof tempDir>[0]) {
  const mirror = await startFakeKeycloakRepository("99.0.0", '<html lang="${lang}"><p>Keycloak 99</p></html>');
  t.after(() => mirror.close());
  const cacheDir = await tempDir(t, "cache");
  const project = await copyProject(t, "empty-project");
  await configure(project, { keycloakVersion: "99.0.0", mavenRepository: mirror.url });
  return { project, cacheDir };
}

test("serve reports the Base theme download on stderr, keeping stdout for its result", async (t) => {
  const { project, cacheDir } = await projectNeedingDownload(t);

  const server = await startServer(project, { cacheDir });
  await server.stop();
  assert.match(server.stderr(), DOWNLOADING);
  assert.doesNotMatch(server.stdout(), DOWNLOADING);
  assert.match(server.stdout(), /Preview running at http:\/\//);
});

test("add-story reports the Base theme download on stderr, keeping stdout for its result", async (t) => {
  const { project, cacheDir } = await projectNeedingDownload(t);

  const result = await runCliAsync(project, ["add-story", "--page", "login.ftl"], { env: { FTL_PREVIEW_CACHE_DIR: cacheDir } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, DOWNLOADING);
  assert.doesNotMatch(result.stdout, DOWNLOADING);
  assert.match(result.stdout, /Added Story "Default" for login\.ftl/);
});
