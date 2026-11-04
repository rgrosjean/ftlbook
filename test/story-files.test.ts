import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, fixture, type RunningServer } from "./harness.ts";

function probe(html: string, id: string): string {
  const match = new RegExp(`<li id="${id}">([^<]*)</li>`).exec(html);
  assert.ok(match, `probe ${id} missing in:\n${html}`);
  return match[1];
}

describe("Stories from JSON Story files", () => {
  let server: RunningServer;
  const story = async (name: string, query = "") => {
    const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/${name}${query}`);
    const html = await res.text();
    assert.equal(res.status, 200, html);
    return html;
  };

  before(async () => {
    server = await startServer(fixture("story-project"));
  });
  after(async () => {
    await server?.stop();
  });

  test("a Story overriding message renders the error message", async () => {
    const html = await story("WithError");
    assert.match(html, /kc-feedback-text">Invalid username or password\.</);
    assert.doesNotMatch(await story("Default"), /kc-feedback-text/);
  });

  test("nested overrides merge with the default Mock model instead of replacing it", async () => {
    const html = await story("RegistrationDisabled");
    assert.equal(probe(html, "registration-allowed"), "false");
    // Sibling realm fields keep their defaults
    assert.equal(probe(html, "realm-name"), "myrealm");
    assert.match(html, /<title>Sign in to myrealm<\/title>/);
  });

  test("an array override replaces the default array", async () => {
    assert.equal(probe(await story("Default"), "providers"), "");
    assert.equal(probe(await story("WithProviders"), "providers"), "[google]");
  });

  test("a null override removes the key, as templates test for presence", async () => {
    assert.equal(probe(await story("Default"), "social"), "present");
    assert.equal(probe(await story("WithoutSocial"), "social"), "absent");
  });

  test("a Story's locale selects the message bundle, and ?locale= overrides it", async () => {
    const german = await story("German");
    assert.match(german, /<html[^>]+lang="de"/);
    assert.match(german, /Bei Ihrem Konto anmelden/);
    assert.match(await story("German", "?locale=en"), /Sign in to your account/);
  });

  test("an unknown Story answers 404", async () => {
    const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/NoSuchStory`);
    assert.equal(res.status, 404);
  });
});

test("Story files are re-read on every request", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-project-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(fixture("story-project"), project, { recursive: true });
  const server = await startServer(project);
  t.after(() => server.stop());
  const url = `${server.baseUrl}/preview/login/login.ftl/Renamed`;

  assert.equal((await fetch(url)).status, 404);
  await writeFile(
    path.join(project, "stories", "extra.stories.json"),
    JSON.stringify({ page: "login.ftl", stories: { Renamed: { model: { realm: { name: "otherrealm" } } } } }),
  );
  const html = await (await fetch(url)).text();
  assert.equal(probe(html, "realm-name"), "otherrealm");
});

test("an invalid Story file is reported with its file name", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-project-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(fixture("story-project"), project, { recursive: true });
  await writeFile(path.join(project, "stories", "broken.stories.json"), "{ not json");
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/WithError`);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /broken\.stories\.json is not valid JSON/);
});
