# Research: rendering Keycloak login FTL Pages outside Keycloak

Status: research note, 2026-11-04. Terms follow `GLOSSARY.md` (Theme, Base theme, Page, Story, Mock model).

## Sources and versions read

All claims come from these primary sources. Line numbers refer to these exact revisions.

| Abbrev. | Source | Revision |
|---|---|---|
| **KC** | `https://github.com/keycloak/keycloak/blob/26.8.1/…` | tag `26.8.1` (commit `24ed1dadf3f2`), the latest release on 2026-11-04 |
| **KC-JAR** | `https://repo1.maven.org/maven2/org/keycloak/keycloak-themes/26.8.1/keycloak-themes-26.8.1.jar` (plus `keycloak-themes-vendor-26.8.1.jar`) | 26.8.1, downloaded and listed |
| **KC-DOCS** | `https://www.keycloak.org/ui-customization/themes` | fetched 2026-11-04 |
| **KFY** | `https://github.com/keycloakify/keycloakify/blob/v11.16.4/…` | tag `v11.16.4` (commit `5db584cd88ec`) |
| **LUI** | `https://github.com/keycloakify/login-ui/blob/844dac1ad7f3/…` | `main` HEAD, package `@keycloakify/login-ui@250004.8.2` |
| **LUS** | `https://github.com/keycloakify/login-ui-storybook/blob/376a188cae8d/…` | `main` HEAD, package `@keycloakify/login-ui-storybook@250004.2.0` |

On top of reading the sources, I built a throwaway spike that renders the real `keycloak.v2` login Pages from KC-JAR with a JSON model (FreeMarker 2.3.35 and Jackson only). Section 5 describes it.

---

## 1. Keycloakify: Storybook stories, default mocks, overrides

### 1.1 How stories get into a project (CLI)

- **`keycloakify initialize-login-theme`** (KFY `src/bin/initialize-login-theme.ts`):
  - It asks "Do you want to install the Stories?". If the answer is yes and the bundler is Vite, it adds `storybook` and `@storybook/react-vite` (`^10.4.2`) devDependencies and the `storybook` / `build-storybook` scripts. It also writes `.storybook/main.ts` and `.storybook/preview.ts` (lines ~95–165).
  - It adds the npm dependency **`@keycloakify/login-ui`**, the React port of the Keycloak login v2 Pages (line ~170).
  - When stories are wanted, it also adds the devDependency **`@keycloakify/login-ui-storybook`**, unless another extension module already ships `login/pages/**.stories.tsx` (lines ~181–210).
  - It rewrites `main.dev.tsx` to render `getKcContextMock({ pageId: "login.ftl", overrides: {} })` (lines ~212–245).
  - It also calls `addSyncExtensionsToPostinstallScript`. This hooks the next mechanism into `postinstall`.
- **`keycloakify sync-extensions`** (KFY `src/bin/sync-extensions/extensionModuleMeta.ts`, `sync-extension.ts`): copies an npm module's `keycloak-theme/` directory into the user's theme source tree (`KEYCLOAK_THEME = "keycloak-theme"`, KFY `src/bin/shared/constants.ts:83`). This is how the story files from LUS end up in the project: `keycloak-theme/login/pages/<page>/Page.stories.tsx` and `keycloak-theme/login/mocks/KcPageStory.tsx`.
- **`keycloakify add-story`** (KFY `src/bin/add-story.ts`): an older, per-page route. It prompts for theme type and Page ID (from `LOGIN_THEME_PAGE_IDS`, KFY `src/bin/shared/constants.ts:20`). It then copies `stories/<themeType>/pages/<Page>.stories.tsx` from the keycloakify package into `<themeSrc>/<themeType>/pages/` and rewrites imports to `keycloakify/…`.
- **`keycloakify copy-keycloak-resources-to-public`** (KFY `src/bin/copy-keycloak-resources-to-public.ts`), described in the CLI as "(Internal)" (KFY `src/bin/main.ts:235–247`):
  - It copies `dist/res/public/<KEYCLOAKIFY_DEV_RESOURCES>` into the project's `public/` and adds a `.gitignore`. A `keycloakify.buildinfo` stamp skips the copy when nothing changed.
  - Those resources are produced at keycloakify build time by `scripts/build/createPublicKeycloakifyDevResourcesDir.ts`. That script downloads pinned commits of `keycloakify/login-ui` and `keycloak-account-multi-page-ui` (`scripts/shared/constants.ts`) and extracts their `keycloak-theme/public/<type>` directories.
  - So the CSS and images Storybook uses come from those repos, not directly from a Keycloak jar.
- **Where login-ui gets Keycloak's files**: LUI `scripts/shared/downloadKeycloakDefaultTheme.ts` downloads `https://repo1.maven.org/maven2/org/keycloak/keycloak-themes/${KEYCLOAK_VERSION}/keycloak-themes-${KEYCLOAK_VERSION}.jar`. `KEYCLOAK_VERSION = "25.0.4"` is in LUI `scripts/shared/downloadKeycloakDefaultTheme.overridable.ts:7`. The package version `250004.x.y` encodes that Keycloak version. This confirms that a pinned `keycloak-themes` jar from Maven Central is the canonical source of Base-theme files.

### 1.2 Default mock models

- **Shared base:** `kcContextCommonMock` (KFY `src/login/KcContext/kcContextMocks.ts`, about lines 80–190; the same file exists as LUI `src/core/KcContext/kcContextMocks.ts`).
  - Fields: `url` (`loginAction`, `resourcesPath`, `resourcesCommonPath`, `loginRestartFlowUrl`, `loginUrl`, `ssoLoginInOtherTabsUrl`), `realm` (`name`, `displayName`, `displayNameHtml`, `internationalizationEnabled`, `registrationEmailAsUsername`).
  - `messagesPerField` is implemented as **JS functions** (`get`, `existsError`, `exists`, `printIfExists`, `getFirstError`).
  - `locale` (`supported[]` of `{languageTag,label,url}`, `currentLanguageTag`), `auth` (`showUsername`, `showResetCredentials`, `showTryAnotherWayLink` as **booleans**), `client`, `scripts: []`, `isAppInitiatedAction`, `properties: {}`, `"x-keycloakify": { messages: {} }`.
- **Per Page:** `kcContextMocks`, an array of 38 objects. Each spreads `kcContextCommonMock` and adds Page-specific keys (same file, from about line 200).
  - For example, `login.ftl` adds `social`, `usernameHidden`, `login`, `registrationDisabled`, the WebAuthn fields and more.
  - `register.ftl` adds `profile.attributesByName`, `passwordRequired` and `recaptchaRequired: false`.
  - A compile-time assertion keeps the set equal to `LoginThemePageId` (end of file).
- **Types:** the mock shape is the `KcContext` discriminated union in KFY `src/login/KcContext/KcContext.ts` (`KcContext.Common` at line 71, `Login` at 176, `Register` at 223, …).
- **Important difference from the real FTL model:** Keycloakify's `kcContext` is a **JS projection** of the FreeMarker data model. The FTL template `kcContextDeclarationTemplate.ftl` (KFY `src/bin/keycloakify/generateFtl/kcContextDeclarationTemplate.ftl`) generates it by walking `.data_model` (line 19). The walk:
  - drops methods, except a few it evaluates eagerly: `auth.showUsername()`, `messagesPerField.get/existsError` and others (lines 518–686);
  - excludes many keys (lines 325–455);
  - renames `profile.attributes` to `profile.attributesByName` (lines 74–86);
  - adds synthetic keys (`pageId`, `themeName`, `x-keycloakify`, …).
  
  Keycloakify mocks are therefore **not** valid FreeMarker models as-is. They are a good catalogue of fields and realistic values.

### 1.3 How story overrides work

- `createGetKcContextMock({ kcContextExtension, kcContextExtensionPerPage, overrides, overridesPerPage })` (KFY `src/login/KcContext/getKcContextMock.ts`) returns `getKcContextMock({ pageId, overrides })`. That function:
  1. Starts from a `structuredCloneButFunctions` copy of the Page mock. Unknown or custom Page IDs fall back to `{...kcContextCommonMock, pageId}`.
  2. Applies, in order: `kcContextExtension`, then `kcContextExtensionPerPage[pageId]`, then global `overrides`, then `overridesPerPage[pageId]`, then the story's `overrides`. Each is applied with `deepAssign`.
- `deepAssign` (KFY `src/tools/deepAssign.ts`) has these merge semantics:
  - Objects merge recursively.
  - **Arrays replace** the target array; they are not merged.
  - Functions and primitives replace.
  - **`undefined` deletes the key.**
- A story is a React component taking `kcContext?: DeepPartial<…>` (KFY `stories/login/KcPageStory.tsx`; LUS `keycloak-theme/login/mocks/KcPageStory.tsx`). Each `Page.stories.tsx` exports variants that pass a partial override:
  - `realm: { registrationAllowed: false }`;
  - or `messagesPerField: { existsError: (…)=>…, get: (…)=>… }` to simulate field errors (LUS `keycloak-theme/login/pages/login/Page.stories.tsx`).
- The project-level defaults come from the generated `kc.gen.ts`: `themeName: themeNames[0]`, `properties: {...kcEnvDefaults}` (LUS `keycloak-theme/login/mocks/KcPageStory.tsx` → `getKcContextMock.ts`).

---

## 2. Keycloak: where login FTL model keys come from (KC 26.8.1)

### 2.1 The pipeline

- **Interface:** `LoginFormsProvider` (KC `server-spi-private/src/main/java/org/keycloak/forms/login/LoginFormsProvider.java`).
  - It defines attribute-name constants: `UPDATE_PROFILE_CONTEXT_ATTR="updateProfileCtx"`, `IDENTITY_PROVIDER_BROKER_CONTEXT="identityProviderBrokerCtx"`, `USERNAME_HIDDEN="usernameHidden"`, `REGISTRATION_DISABLED="registrationDisabled"` (lines 40–46).
  - The `LoginFormsPages` enum is in the same package.
- **Implementation:** `FreeMarkerLoginFormsProvider` (KC `services/src/main/java/org/keycloak/forms/login/freemarker/FreeMarkerLoginFormsProvider.java`). For a given Page, `createResponse(LoginFormsPages page)` (line 233) runs these steps:
  1. `getTheme()` → `session.theme().getTheme(Theme.Type.LOGIN)` (line 418).
  2. `locale = session.getContext().resolveLocale(user)`.
  3. `handleThemeResources(theme, locale)` (line 429) puts:
     - `msg` = `new MessageFormatterMethod(locale, attributes + messagesBundle)`;
     - `advancedMsg` = `AdvancedMessageFormatterMethod(locale, messagesBundle)`;
     - `properties` = `theme.getProperties()`;
     - `themeResources` = `ThemeResourcesParser.parse(properties)`;
     - `darkMode` = `"true".equals(properties.darkMode) && realm.getAttribute("darkMode", true)`.
     
     The bundle is `theme.getEnhancedMessages(realm, locale)`.
  4. `handleMessages` (line 464) puts:
     - `message`, a `MessageBean` holding all `FormMessage`s formatted and space-joined, with `type` = `success|warning|error|info`. It is **removed** when there are no messages.
     - `messagesPerField`, a `MessagesPerFieldBean`. A field `null` maps to `"global"`.
  5. `createCommonAttributes` (lines 496–619) puts:

     | Key | Value (`createCommonAttributes`) |
     |---|---|
     | `client` | `ClientBean`, only if a client is set |
     | `realm` | `RealmBean` (realm only) |
     | `title` | `loginTitle` formatted with `realm.displayName` (realm only) |
     | `social` | `IdentityProviderBean`, or the organization-aware variant (realm only) |
     | `url` | `UrlBean` (realm only) |
     | `requiredActionUrl` | method (realm only) |
     | `auth` | `AuthenticationContextBean` (realm only) |
     | `switchOrganizationEnabled` | conditional (realm only) |
     | `usernameHidden` | `"true"` from an auth note (realm only) |
     | `execution` | realm only |
     | `locale` | `LocaleBean`, **only if `realm.internationalizationEnabled`** |
     | `org` | `OrganizationBean`, if the ORGANIZATION feature is on and an org is resolved |
     | `passwordPolicies` | `PasswordPoliciesBean` (realm only) |
     | `authenticatorConfigured` | method, if there is a user |
     | `isAppInitiatedAction` | `true` for application-initiated actions that are not enforced |
     | `lang` | language tag, always |
     | `traceId` | only if tracing is active |

  6. Back in `createResponse`: `login` = `LoginBean(formData)` (always, line 252), `statusCode` (if a status is set), `authenticationSession` = `AuthenticationSessionBean` (for the AUTHENTICATE / REQUIRED_ACTIONS / OAUTH_GRANT actions).
  7. Page-specific `switch` (lines 266–348). Details in §2.3.
  8. `processTemplate` (line 635) sets `templateName` (unless already set) and `pageId` (= template name without `.ftl`). It then calls `FreeMarkerProvider.processTemplate`.
  9. `DefaultFreeMarkerProvider.processTemplate` adds **`kcSanitize`** (KC `services/src/main/java/org/keycloak/theme/freemarker/DefaultFreeMarkerProvider.java:30–35`).
- **Constructor:** puts `scripts` (a `LinkedList`, appended to by `addScript`) (line 161).
- **Authenticator attributes:** authenticators and required actions add further keys through `form.setAttribute(name, value)`. A `null` value **removes** the key (line 985). Examples (paths under KC `services/src/main/java/org/keycloak/`):

  | Key | Set in |
  |---|---|
  | `usernameHidden`, `registrationDisabled` | `authentication/authenticators/util/AuthenticatorUtils.java:152–153` |
  | `recaptchaRequired`, `recaptchaSiteKey`, `recaptchaAction`, `recaptchaVisible` | `authentication/forms/AbstractRegistrationRecaptcha.java:105–108` |
  | `termsAcceptanceRequired` | `authentication/forms/RegistrationTermsAndConditions.java:78` |
  | `passwordRequired` | `authentication/forms/RegistrationPassword.java:137` |
  | `enableWebAuthnConditionalUI` | `WebAuthnConditionalUIAuthenticator.java:45` |
  | WebAuthn keys (`challenge`, `rpId`, `userVerification`, `isUserIdentified`, `shouldDisplayAuthenticators`, `authenticators`, `mediation`, …) | `WebAuthnAuthenticator.java:125–136` |
  | `messageHeader` | `requiredactions/DeleteAccount.java:105` |
  | `pageRedirectUri` | `actiontoken/inviteorg/InviteOrgActionTokenHandler.java:273` |
  | `actionUri` (`Constants.TEMPLATE_ATTR_ACTION_URI`) | `actiontoken/verifyemail/VerifyEmailActionTokenHandler.java:115` |
  | `requiredActions` | `ExecuteActionsActionTokenHandler.java:105` |
  | `skipLink` | `IdpVerifyAccountLinkActionTokenHandler.java:141` |
  | `mode` | `requiredactions/UpdateTotp.java:106` |

- **Page → template** mapping: `Templates.getTemplate(LoginFormsPages)` (KC `services/src/main/java/org/keycloak/forms/login/freemarker/Templates.java`):
  - `LOGIN`→`login.ftl`, `LOGIN_TOTP`→`login-otp.ftl`, `LOGIN_UPDATE_PASSWORD`→`login-update-password.ftl`, `REGISTER`→`register.ftl`, `INFO`→`info.ftl`, `ERROR`→`error.ftl`, …
  - `createForm(String form)` (line 366) renders an arbitrary template with only the common attributes. Custom Pages use this path.

### 2.2 Bean surfaces (what templates can call)

Getter `getX()` / `isX()` is exposed as `.x` by FreeMarker's BeansWrapper. Plain methods must be called with `()`. Files are in KC `services/src/main/java/org/keycloak/forms/login/freemarker/model/` unless noted.

| Key | Class | Template-visible members |
|---|---|---|
| `realm` | `RealmBean` | `name`, `displayName` (falls back to name), `displayNameHtml` (falls back to displayName), `identityFederationEnabled`, `registrationAllowed`, `registrationEmailAsUsername`, `loginWithEmailAllowed`, `duplicateEmailsAllowed`, `resetPasswordAllowed`, `rememberMe`, `internationalizationEnabled`, `editUsernameAllowed`, `password` (`isPassword()`, true when password is a required credential), `actionTokenGeneratedByUserLifespanMinutes`, `verifyEmailActionTokenLifespanMinutes`, `resetCredentialsActionTokenLifespanMinutes`, `idpVerifyAccountLinkActionTokenLifespanMinutes`, `attributes`, `attribute(key)` |
| `url` | `UrlBean` | `loginAction`, `loginUrl`, `loginRestartFlowUrl`, `ssoLoginInOtherTabsUrl`, `hasAction()`, `registrationAction`, `registrationUrl`, `loginResetCredentialsUrl`, `loginUsernameReminderUrl`, `firstBrokerLoginUrl`, `logoutConfirmAction`, `resourcesUrl`, `oauthAction`, `oauth2DeviceVerificationAction`, `resourcesPath` (= `<themeRoot>/login/<themeName>`), `resourcesCommonPath`/`resourcesCommonUrl` (= `<themeRoot>/<properties.common or "common/keycloak">`) |
| `login` | `LoginBean` | `username`, `password`, `passwordToken`, `rememberMe` (from form data) |
| `auth` | `AuthenticationContextBean` | `authenticationSelections`, **methods** `showTryAnotherWayLink()`, `showUsername()`, `showResetCredentials()`, `attemptedUsername` |
| `client` | `ClientBean` | `clientId`, `name`, `description`, `baseUrl`, `attributes`, `attribute(key)` |
| `social` | `IdentityProviderBean` | `providers` (list of `{alias, displayName, providerId, loginUrl, guiOrder, iconClasses, themeConfig}`) |
| `message` | `org.keycloak.theme.beans.MessageBean` (`services/.../theme/beans/`) | `summary`, `type` (lower-case), `success`, `warning`, `error` |
| `messagesPerField` | `MessagesPerFieldBean` (`services/.../theme/beans/`) | **methods** `exists(f)`, `existsError(f...)`, `getFirstError(f...)`, `get(f)` (returns `""` when absent), `printIfExists(f, text)` |
| `locale` | `LocaleBean` (`services/.../theme/beans/`) | `current` (label from `locale_<tag>` message), `currentLanguageTag`, `rtl`, `supported[]` of `{languageTag,label,url}` (url sets `kc_locale`) |
| `passwordPolicies` | `PasswordPoliciesBean` | `length`, `maxLength`, `lowerCase`, `upperCase`, `specialChars`, `digits`, `passwordHistory`, `forceExpiredPasswordChange`, `notUsername`, `notEmail` |
| `otpLogin` | `TotpLoginBean` | `userOtpCredentials[]` of `{id,userLabel}`, `selectedCredentialId`, `policy` (`OTPPolicy`) |
| `profile` / `register` | `RegisterBean`, which extends `AbstractUserProfileBean` | `attributes[]` (each: `name`, `displayName`, `multivalued`, `defaultValue`, `value`, `values`, `required`, `readOnly`, `autocomplete`, `annotations`, `html5DataAnnotations`, `validators`, `group{name,displayHeader,displayDescription,annotations,html5DataAnnotations}`), `attributesByName`, `html5DataAnnotations`, `context`; `RegisterBean.formData` |
| `authenticationSession` | `AuthenticationSessionBean` | `authSessionId`, `authSessionIdHash`, `tabId` |
| `themeResources` | `org.keycloak.theme.ThemeResources` | `styles`, `stylesCommon`, `scripts`, `favicons`; entries are `ThemeResourceDescriptor`s and templates call `resource.hasDefer()` / `hasAsync()` (base `theme-resources.ftl`) |

### 2.3 Model keys per Page (KC 26.8.1)

Each list below has two parts:

- **Java:** keys that `FreeMarkerLoginFormsProvider` always or conditionally sets.
- **Template-referenced:** top-level identifiers that the `keycloak.v2` Page and every template it imports actually read. Lookup order is `keycloak.v2` then `base`.

I extracted the template-referenced keys with a script over KC-JAR. The spike in §5 confirmed them by rendering each Page in strict mode.

**Common to every Page below**, from Java and read by `keycloak.v2/login/template.ftl` (and its imports `field.ftl`, `footer.ftl`, and `theme-resources.ftl` from `base`):

- Methods: `msg`, `advancedMsg`, `kcSanitize`.
- `properties`, `themeResources`, `darkMode`, `lang`, `title`, `scripts`, `pageId`, `realm`, `url`, `auth`, `login`, `message`, `messagesPerField`.
- `locale` (only read inside `realm.internationalizationEnabled`).
- `authenticationSession`, `isAppInitiatedAction`, `switchOrganizationEnabled`.
- Also present but not read by these Pages: `templateName`, `social`, `requiredActionUrl`, `passwordPolicies`, `client`, `statusCode`, `execution`, `org`, `traceId`, `authenticatorConfigured`.

Page-specific keys:

| Page (`LoginFormsPages`) | Page-specific keys put by Java | Additional keys the `keycloak.v2` templates read |
|---|---|---|
| `login.ftl` (`LOGIN`) | none | `social`, `usernameHidden`, `registrationDisabled`, `enableWebAuthnConditionalUI`, WebAuthn and passkey keys from `base/login/passkeys.ftl`: `authenticators`, `challenge`, `rpId`, `userVerification`, `createTimeout`, `isUserIdentified`, `passkeys` (read only under `enableWebAuthnConditionalUI??`) |
| `register.ftl` (`REGISTER`) | `register` and `profile` (the same `RegisterBean`, line 315); `formData` pre-filled with `login_hint` / org email (`createRegistration`, line 699) | `profile.attributes`, `passwordPolicies`, `passwordRequired`, `recaptchaRequired`, `recaptchaVisible`, `recaptchaSiteKey`, `recaptchaAction`, `termsAcceptanceRequired`, `messageHeader` |
| `login-otp.ftl` (`LOGIN_TOTP`) | `otpLogin` = `TotpLoginBean` (line 308) | `otpLogin.userOtpCredentials`, `otpLogin.selectedCredentialId` |
| `login-update-password.ftl` (`LOGIN_UPDATE_PASSWORD`) | none; a default warning message is set by `createResponse(RequiredAction)` (`updatePasswordMessage` vs `resetPasswordMessage`, line 201) | `passwordPolicies` (`password-validation.ftl`), `isAppInitiatedAction` |
| `error.ftl` (`ERROR`) | `statusCode` (from `createErrorPage`, line 784); `authenticationSession` may be null | `client` (`client.baseUrl`), `skipLink`, `traceId` |
| `info.ftl` (`INFO`) | none | `messageHeader`, `requiredActions`, `actionUri`, `pageRedirectUri`, `skipLink`, `client` (`client.baseUrl`) |

**Presence checks:**

- Templates frequently test **presence**, not truthiness. Example: `<#if recaptchaRequired?? && !(recaptchaVisible!false)>` (KC-JAR `theme/keycloak.v2/login/register.ftl` lines 29 and 37).
- In the spike, a mock with `recaptchaRequired: false` (as Keycloakify's `register.ftl` mock has) rendered the reCAPTCHA branch. It then failed on the missing `recaptchaSiteKey`.
- So the Mock model must be able to **omit** keys, and a Story must be able to **delete** them.

---

## 3. Theme layering, messages and the FreeMarker setup

### 3.1 `parent` / `import` resolution

> `ExtendingThemeManager` exists only in old releases. The raw file is present at tag `4.8.3.Final` and returns 404 at `10.0.0` and later. In 26.8.1 the logic lives in **`DefaultThemeManager`** with a private inner class **`ExtendingTheme`** (KC `services/src/main/java/org/keycloak/theme/DefaultThemeManager.java`).

**Theme chain** (`loadTheme`, line 124):

1. `findTheme(name, type)` asks every `ThemeProvider`, sorted by **descending** `getProviderPriority()` (line 444). The folder provider (`themes/` dir) has priority 100 (`FolderThemeProvider.java:38`); the classpath/jar provider has 0 (`ClasspathThemeProvider.java`).
2. The list starts as `[theme]`, then `processImportedTheme` appends `import` if set (line 165). `import=common/keycloak` is split on `/` into **type** `COMMON`, **name** `keycloak`.
3. Then, for each `parent` up the chain, the parent is appended, followed by that parent's import.
4. Result: e.g. for `keycloak.v2` login, `[keycloak.v2/login, common/keycloak, base/login]` (`parent=base`, `import=common/keycloak` in KC-JAR `theme/keycloak.v2/login/theme.properties`).

**Resolution rules on the resulting `ExtendingTheme`:**

| Item | Rule |
|---|---|
| **Templates** (`getTemplate`, line 231) | First hit in list order, then `ThemeResourceProvider`s (extension jars with `theme-resources/templates`) |
| **Resources** | Same first-hit order (`getResourceAsStream`) |
| **`theme.properties`** (`getProperties`, line 403) | Iterate from the **last** (least specific) to the first and `putAll`, so the child wins. Then `${…}` system-property/env substitution (`StringPropertyReplacer`) |
| **Default theme name** (`ThemeSelectorProvider.getDefaultThemeName`, KC `server-spi/src/main/java/org/keycloak/theme/ThemeSelectorProvider.java:41`) | `theme.default` config if set; else `keycloak.v2` for LOGIN when the `LOGIN_V2` feature is on; else `keycloak` |

`theme.properties` keys are documented in KC-DOCS ("Theme properties"): `parent`, `import`, `abstract`, `common` (default `common/keycloak`), `styles`, `stylesCommon`, `scripts`, `favicons`, `locales`, `contentHashPattern`, plus the `kc*Class` CSS keys.

### 3.2 Messages and locale fallback

**Per-theme bundle file** (`FileBasedTheme.getMessages` / `toBundleName`, KC `services/.../theme/FileBasedTheme.java`):

- File name: `messages/messages_<lang>[_<Script>][_<COUNTRY>][_<variant>].properties`. `zh-TW` / `zh-CN` additionally load `zh_Hant` / `zh_Hans`.
- Files are read with `PropertyResourceBundle` (UTF-8 with ISO-8859-1 fallback) (`PropertiesUtil.readCharsetAware`).

**Merge across the theme chain**, for one locale (`ExtendingTheme.getMessagesByLocale`, line 309):

- `ThemeResourceProvider` messages first, then themes from least to most specific with `putAll`, so the child wins.
- Then `addlocaleTranslations` fills `locale_<tag>` labels for every entry in `properties.locales` via `Locale.getDisplayName` (line 360).

**Locale fallback chain** (`LocaleUtil.getParentLocale(locale, realm)`, KC `services/src/main/java/org/keycloak/services/util/LocaleUtil.java:146`):

- `de-CH-1996` → `de-CH` → `de` → (realm default locale if i18n is on and it differs in language, else `en`) → `en` → stop.

**Final bundle** (`getEnhancedMessages`, line 299 → `LocaleUtil.enhancePropertiesWithRealmLocalizationTexts`, line 286 → `mergeGroupedMessages`, line 242):

- Merged from least to most specific locale.
- **For each locale, realm localization texts (admin-console overrides) override theme messages of the same locale.**

**Template-visible methods:**

- **`msg(key, args…)`** (`MessageFormatterMethod`, KC `services/.../theme/beans/MessageFormatterMethod.java:56`):
  - Looks up `key` in (attribute snapshot + bundle) and defaults to the key itself.
  - Resolves `${x}` placeholders inside the value and inside String args against the same map (`TemplatingUtil.resolveVariables`).
  - Then applies `java.text.MessageFormat(value, locale).format(args)`.
- **`advancedMsg(arg, args…)`** (`AdvancedMessageFormatterMethod.java:41`):
  - If `arg` is `${key}`, it formats the bundle value of `key`.
  - Otherwise it formats `arg` itself when args are given, else returns `arg` unchanged.
  - Used for user-profile `displayName: "${username}"`.
- **`kcSanitize(html)`** (`KeycloakSanitizerMethod.java:38`):
  - HTML-decodes up to 5 times, sanitizes with OWASP Java HTML Sanitizer policy `KeycloakSanitizerPolicy.POLICY_DEFINITION` (`KeycloakSanitizerPolicy.java:86`), then un-escapes `href` values.
  - Dependency: `com.googlecode.owasp-java-html-sanitizer`, version `20260101.1` in KC root `pom.xml:104`.
- **Other methods:**
  - `requiredActionUrl` (`RequiredActionUrlFormatterMethod`);
  - `authenticatorConfigured` (`AuthenticatorConfiguredMethod`);
  - `linkExpirationFormatter` (`LinkExpirationFormatterMethod`, used by email, not login).

### 3.3 FreeMarker engine configuration

`DefaultFreeMarkerProvider.getTemplate` (KC `services/.../theme/freemarker/DefaultFreeMarkerProvider.java:58–70`):

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);
if (templateName.toLowerCase().endsWith(".ftl")) cfg.setOutputFormat(HTMLOutputFormat.INSTANCE); // auto-escaping
cfg.setNewBuiltinClassResolver(TemplateClassResolver.ALLOWS_NOTHING_RESOLVER);
cfg.setTemplateLoader(new ThemeTemplateLoader(theme)); // URLTemplateLoader -> theme.getTemplate(name)
return cfg.getTemplate(templateName, "UTF-8");
```

- **Object wrapper and exception handler** are FreeMarker defaults. The default `DefaultObjectWrapper` exposes bean getters and methods.
- **Template cache:** a template is cached per `type/themeName/templateName` when `theme.cacheTemplates` is true (the default) (`DefaultFreeMarkerProviderFactory.java:23`).
- **FreeMarker library version:** `freemarker.version` = **2.3.35** (KC root `pom.xml:131`).

---

## 4. Base-theme packaging and `<#import>` resolution

**Maven coordinates:** `org.keycloak:keycloak-themes:<keycloakVersion>` (jar), module `themes/` (KC `themes/pom.xml`). Release builds are on Maven Central: `https://repo1.maven.org/maven2/org/keycloak/keycloak-themes/<v>/keycloak-themes-<v>.jar` (latest `26.8.1` per `maven-metadata.xml`). Vendor web assets are in a separate artifact, **`org.keycloak:keycloak-themes-vendor`**, which `keycloak-themes` depends on (KC `themes/pom.xml`). It provides `theme/keycloak/common/resources/vendor/{patternfly-v3,patternfly-v4,patternfly-v5,rfc4648,react,react-dom,web-crypto-shim}`.

**Jar layout** (KC-JAR listing; matches `ClassLoaderTheme`, KC `services/.../theme/ClassLoaderTheme.java:63`, root `theme/<name>/<type>/`):

```
META-INF/keycloak-themes.json        # {"themes":[{"name":"base","types":["admin","account","login","email"]},
                                     #            {"name":"keycloak","types":["login","common","email","welcome"]},
                                     #            {"name":"keycloak.v2","types":["login"]}]}
theme/base/login/*.ftl               # full template set (template.ftl, login.ftl, ..., theme-resources.ftl, passkeys.ftl)
theme/base/login/theme.properties    # only "locales=ar,az,...,zh-TW"
theme/base/login/messages/messages_<locale>.properties   # 42 bundles
theme/keycloak/login/{theme.properties,messages/,resources/}   # parent=base, import=common/keycloak, PF4 css; no .ftl
theme/keycloak.v2/login/*.ftl        # PF5 overrides (template.ftl, login.ftl, register.ftl, field.ftl, buttons.ftl, ...)
theme/keycloak.v2/login/theme.properties  # parent=base, import=common/keycloak, darkMode=true, kc*Class=pf-v5-...
theme/keycloak/common/resources/{img,lib}/   # no theme.properties
```

- **Discovery:** `JarThemeProviderFactory` scans every `META-INF/keycloak-themes.json` on the classpath and registers `ClassLoaderTheme`s (`JarThemeProviderFactory.java`, `ClasspathThemeProviderFactory.java`). Custom theme jars follow the same layout (KC-DOCS "deploying themes").
- **Source layout:** in the KC source tree, translations *and* `base/login/theme.properties` and `base/login/theme-resources.ftl` live under `themes/src/main/resources-community/`. That directory is added by the Maven profile `communityTranslations`, active unless `-DskipCommunityTranslations` (KC `themes/pom.xml` lines 56–68). **Use the published jar, not a raw source checkout**: `keycloak.v2/login/template.ftl` imports `theme-resources.ftl`, which exists only in the community directory.
- **`<#import "template.ftl" as layout>` and every other import or include** goes through FreeMarker's TemplateLoader:
  - Keycloak passes `ThemeTemplateLoader`, which calls `ExtendingTheme.getTemplate(name)`. Each name is resolved **independently** through the full chain (`keycloak.v2/login` → `common/keycloak` → `base/login` → theme-resource providers).
  - Example: `keycloak.v2/login/login.ftl` imports `template.ftl` (found in `keycloak.v2`) and `passkeys.ftl` (found only in `base`). `keycloak.v2/login/template.ftl` imports `theme-resources.ftl` (only in `base`).
  - A customer Theme with `parent=keycloak.v2` that overrides only `template.ftl` therefore changes the layout of every Page.
  - Paths are relative to the theme root because `ClassLoaderTheme.getTemplate` uses `ResourceLoader.getResource(classLoader, templateRoot, name)`, which also rejects `..` escapes (`ResourceLoader.java`).

---

## 5. Feasibility: minimal Java to render `login.ftl` with a JSON model

**Spike.** A single file, `Spike.java`, about 120 lines. It ran with Java 21, `freemarker-2.3.35.jar`, `jackson-databind-2.18.2` and `keycloak-themes-26.8.1.jar` on the classpath, and rendered these `keycloak.v2` Pages to complete HTML:

- `login.ftl` (de and en);
- `login-otp.ftl`, `login-update-password.ftl`, `register.ftl`, `error.ftl`, `info.ftl` (en).

Output included German labels from the merged `base`+`keycloak.v2` `messages_en`/`messages_de`, PF5 classes from merged `theme.properties`, per-field error markup and `aria-invalid="true"`. The spike lives outside the repo (session scratchpad); its essentials:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);           // == Keycloak
cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
cfg.setNewBuiltinClassResolver(TemplateClassResolver.ALLOWS_NOTHING_RESOLVER);
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);     // surface missing keys
cfg.setTemplateLoader(new MultiTemplateLoader(new TemplateLoader[]{            // == ExtendingTheme.getTemplate order
    new FileTemplateLoader(customThemeLoginDir),                                 // customer Theme (illustrative; spike used only the two jar loaders)
    new ClassTemplateLoader(cl, "/theme/keycloak.v2/login/"),
    new ClassTemplateLoader(cl, "/theme/base/login/")}));

Map<String,Object> model = jsonToMap(mergedStory);   // Jackson -> Map/List/String/Number/Boolean
model.put("properties", mergedThemeProperties);      // base -> parent -> child, putAll
model.put("msg", msgMethod);                         // MessageFormat over merged bundle (see 3.2)
model.put("advancedMsg", advancedMsgMethod);
model.put("kcSanitize", kcSanitizeMethod);
model.put("messagesPerField", new MessagesPerField(json.messagesPerField)); // POJO with exists/existsError/get/...
model.put("auth", callable(json.auth));              // {"showUsername":false} -> TemplateMethodModelEx returning value
cfg.getTemplate("login.ftl", "UTF-8").process(model, writer);
```

**What a JSON-derived model needs beyond plain maps:**

1. **Callable members.** Templates call `auth.showUsername()`, `auth.showResetCredentials()`, `auth.showTryAnotherWayLink()`, `messagesPerField.existsError(…)` (65 call sites in login FTLs), `messagesPerField.get/exists/getFirstError(…)`, `totp.policy.getAlgorithmKey()` and `resource.hasDefer()/hasAsync()` (`themeResources`). Plain JSON values cannot be called. Two options:
   - Map known paths to small POJOs or `TemplateMethodModelEx`. `messagesPerField` is best modelled as JSON `{field: {type, summary}}` behind a Java object identical to `MessagesPerFieldBean`.
   - A custom ObjectWrapper that wraps JSON scalars as "callable scalars", i.e. a value that is both a boolean/string and a zero-arg method.
2. **Getter-style booleans.** These work as plain JSON keys: `realm.password` (Java `isPassword()`), `locale.rtl`, `message.error`.
3. **Presence semantics.** Many conditions use `x??`. The model must omit absent keys. In JSON, `null` from Jackson becomes a missing value in FreeMarker, which matches `setAttribute(name, null)` removing the key.
4. **Derived values to compute rather than mock:**
   - `title` (= `msg("loginTitle", realm.displayName)`), `lang`, `pageId`;
   - `url.resourcesPath` / `resourcesCommonPath` (these must point at a preview static server serving `theme/<name>/login/resources/` and `theme/keycloak/common/resources/`, including the vendor jar);
   - `message.summary` from message keys plus params;
   - `locale` (only when `realm.internationalizationEnabled`) with `locale_<tag>` labels.
5. **Strict mode.** Keycloak uses FreeMarker's default handler. With `RETHROW_HANDLER` a missing key fails fast and names it, for example `==> url.ssoLoginInOtherTabsUrl [in template "template.ftl" at line 107]` from the spike. That makes it a natural "mock is incomplete" diagnostic.
6. **Template loader as a chain**, resolving every `<#import>` independently. `MultiTemplateLoader` reproduces this. The `import=common/keycloak` theme contributes no templates in the built-in themes, only resources.
7. **`kcSanitize`.**
   - Option 1: depend on the OWASP sanitizer and copy `KeycloakSanitizerPolicy`/`KeycloakSanitizerMethod` (both Apache-2.0).
   - Option 2: depend on `org.keycloak:keycloak-services:<v>`, with heavy transitive dependencies. The spike used a pass-through, which is **not** faithful (Keycloak strips disallowed tags from `displayNameHtml` etc.).
8. **`msg` fidelity.** Keycloak's `msg` uses a *snapshot* of the attributes taken before common attributes are added (`handleThemeResources` runs before `createCommonAttributes`). Only String-valued entries matter, because `Properties.getProperty` ignores non-strings.

---

## Implications for the tool

- **Base theme source:** pin `org.keycloak:keycloak-themes:<v>` and `keycloak-themes-vendor:<v>` per project and fetch them from Maven Central. Do not build from the KC source tree, where `resources-community` is needed. Keycloakify's login-ui does the same thing (`KEYCLOAK_VERSION`).
- **Rendering engine:** reproduce Keycloak's engine exactly. FreeMarker version from the KC `pom.xml` (2.3.35 for 26.8.1), `VERSION_2_3_32` incompatible-improvements, HTML output format, `ALLOWS_NOTHING_RESOLVER`, UTF-8.
- **Theme layering:** build the theme chain like `DefaultThemeManager.loadTheme`: child, then import, then parent, then the parent's import, and so on. Read `parent`/`import` from each `theme.properties`. Use the chain for templates (first hit), properties (merge with child wins, then `${env}` substitution) and messages (per-locale merge with child wins, then the `getParentLocale` fallback chain, optionally plus "realm localization" overrides from the Story).
- **Mock model shape:** define Mock models in the **FTL-model shape** (bean property names as in §2.2), not Keycloakify's `kcContext` shape:
  - `profile.attributes` (list), not `attributesByName`;
  - no `x-keycloakify`;
  - methods are produced by the renderer.
  
  Keycloakify's `kcContextMocks.ts` is a useful seed for realistic values. It must be translated, and fields like `recaptchaRequired: false` must be removed because templates test presence.
- **Story merge semantics:** adopt deepAssign-like rules. Objects merge, arrays replace, and an explicit **`null` deletes** a key (JSON has no `undefined`). Order: Page default → project-wide overrides → per-Page project overrides → Story overrides, mirroring `createGetKcContextMock`.
- **Renderer-owned pieces:** keep a small Java "Keycloak shim" layer that owns `msg`, `advancedMsg`, `kcSanitize`, `messagesPerField`, `auth` callables, `themeResources` and derived keys (`title`, `lang`, `pageId`, `url.resources*`, `locale`). Story JSON then stays purely declarative.
- **Missing-key diagnostics:** run with `RETHROW_HANDLER` and turn `InvalidReferenceException` into "missing mock key X at template:line".
- **Static resources:** serve them for `url.resourcesPath` / `resourcesCommonPath`, read from the same chain (customer Theme → Base theme jar → vendor jar).

## Open questions

1. Should `kcSanitize` be exact (OWASP sanitizer + copied Keycloak policy) or a pass-through? Exact output matters for `displayNameHtml` and `message.summary`.
2. How should a Story express calls with arguments other than `messagesPerField`, for example `authenticatorConfigured(type)` or `requiredActionUrl(action, tokenUrl)`? Option A: a fixed shim per known method. Option B: a JSON "call table".
3. Should the tool support `ThemeResourceProvider` sources (extension jars with `theme-resources/templates` and `messages`)? They sit after the theme chain in lookup order.
4. Do we model realm localization texts (admin-console overrides), which override theme messages per locale?
5. Which Keycloak versions must be supported? `theme-resources.ftl`, `themeResources`, `darkMode`, passkeys and organizations are recent. Model keys and bean surfaces differ between versions, so default Mock models probably need to be versioned per Keycloak minor release.
6. Should `locale` be omitted when `realm.internationalizationEnabled=false`, as Keycloak does? Or should the tool always provide it for convenience? Templates guard it, so omitting is faithful.
7. Only `keycloak.v2` login was verified in the spike. Check `keycloak` (v1, `parent=base`, no own FTLs) and the email/account Theme types before claiming general support.
8. Licensing: copying Keycloak shim code (Apache-2.0) and redistributing the `keycloak-themes` jar. Fetching at runtime avoids redistribution.
