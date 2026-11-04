import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, fixture, type RunningServer } from "./harness.ts";

let server: RunningServer;

before(async () => {
  server = await startServer(fixture("empty-project"));
});

after(async () => {
  await server?.stop();
});

test("an unmodified Base theme login.ftl renders its login form with English messages", async () => {
  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`);
  const html = await res.text();

  assert.equal(res.status, 200, html);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /<form id="kc-form-login"/);
  assert.match(html, /<input[^>]+name="username"/);
  assert.match(html, /<input[^>]+name="password"/);
  // English labels from the Base theme's messages_en.properties
  assert.match(html, /Sign in to your account/);
  assert.match(html, /<label[^>]*for="password"[^>]*>\s*(<[^>]+>\s*)*Password/);
  assert.match(html, /<title>Sign in to myrealm<\/title>/);
  assert.match(html, /<html[^>]+lang="en"/);
});
