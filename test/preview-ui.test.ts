import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, fixture, type RunningServer } from "./harness.ts";

describe("the preview UI of a project with Story files", () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer(fixture("story-project"));
  });
  after(async () => {
    await server?.stop();
  });

  test("lists every Page with a Story file and its Stories, with their stable URLs", async () => {
    const res = await fetch(`${server.baseUrl}/api/stories`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.pages, [
      {
        themeType: "login",
        page: "login.ftl",
        stories: [
          { name: "Default", url: "/preview/login/login.ftl/Default" },
          { name: "WithError", url: "/preview/login/login.ftl/WithError" },
          { name: "RegistrationDisabled", url: "/preview/login/login.ftl/RegistrationDisabled" },
          { name: "WithProviders", url: "/preview/login/login.ftl/WithProviders" },
          { name: "WithoutSocial", url: "/preview/login/login.ftl/WithoutSocial" },
          { name: "WithoutRealm", url: "/preview/login/login.ftl/WithoutRealm" },
          { name: "German", url: "/preview/login/login.ftl/German" },
        ],
      },
    ]);
  });

  test("the UI shows a sidebar whose Story links load the Story's stable URL in the preview iframe", async () => {
    const res = await fetch(`${server.baseUrl}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /<iframe[^>]+name="preview"/);
    assert.match(html, /login\.ftl/);
    for (const name of ["Default", "WithError", "German"]) {
      const link = new RegExp(`<a[^>]+href="/preview/login/login\\.ftl/${name}"[^>]*target="preview"[^>]*>${name}</a>`);
      assert.match(html, link);
    }
  });

  test("the locale selector offers the Theme's locales, defaulting to each Story's own locale", async () => {
    const html = await (await fetch(`${server.baseUrl}/`)).text();
    const select = /<select[^>]+id="locale"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    assert.ok(select, "expected a locale selector");
    const values = [...select[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    // First option keeps the Story's locale; then the locales from the Base theme's theme.properties
    assert.equal(values[0], "");
    for (const locale of ["de", "en", "fr", "zh-TW"]) assert.ok(values.includes(locale), `missing ${locale}`);
  });

  test("the viewport toggle offers desktop, tablet and mobile widths for the preview iframe", async () => {
    const html = await (await fetch(`${server.baseUrl}/`)).text();
    const widths = [...html.matchAll(/<button[^>]+data-viewport-width="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(
      (m) => `${m[2]}=${m[1]}`,
    );
    assert.deepEqual(widths, ["Desktop=100%", "Tablet=768px", "Mobile=375px"]);
  });
});
