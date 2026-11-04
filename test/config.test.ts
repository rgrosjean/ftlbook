import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startServer, fixture, copyProject, configure, tempDir } from "./harness.ts";
import { startFakeKeycloakRepository } from "./maven-repository.ts";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("the config file's Theme directory, stories directory and port are honored", async (t) => {
  const project = await copyProject(t, "configured-project");
  const port = await freePort();
  await configure(project, { port });

  const server = await startServer(project, { port: null });
  t.after(() => server.stop());
  assert.equal(server.baseUrl, `http://localhost:${port}`);

  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/OtherRealm`);
  const html = await res.text();
  assert.equal(res.status, 200, html);
  assert.match(html, /<p id="configured-theme">Configured Theme for configuredrealm<\/p>/);
});

test("a Theme type other than login is rejected with a clear message", async (t) => {
  const project = await copyProject(t, "configured-project");
  await configure(project, { themeType: "account" });

  await assert.rejects(startServer(project), /server exited with 1:[\s\S]*Theme type "account" is not supported; supported: login/);
});

test("the config's strict flag set to false turns on lenient mode", async (t) => {
  const project = await copyProject(t, "story-project");
  await configure(project, { strict: false });

  const server = await startServer(project);
  t.after(() => server.stop());
  // WithoutRealm deletes a key the Base theme's template.ftl requires: an error in strict mode
  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/WithoutRealm`);
  assert.equal(res.status, 200, await res.text());
});

test("a configured Keycloak version downloads and uses that version's Base theme", async (t) => {
  const mirror = await startFakeKeycloakRepository(
    "99.0.0",
    '<html lang="${lang}"><p id="base-theme">Keycloak 99 Base theme</p></html>',
  );
  t.after(() => mirror.close());
  const cacheDir = await tempDir(t, "cache");
  const project = await copyProject(t, "empty-project");
  await configure(project, { keycloakVersion: "99.0.0", mavenRepository: mirror.url });

  const server = await startServer(project, { cacheDir });
  t.after(() => server.stop());
  assert.match(server.output(), /Downloading Base theme for Keycloak 99\.0\.0/);
  const html = await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text();
  assert.match(html, /<p id="base-theme">Keycloak 99 Base theme<\/p>/);
});
