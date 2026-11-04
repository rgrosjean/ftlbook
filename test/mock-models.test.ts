import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, fixture, copyProject, configure, tempDir, type RunningServer } from "./harness.ts";
import { startFakeKeycloakRepository } from "./maven-repository.ts";

const MOCK_MODELS_WARNING = /default Mock models/i;

/** Serves a project pinned to a made-up Keycloak version whose login.ftl shows a Mock model value. */
async function serveWithKeycloak(t: { after: (fn: () => Promise<void>) => void }, version: string): Promise<RunningServer> {
  const mirror = await startFakeKeycloakRepository(version, '<html lang="${lang}"><p id="realm">${realm.name}</p></html>');
  t.after(() => mirror.close());
  const project = await copyProject(t, "empty-project");
  await configure(project, { keycloakVersion: version, mavenRepository: mirror.url });
  const server = await startServer(project, { cacheDir: await tempDir(t, "cache") });
  t.after(() => server.stop());
  return server;
}

function mockModelsWarning(server: RunningServer): string | undefined {
  return server.output().split("\n").find((line) => MOCK_MODELS_WARNING.test(line));
}

test("the Keycloak version the defaults were taken from uses them without a warning", async (t) => {
  const server = await startServer(fixture("empty-project"));
  t.after(() => server.stop());

  const html = await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text();
  assert.match(html, /<title>Sign in to myrealm<\/title>/);
  assert.equal(mockModelsWarning(server), undefined);
});

test("another patch release of that Keycloak minor uses the defaults without a warning", async (t) => {
  const server = await serveWithKeycloak(t, "26.8.99");
  assert.match(await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text(), /<p id="realm">myrealm<\/p>/);
  assert.equal(mockModelsWarning(server), undefined);
});

for (const version of ["26.2.0", "99.0.0", "3.4.0"]) {
  test(`Keycloak ${version} without exact defaults uses the nearest supported ones and warns`, async (t) => {
    const server = await serveWithKeycloak(t, version);

    const warning = mockModelsWarning(server);
    assert.ok(warning, `expected a warning about default Mock models in:\n${server.output()}`);
    // Names the requested version and the version the used defaults were taken from
    assert.match(warning, new RegExp(`Keycloak ${version.replaceAll(".", "\\.")}\\b`));
    assert.match(warning, /Keycloak 26\.8\.1\b/);
    assert.match(await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text(), /<p id="realm">myrealm<\/p>/);
  });
}
