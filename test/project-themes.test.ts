import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyProject, runCli, startServer, fixture, type RunningServer } from "./harness.ts";
import { DEFAULT_STORY, storyUrl } from "../src/stories.ts";

/** The Default Story of the Page every test here renders. */
const LOGIN_STORY_URL = storyUrl("login", "login.ftl", DEFAULT_STORY);

/** href/src values in the rendered Page that end with the given file name. */
function linkTo(html: string, fileName: string): string {
  const match = new RegExp(`(?:href|src)="([^"]*/${fileName.replace(/\./g, "\\.")})"`).exec(html);
  assert.ok(match, `expected the Page to link ${fileName}`);
  return match[1];
}

/** Text of an HTML page with its character references decoded, as the developer reads it. */
function textOf(html: string): string {
  return html.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/**
 * A broken Theme chain or Common theme chain fails everywhere: the Page shows the error overlay, the preview UI shows the error
 * in its sidebar, and a resource request answers 500 with the error itself, not as an internal error of FTL Preview.
 */
async function assertFailsEverywhere(server: RunningServer, expected: RegExp): Promise<string> {
  const page = await fetch(`${server.baseUrl}${LOGIN_STORY_URL}`);
  assert.equal(page.status, 500);
  const overlay = await page.text();
  assert.match(overlay, /id="ftl-preview-error"/);
  assert.match(overlay, /<h1>Broken Theme chain<\/h1>/);
  const message = /<pre class="message">([^<]*)<\/pre>/.exec(overlay)?.[1];
  assert.ok(message, overlay);
  assert.match(textOf(message), expected);

  const ui = await fetch(server.baseUrl);
  assert.equal(ui.status, 200);
  const sidebarProblem = /<p class="problem">([^<]*)<\/p>/.exec(await ui.text())?.[1];
  assert.equal(sidebarProblem && textOf(sidebarProblem), textOf(message));

  const resource = await fetch(`${server.baseUrl}/resources/login/acme/css/styles.css`);
  assert.equal(resource.status, 500);
  assert.equal(await resource.text(), textOf(message));
  return textOf(message);
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
    const res = await fetch(`${server.baseUrl}${LOGIN_STORY_URL}`);
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

  const html = await (await fetch(`${server.baseUrl}${LOGIN_STORY_URL}`)).text();
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

  const message = await assertFailsEverywhere(server, /acme-base\/login\/theme\.properties \(parent\) refers to "login\/acme-missing"/);
  assertNamesBothPlaces(message, project);
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
  assert.doesNotMatch(body, /Internal error/);
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

describe("a broken Common theme chain of the common theme the common theme property names", () => {
  const commonProperties = (project: string) => path.join(project, "themes", "acme", "common", "theme.properties");
  const setCommon = (project: string, value: string) =>
    appendFile(path.join(project, "themes", "acme", "login", "theme.properties"), `common=${value}\n`);

  test("a parent found in neither place fails the Page, the preview UI and resource requests", async (t) => {
    const project = await copyProject(t, "project-themes");
    await setCommon(project, "common/acme");
    await writeFile(commonProperties(project), "parent=acme-missing\n");
    const server = await startServer(project);
    t.after(() => server.stop());

    const message = await assertFailsEverywhere(server, /acme\/common\/theme\.properties \(parent\) refers to "common\/acme-missing"/);
    assertNamesBothPlaces(message, project);
    const common = await fetch(`${server.baseUrl}/resources/common/acme/css/shared.css`);
    assert.equal(common.status, 500);
    assert.equal(await common.text(), message);
  });

  test("an import found in neither place fails the Page", async (t) => {
    const project = await copyProject(t, "project-themes");
    await setCommon(project, "common/acme");
    await writeFile(commonProperties(project), "import=common/acme-missing\n");
    const server = await startServer(project);
    t.after(() => server.stop());

    const message = await assertFailsEverywhere(server, /acme\/common\/theme\.properties \(import\) refers to "common\/acme-missing"/);
    assertNamesBothPlaces(message, project);
  });

  test("a parent cycle fails the Page", async (t) => {
    const project = await copyProject(t, "project-themes");
    await setCommon(project, "common/acme");
    await writeFile(commonProperties(project), "parent=acme-base\n");
    await mkdir(path.join(project, "themes", "acme-base", "common"));
    await writeFile(path.join(project, "themes", "acme-base", "common", "theme.properties"), "parent=acme\n");
    const server = await startServer(project);
    t.after(() => server.stop());

    await assertFailsEverywhere(server, /^Theme parent cycle at .*acme\/common$/);
  });

  test("a common theme found in neither place fails the Page, naming the most specific theme.properties that sets it", async (t) => {
    const project = await copyProject(t, "project-themes");
    await appendFile(path.join(project, "themes", "acme-base", "login", "theme.properties"), "common=common/acme-missing\n");
    const server = await startServer(project);
    t.after(() => server.stop());

    const message = await assertFailsEverywhere(server, /refers to "common\/acme-missing"/);
    const file = path.join(project, "themes", "acme-base", "login", "theme.properties");
    assert.ok(message.startsWith(`${file} (common) refers to "common/acme-missing", which is neither a Theme of the Project`), message);
    assertNamesBothPlaces(message, project);
  });

  for (const value of ["acme", "login/acme", "common/acme/extra", "common/"]) {
    test(`common=${value} fails the Page as not common/<name>`, async (t) => {
      const project = await copyProject(t, "project-themes");
      await setCommon(project, value);
      const server = await startServer(project);
      t.after(() => server.stop());

      const file = path.join(project, "themes", "acme", "login", "theme.properties");
      const message = await assertFailsEverywhere(server, /common must be/);
      assert.equal(message, `${file}: common must be "common/<name>", got "${value}"`);
    });
  }

  test("common=common/keycloak renders the Page and serves keycloak/common's resources", async (t) => {
    const project = await copyProject(t, "project-themes");
    await setCommon(project, "common/keycloak");
    const server = await startServer(project);
    t.after(() => server.stop());

    const page = await fetch(`${server.baseUrl}${LOGIN_STORY_URL}`);
    const html = await page.text();
    assert.equal(page.status, 200, html);
    assert.match(html, /"\/resources\/common\/keycloak\/vendor\/rfc4648\/rfc4648\.js"/);
    const script = await fetch(`${server.baseUrl}/resources/common/keycloak/vendor/rfc4648/rfc4648.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /var base16Encoding = \{/);
  });
});
