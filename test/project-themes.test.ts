import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyProject, runCli, startServer, fixture, type RunningServer } from "./harness.ts";

/** href/src values in the rendered Page that end with the given file name. */
function linkTo(html: string, fileName: string): string {
  const match = new RegExp(`(?:href|src)="([^"]*/${fileName.replace(/\./g, "\\.")})"`).exec(html);
  assert.ok(match, `expected the Page to link ${fileName}`);
  return match[1];
}

/** The not-found error names the Project's themes root and the Keycloak version of the Base themes. */
function assertNamesBothPlaces(body: string, project: string) {
  assert.ok(body.includes(`neither a Theme of the Project (looked in ${path.join(project, "themes")})`), body);
  assert.match(body, /nor a Base theme of Keycloak 26\.\d+\.\d+/);
}

describe("a Previewed theme building on other Themes of the Project (themes/<name>/<type>)", () => {
  let server: RunningServer;
  let html: string;
  before(async () => {
    server = await startServer(fixture("project-themes"));
    const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`);
    html = await res.text();
    assert.equal(res.status, 200, html);
  });
  after(async () => {
    await server?.stop();
  });

  test("serves a resource of the common Theme it imports, at the Previewed theme's resource URL", async () => {
    const link = linkTo(html, "shared.css");
    assert.equal(link, "/resources/login/acme/css/shared.css");
    const res = await fetch(new URL(link, server.baseUrl));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /\.acme-shared \{ color: teal; \}/);
  });

  test("renders a Page, with its messages, from the parent Theme of the Project, which builds on a Base theme", () => {
    assert.match(html, /<form id="acme-base-login"/);
    assert.match(html, /<p>Hello from the ACME base Theme<\/p>/);
    // Layout from keycloak.v2's template.ftl, the parent of the parent
    assert.match(html, /id="kc-page-title"/);
  });

  test("uses a message of the common Theme it imports", () => {
    assert.match(html, /<title>ACME shared title<\/title>/);
  });
});

test("add-story lists the Pages of the parent Theme of the Project as a Theme's, not a Base theme's", async (t) => {
  const project = await copyProject(t, "project-themes");
  const result = runCli(project, ["add-story"], { input: "login.ftl\n\n" });
  assert.equal(result.status, 0, result.stderr);
  // login.ftl comes from themes/acme-base/login
  assert.match(result.stdout, /^\s*\d+\. login\.ftl\s+\(Theme\)$/m);
  assert.match(result.stdout, /^\s*\d+\. register\.ftl\s+\(Base theme keycloak\.v2\)$/m);
  assert.match(result.stdout, /Added Story "Default" for login\.ftl/);
});

test("a Theme of the Project takes the place of the Base theme with the same name and type", async (t) => {
  const project = await copyProject(t, "project-themes");
  const shadowing = path.join(project, "themes", "keycloak.v2", "login");
  await mkdir(path.join(shadowing, "resources", "css"), { recursive: true });
  await writeFile(path.join(shadowing, "theme.properties"), "parent=base\n");
  await writeFile(path.join(shadowing, "resources", "css", "styles.css"), ".project-keycloak-v2 { color: red; }\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/resources/login/acme/css/styles.css`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /\.project-keycloak-v2/);
});

test("common resources come from the common Theme of the Project the common theme property names", async (t) => {
  const project = await copyProject(t, "project-themes");
  await appendFile(path.join(project, "themes", "acme", "login", "theme.properties"), "common=common/acme\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const html = await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text();
  // keycloak.v2's template.ftl links its scripts below url.resourcesCommonPath
  assert.match(html, /"\/resources\/common\/acme\/vendor\/rfc4648\/rfc4648\.js"/);
  const res = await fetch(`${server.baseUrl}/resources/common/acme/css/shared.css`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /\.acme-shared/);
});

test("a common Theme of the Project with parent=keycloak serves its own resources, then keycloak/common's", async (t) => {
  const project = await copyProject(t, "project-themes");
  await appendFile(path.join(project, "themes", "acme", "login", "theme.properties"), "common=common/acme\n");
  await writeFile(path.join(project, "themes", "acme", "common", "theme.properties"), "parent=keycloak\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const own = await fetch(`${server.baseUrl}/resources/common/acme/css/shared.css`);
  assert.equal(own.status, 200);
  assert.match(await own.text(), /\.acme-shared/);
  // keycloak.v2's template.ftl links these below url.resourcesCommonPath; Keycloak serves them from keycloak/common
  const script = await fetch(`${server.baseUrl}/resources/common/acme/vendor/rfc4648/rfc4648.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /var base16Encoding = \{/);
  const favicon = await fetch(`${server.baseUrl}/resources/common/acme/img/favicon.ico`);
  assert.equal(favicon.status, 200);
});

test("a parent found neither among the Themes of the Project nor among the Base themes fails naming both places", async (t) => {
  const project = await copyProject(t, "project-themes");
  await writeFile(path.join(project, "themes", "acme-base", "login", "theme.properties"), "parent=acme-missing\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`);
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.match(body, /acme-base\/login\/theme\.properties \(parent\) refers to "login\/acme-missing"/);
  assertNamesBothPlaces(body, project);
});

test("a parent of a common Theme found neither among the Themes of the Project nor among the Base themes fails naming both places", async (t) => {
  const project = await copyProject(t, "project-themes");
  await writeFile(path.join(project, "themes", "acme", "common", "theme.properties"), "parent=acme-missing\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/resources/common/acme/css/shared.css`);
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.match(body, /acme\/common\/theme\.properties \(parent\) refers to "common\/acme-missing"/);
  assertNamesBothPlaces(body, project);
});

test("an import of a common Theme found in neither place fails naming both places", async (t) => {
  const project = await copyProject(t, "project-themes");
  await writeFile(path.join(project, "themes", "acme", "common", "theme.properties"), "import=common/acme-missing\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/resources/common/acme/css/shared.css`);
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.match(body, /acme\/common\/theme\.properties \(import\) refers to "common\/acme-missing"/);
  assertNamesBothPlaces(body, project);
});

test("a parent cycle among common Themes fails as in the Theme chain", async (t) => {
  const project = await copyProject(t, "project-themes");
  await writeFile(path.join(project, "themes", "acme", "common", "theme.properties"), "parent=acme-base\n");
  await mkdir(path.join(project, "themes", "acme-base", "common"));
  await writeFile(path.join(project, "themes", "acme-base", "common", "theme.properties"), "parent=acme\n");
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/resources/common/acme/css/shared.css`);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /Theme parent cycle at .*acme\/common/);
});
