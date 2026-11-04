import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { copyProject, fixture, killRenderer, startServer } from "./harness.ts";

test("after the Renderer process dies, the next preview request restarts it and renders the Story", async (t) => {
  const server = await startServer(fixture("empty-project"));
  t.after(() => server.stop());
  const url = `${server.baseUrl}/preview/login/login.ftl/Default`;
  assert.equal((await fetch(url)).status, 200);

  await killRenderer(server);

  const res = await fetch(url);
  assert.equal(res.status, 200, await res.clone().text());
  assert.match(await res.text(), /<form/);
});

test("a Renderer error response shows an error overlay naming the Renderer", async (t) => {
  const project = await copyProject(t, "overriding-theme");
  // The Renderer cannot read the Theme's messages: it answers with an error rather than a located render error
  const messages = path.join(project, "theme", "login", "messages", "messages_en.properties");
  await chmod(messages, 0o000);
  const server = await startServer(project);
  t.after(() => server.stop());

  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`);
  assert.equal(res.status, 500);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<h1>Renderer failed<\/h1>/);
  assert.match(html, /messages_en\.properties/);
});
