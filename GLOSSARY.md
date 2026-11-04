# FTL Preview

Tool that renders Keycloak FreeMarker theme pages without a running Keycloak, so theme developers can preview and test them, similar to what Keycloakify's Storybook offers for React themes.

## Language

**Theme**:
A customer's set of Keycloak templates, messages and resources for one theme type, usually overriding only part of its Base theme.
_Avoid_: Skin, template set

**Theme type**:
The Keycloak area a Theme targets: login, account or email.
_Avoid_: Theme kind, theme category

**Base theme**:
The Keycloak-provided Theme a customer Theme inherits from via its parent setting; supplies every file the customer Theme does not override.
_Avoid_: Parent theme, default theme

**Page**:
A single Keycloak screen defined by one FTL file, such as `login.ftl` or `register.ftl`.
_Avoid_: View, screen, template

**Story**:
A named preview of one Page, defined as declarative data: which Page, which locale, and the model overrides to apply.
_Avoid_: Scenario, fixture, case

**Mock model**:
The fake Keycloak data (realm, URLs, messages, social providers, ...) a Page is rendered with. Each Page has a default one; a Story overrides parts of it.
_Avoid_: Fixture data, stub context

**Scaffold**:
The script that lets a user choose which Pages to add, then creates their Story files.
_Avoid_: Generator, init

**Strict mode**:
Rendering in which a missing Mock model value fails the Page with an error naming it. On by default; turning it off is lenient mode, where the failing part is skipped and reported.
_Avoid_: Strict rendering, relaxed mode

**Renderer**:
The component that runs real FreeMarker on a Page with a Mock model and returns HTML.
_Avoid_: Engine, compiler
