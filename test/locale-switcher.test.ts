import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyProject, startServer, type RunningServer } from "./harness.ts";

/** The options of keycloak.v2's locale switcher, as [label, link, selected]. */
function switcherOptions(html: string): [string, string, boolean][] {
  const select = /<select[^>]*id="login-select-toggle"[\s\S]*?<\/select>/.exec(html);
  assert.ok(select, "expected the locale switcher");
  return [...select[0].matchAll(/<option\s+value="([^"]*)"\s*(selected)?\s*>\s*([^<]*?)\s*<\/option>/g)].map(
    ([, url, selected, label]) => [label, url.replaceAll("&amp;", "&"), selected === "selected"],
  );
}

const storyPath = "/preview/login/login.ftl/Multilingual";

/**
 * A Project without a Theme whose only Story turns internationalization on for four locales, one of them
 * (tlh, Klingon) not among the Base theme's locales.
 */
async function multilingualProject(t: TestContext): Promise<RunningServer> {
  const project = await copyProject(t, "empty-project");
  await mkdir(path.join(project, "stories"), { recursive: true });
  await writeFile(
    path.join(project, "stories", "login.stories.json"),
    JSON.stringify({
      page: "login.ftl",
      stories: {
        Multilingual: {
          model: { realm: { internationalizationEnabled: true, supportedLocales: ["en", "de", "ar", "tlh"] } },
        },
      },
    }),
  );
  const server = await startServer(project);
  t.after(() => server.stop());
  return server;
}

test("a Story with internationalization renders in strict mode with a locale switcher linking the same Story in each locale", async (t) => {
  const server = await multilingualProject(t);
  const res = await fetch(`${server.baseUrl}${storyPath}`);
  assert.equal(res.status, 200, await res.clone().text());
  // Labels as Keycloak's theme manager builds them for the Base theme's locales: the language's name in
  // the current locale, followed by its own name unless it is the current one; a locale the Theme does not
  // list keeps its tag as label. Sorted by label
  assert.deepEqual(switcherOptions(await res.text()), [
    ["Arabic (العربية)", `${storyPath}?locale=ar`, false],
    ["English", `${storyPath}?locale=en`, true],
    ["German (Deutsch)", `${storyPath}?locale=de`, false],
    ["tlh", `${storyPath}?locale=tlh`, false],
  ]);
});

test("a locale switcher link opens the Story in the chosen locale, right to left for Arabic", async (t) => {
  const server = await multilingualProject(t);
  const html = await (await fetch(`${server.baseUrl}${storyPath}?locale=ar`)).text();
  assert.match(html, /<html[^>]*lang="ar"[^>]*dir="rtl"/);
  const selected = switcherOptions(html).find(([, , isSelected]) => isSelected);
  assert.equal(selected?.[1], `${storyPath}?locale=ar`);
});
