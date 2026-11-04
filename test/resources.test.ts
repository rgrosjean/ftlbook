import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, fixture, type RunningServer } from "./harness.ts";

/** href/src values in the rendered Page that end with the given file name. */
function linkTo(html: string, fileName: string): string {
  const match = new RegExp(`(?:href|src)="([^"]*/${fileName.replace(/\./g, "\\.")})"`).exec(html);
  assert.ok(match, `expected the Page to link ${fileName}`);
  return match[1];
}

describe("resources of a Theme layered over the Base theme", () => {
  let server: RunningServer;
  let html: string;
  before(async () => {
    server = await startServer(fixture("overriding-theme"));
    html = await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text();
  });
  after(async () => {
    await server?.stop();
  });

  test("links the Theme's resources under the Theme's name, like Keycloak's url.resourcesPath", async () => {
    // The Theme lives in theme/login, so Keycloak would name it "theme"
    assert.equal(linkTo(html, "acme.css"), "/resources/login/theme/css/acme.css");
  });

  test("serves a CSS file from the Theme's resources at the URL the Page links to", async () => {
    const res = await fetch(new URL(linkTo(html, "acme.css"), server.baseUrl));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await res.text(), /\.acme-form \{ border: 2px solid hotpink; \}/);
  });

  test("serves a resource the Theme lacks from the Base theme", async () => {
    const res = await fetch(new URL(linkTo(html, "styles.css"), server.baseUrl));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/css/);
    // keycloak.v2's own styles.css
    assert.match(await res.text(), /--keycloak-logo-url/);
  });

  test("serves vendor assets the Base theme links to (PatternFly from the keycloak-themes-vendor jar)", async () => {
    const res = await fetch(new URL(linkTo(html, "patternfly.min.css"), server.baseUrl));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await res.text(), /pf-v5-c-/);
  });

  test("answers 404 for a resource no Theme in the chain has, and for paths escaping resources/", async () => {
    const missing = await fetch(`${server.baseUrl}/resources/login/keycloak.v2/css/nope.css`);
    assert.equal(missing.status, 404);
    const escaping = await fetch(`${server.baseUrl}/resources/login/keycloak.v2/..%2Ftheme.properties`);
    assert.equal(escaping.status, 404);
  });
});

test("without a Theme, the Page links the Base theme's resources and the common resources Keycloak names", async (t) => {
  const server = await startServer(fixture("empty-project"));
  t.after(() => server.stop());
  const html = await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text();

  assert.equal(linkTo(html, "favicon.ico"), "/resources/login/keycloak.v2/img/favicon.ico");
  // keycloak.v2 sets no "common" theme property, so Keycloak falls back to common/keycloak
  assert.match(html, /"\/resources\/common\/keycloak\/vendor\/rfc4648\/rfc4648\.js"/);
});

test("a resource changed on disk is served fresh on the next request, without restarting", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-project-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(fixture("overriding-theme"), project, { recursive: true });
  const cssFile = path.join(project, "theme", "login", "resources", "css", "acme.css");

  const server = await startServer(project);
  t.after(() => server.stop());
  const url = `${server.baseUrl}/resources/login/keycloak.v2/css/acme.css`;

  assert.match(await (await fetch(url)).text(), /hotpink/);
  await writeFile(cssFile, ".acme-form { border: 2px solid rebeccapurple; }\n");
  assert.match(await (await fetch(url)).text(), /rebeccapurple/);
});
