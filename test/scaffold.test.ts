import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fixture, runCli, copyProject, startServer } from "./harness.ts";

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8"));
}

test("model login.ftl prints the default Mock model as JSON", () => {
  const result = runCli(fixture("empty-project"), ["model", "login.ftl"]);
  assert.equal(result.status, 0, result.stderr);

  const model = JSON.parse(result.stdout);
  assert.equal(model.realm.name, "myrealm");
  assert.equal(model.url.loginAction, "#");
  assert.deepEqual(model.social, { providers: [] });
});

test("model for a Page without a default Mock model fails naming the Pages that have one", () => {
  const result = runCli(fixture("empty-project"), ["model", "webauthn-register.ftl"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No default Mock model for webauthn-register\.ftl/);
  assert.match(result.stderr, /login\.ftl/);
});

test("add-story with flags writes minimal Story files that render at their stable URLs", async (t) => {
  const project = await copyProject(t, "empty-project");
  const result = runCli(project, ["add-story", "--page", "register.ftl", "--page", "login-otp.ftl", "--story", "Default"]);
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual(await readJson(path.join(project, "stories", "register.stories.json")), {
    page: "register.ftl",
    stories: { Default: {} },
  });
  assert.deepEqual(await readJson(path.join(project, "stories", "login-otp.stories.json")), {
    page: "login-otp.ftl",
    stories: { Default: {} },
  });
  assert.match(result.stdout, /\/preview\/login\/register\.ftl\/Default/);

  const server = await startServer(project);
  t.after(() => server.stop());
  for (const page of ["register.ftl", "login-otp.ftl"]) {
    const res = await fetch(`${server.baseUrl}/preview/login/${page}/Default`);
    assert.equal(res.status, 200, await res.text());
  }
  const index = await (await fetch(`${server.baseUrl}/api/stories`)).json();
  assert.deepEqual(index.pages.map((p: { page: string }) => p.page), ["login-otp.ftl", "register.ftl"]);
});

test("adding a Story to a Page with a Story file keeps the existing Stories", async (t) => {
  const project = await copyProject(t, "story-project");
  const file = path.join(project, "stories", "login.stories.json");
  const before = await readJson(file);

  const result = runCli(project, ["add-story", "--page", "login.ftl", "--story", "Expired"]);
  assert.equal(result.status, 0, result.stderr);

  const after = await readJson(file);
  assert.deepEqual(after, { ...before, stories: { ...before.stories, Expired: {} } });
});

test("adding a Story name the Page already has fails and leaves the file unchanged", async (t) => {
  const project = await copyProject(t, "story-project");
  const file = path.join(project, "stories", "login.stories.json");
  const before = await readFile(file, "utf8");

  const result = runCli(project, ["add-story", "--page", "login.ftl", "--story", "WithError"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /login\.ftl already has a Story "WithError"/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("interactive add-story lists overridden and inherited Pages, then adds the chosen ones", async (t) => {
  const project = await copyProject(t, "overriding-theme");
  const result = runCli(project, ["add-story"], { input: "login.ftl, register.ftl\nBlankForm\n" });
  assert.equal(result.status, 0, result.stderr);

  // login.ftl is overridden by the Theme; register.ftl is inherited from the Base theme
  assert.match(result.stdout, /^\s*\d+\. login\.ftl\s+\(Theme\)$/m);
  assert.match(result.stdout, /^\s*\d+\. register\.ftl\s+\(Base theme keycloak\.v2\)$/m);
  assert.match(result.stdout, /^\s*\d+\. webauthn-register\.ftl\s+\(Base theme \S+, no default Mock model yet\)$/m);
  // FTL files that others import (macro libraries) are not Pages
  assert.doesNotMatch(result.stdout, /\. (template|field|buttons)\.ftl/);

  for (const page of ["login", "register"]) {
    assert.deepEqual(await readJson(path.join(project, "stories", `${page}.stories.json`)), {
      page: `${page}.ftl`,
      stories: { BlankForm: {} },
    });
  }
});

test("interactive add-story accepts list numbers and defaults the Story name to Default", async (t) => {
  const project = await copyProject(t, "overriding-theme");
  const listed = runCli(project, ["add-story"], { input: "" });
  const number = /^\s*(\d+)\. info\.ftl\s/m.exec(listed.stdout)?.[1];
  assert.ok(number, listed.stdout);

  const result = runCli(project, ["add-story"], { input: `${number}\n\n` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readJson(path.join(project, "stories", "info.stories.json")), {
    page: "info.ftl",
    stories: { Default: {} },
  });
});
