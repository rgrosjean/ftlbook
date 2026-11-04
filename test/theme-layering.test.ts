import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, fixture, type RunningServer } from "./harness.ts";

async function get(server: RunningServer, path: string) {
  const res = await fetch(`${server.baseUrl}${path}`);
  const html = await res.text();
  assert.equal(res.status, 200, html);
  return html;
}

describe("a Theme that overrides login.ftl", () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer(fixture("overriding-theme"));
  });
  after(async () => {
    await server?.stop();
  });

  test("renders its own login.ftl instead of the Base theme's", async () => {
    const html = await get(server, "/preview/login/login.ftl/Default");
    assert.match(html, /<form id="acme-login"/);
    assert.match(html, /ACME custom login page/);
    assert.doesNotMatch(html, /id="kc-form-login"/);
  });

  test("imports template.ftl from the Base theme when the Theme does not override it", async () => {
    const html = await get(server, "/preview/login/login.ftl/Default");
    // Layout markup from the Base theme's template.ftl around the Theme's own form
    assert.match(html, /id="kc-page-title"/);
  });

  test("uses the Theme's message override and falls back to the Base theme for other keys", async () => {
    const html = await get(server, "/preview/login/login.ftl/Default");
    assert.match(html, /Welcome to ACME/);
    assert.doesNotMatch(html, /Sign in to your account/);
    assert.match(html, /<button type="submit">Sign In<\/button>/);
  });

  test("falls back like Keycloak for a locale the Theme lacks (de-CH -> de -> en)", async () => {
    const html = await get(server, "/preview/login/login.ftl/Default?locale=de-CH");
    assert.match(html, /<html[^>]+lang="de-CH"/);
    // No de or de_CH bundle in the Theme or Base theme for de_CH: German comes from the Base theme's de bundle
    assert.match(html, /<button type="submit">Anmelden<\/button>/);
    // Per locale, more specific locales win: the Base theme's de value beats the Theme's en override
    assert.match(html, /Bei Ihrem Konto anmelden/);
  });

  test("merges theme.properties so the Theme's values win over the Base theme's", async () => {
    const html = await get(server, "/preview/login/login.ftl/Default");
    assert.match(html, /<form id="acme-login" class="acme-form"/);
  });
});

describe("a Theme that overrides only template.ftl", () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer(fixture("layout-theme"));
  });
  after(async () => {
    await server?.stop();
  });

  test("renders the inherited login.ftl from the Base theme, inside the Theme's own template.ftl", async () => {
    const html = await get(server, "/preview/login/login.ftl/Default");
    // Layout from the Theme's template.ftl
    assert.match(html, /<div id="acme-layout">/);
    // Page body from the Base theme's login.ftl
    assert.match(html, /<form id="kc-form-login"/);
    // The Base theme's own layout is not used
    assert.doesNotMatch(html, /id="kc-page-title"/);
  });
});
