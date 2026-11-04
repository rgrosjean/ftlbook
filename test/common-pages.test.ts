import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, fixture, type RunningServer } from "./harness.ts";

describe("Common Pages and Keycloak helpers", () => {
  let server: RunningServer;
  const story = async (page: string, name: string) => {
    const res = await fetch(`${server.baseUrl}/preview/login/${page}/${name}`);
    const html = await res.text();
    assert.equal(res.status, 200, html);
    return html;
  };

  before(async () => {
    server = await startServer(fixture("common-pages-project"));
  });
  after(async () => {
    await server?.stop();
  });

  for (const [page, marker] of [
    ["register.ftl", /<form id="kc-register-form"/],
    ["login-otp.ftl", /<form id="kc-otp-login-form"/],
    ["login-update-password.ftl", /<form id="kc-passwd-update-form"/],
    ["error.ftl", /<div id="kc-error-message">/],
    ["info.ftl", /<div id="kc-info-message">/],
  ] as const) {
    test(`${page} renders its Default Story`, async () => {
      assert.match(await story(page, "Default"), marker);
    });
  }

  test("a field error given as Story data shows next to its field", async () => {
    const html = await story("register.ftl", "UsernameTaken");
    assert.match(html, /id="input-error-username"[^>]*>\s*<span[^>]*>\s*Username already exists\.\s*</);
    assert.match(html, /<input[^>]+id="username"[^>]+aria-invalid="true"/);
    assert.doesNotMatch(html, /id="input-error-email"/);
    assert.doesNotMatch(await story("register.ftl", "Default"), /id="input-error-username"/);
  });

  test("auth.show*() flags from Story data control the matching UI parts", async () => {
    // As in Keycloak, the user is known on the OTP Page, so its Default Story shows the attempted username
    const byDefault = await story("login-otp.ftl", "Default");
    assert.match(byDefault, /<input id="kc-attempted-username" value="john\.doe" readonly>/);
    assert.doesNotMatch(byDefault, /kc-select-try-another-way-form/);

    assert.doesNotMatch(await story("login-otp.ftl", "UsernameHidden"), /kc-attempted-username/);
    assert.match(await story("login-otp.ftl", "OtherWays"), /<form id="kc-select-try-another-way-form"/);
  });

  test("HTML in a message is sanitized as Keycloak's kcSanitize does", async () => {
    const html = await story("error.ftl", "HtmlMessage");
    const message = /<div id="kc-error-message">\s*<p class="instruction">(.*?)<\/p>/s.exec(html)?.[1];
    // Allowed markup stays, entity-encoded markup is decoded first, scripts and handlers go,
    // links get rel="nofollow" and keep their unescaped href
    assert.equal(
      message,
      '<b>Bold</b> <i>encoded</i> <a href="https://example.com/?a=1&b=2" rel="nofollow">link</a>',
    );
  });

  test("register shows reCAPTCHA when recaptchaRequired is present, even false, as Keycloak checks presence", async () => {
    assert.doesNotMatch(await story("register.ftl", "Default"), /g-recaptcha/);
    const html = await story("register.ftl", "RecaptchaRequiredFalse");
    assert.match(html, /<button[^>]+class="[^"]*g-recaptcha"[^>]+data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"/);
  });
});
