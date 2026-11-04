import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, fixture } from "./harness.ts";

/** A writable copy of a fixture project, removed after the test. */
async function copyProject(t: { after: (fn: () => Promise<void>) => void }, name: string): Promise<string> {
  const project = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-project-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(fixture(name), project, { recursive: true });
  return project;
}

test("a Page with an FTL syntax error shows an error overlay naming the file and line", async (t) => {
  const project = await copyProject(t, "story-project");
  const loginFtl = path.join(project, "theme", "login", "login.ftl");
  // Line 9 gets an unclosed interpolation
  const lines = (await readFile(loginFtl, "utf8")).split("\n");
  lines[8] = '            <li id="realm-name">${realm.name</li>';
  await writeFile(loginFtl, lines.join("\n"));

  const server = await startServer(project);
  t.after(() => server.stop());
  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`);
  const html = await res.text();

  assert.equal(res.status, 500);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /<title>Render failed/);
  assert.ok(html.includes(loginFtl), `overlay should name ${loginFtl}:\n${html}`);
  assert.match(html, /line 9/);
});

test("a Story that deletes a required Mock model key shows an overlay naming the key", async (t) => {
  const server = await startServer(fixture("story-project"));
  t.after(() => server.stop());
  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/WithoutRealm`);
  const html = await res.text();

  assert.equal(res.status, 500);
  assert.match(html, /<title>Render failed/);
  // FreeMarker names the missing expression; the Base theme's template.ftl reads realm first
  assert.match(html, /evaluated to null or missing/);
  assert.match(html, /==&#62; realm\s+\[in template &#34;template\.ftl&#34; at line \d+, column \d+\]/);
  assert.match(html, /template\.ftl, line \d+, column \d+/);
  assert.match(html, /class="line failing"/);
});

test("with --lenient, a Story missing a required key still renders", async (t) => {
  const server = await startServer(fixture("story-project"), { args: ["--lenient"] });
  t.after(() => server.stop());
  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/WithoutRealm`);
  const html = await res.text();

  assert.equal(res.status, 200, html);
  // The rest of the Page is there; only the failing parts are skipped
  assert.match(html, /<ul id="probe">/);
  assert.match(html, /<li id="social">present<\/li>/);
  // The skipped problems are reported in the server output
  assert.match(server.output(), /realm/);
});

test("the Renderer keeps serving after a failed render", async (t) => {
  const server = await startServer(fixture("story-project"));
  t.after(() => server.stop());
  for (let i = 0; i < 3; i++) {
    assert.equal((await fetch(`${server.baseUrl}/preview/login/login.ftl/WithoutRealm`)).status, 500);
  }
  const ok = await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /<li id="realm-name">myrealm<\/li>/);
});
