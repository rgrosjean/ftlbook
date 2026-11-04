# FTL Preview

Tool that renders Keycloak FreeMarker theme pages without a running Keycloak, so theme developers can preview and test them, similar to what Keycloakify's Storybook offers for React themes.

## Language

**Project**:
The customer repository FTL Preview runs in: one Theme (optional), its Story files, and the Keycloak version they target.
_Avoid_: Workspace, repo, app

**Theme**:
A customer's set of Keycloak templates, messages and resources for one theme type, usually overriding only part of its Base theme.
_Avoid_: Skin, template set

**Theme type**:
The Keycloak area a Theme targets: login, account or email.
_Avoid_: Theme kind, theme category

**Base theme**:
A Keycloak-provided Theme that a customer Theme builds on, as its parent or as an import, or that renders alone when the Project has no Theme; supplies every file the customer Theme does not override.
_Avoid_: Parent theme, default theme

**Theme chain**:
The Theme followed by every Base theme it builds on, through parents and imports, most specific first. Pages, messages and resources are looked up along it, and the first match wins.
_Avoid_: Theme hierarchy, inheritance chain

**Page**:
A single Keycloak screen defined by one FTL file, such as `login.ftl` or `register.ftl`.
_Avoid_: View, screen, template

**Story**:
A named preview of one Page, defined as declarative data: which Page, which locale, and the model overrides to apply.
_Avoid_: Scenario, fixture, case

**Story file**:
A `*.stories.json` file in the Project defining the Stories of exactly one Page.
_Avoid_: Stories file, spec

**Default Story**:
The Story every Page has, even without a Story file: its default Mock model with no overrides. A Story file may define it again to override it.
_Avoid_: Base story, empty story

**Mock model**:
The fake realm and flow data (realm settings, flow URLs, form values, social providers, ...) a Page is rendered with. Each Page has a default one; a Story overrides parts of it.
_Avoid_: Fixture data, stub context

**Common attributes**:
The values Keycloak adds to every Page whatever the flow, derived from the Theme, the locale and the realm rather than mocked: messages, theme properties, the language, the locale switcher and the resource URLs. A Story cannot override them.
_Avoid_: Global model, computed model

**Scaffold**:
The script that lets a user choose which Pages to add, then creates their Story files.
_Avoid_: Generator, init

**Strict mode**:
Rendering in which a missing Mock model value fails the Page with an error naming it. On by default; turning it off is lenient mode, where the failing part is skipped and reported.
_Avoid_: Strict rendering, relaxed mode

**Renderer**:
The component that runs real FreeMarker on a Page with a Mock model and returns HTML.
_Avoid_: Engine, compiler

**FTL error**:
A FreeMarker error in an FTL file of the Theme chain, located by file and line; fixed by changing the Theme or the Story.
_Avoid_: Template error, render error

**Renderer failure**:
The Renderer itself failing or out of reach, with no fault in the Project's files.
_Avoid_: Crash, backend error
