# FTL Preview

Tool that renders Keycloak FreeMarker theme pages without a running Keycloak, so theme developers can preview and test them, similar to what Keycloakify's Storybook offers for React themes.

## Language

**Project**:
The customer repository FTL Preview runs in: its Themes (optional), the Story files, and the Keycloak version they target.
_Avoid_: Workspace, repo, app

**Theme**:
A customer's set of Keycloak templates, messages and resources for one Theme type, usually overriding only part of what it builds on. A Project may hold several, e.g. a login Theme and the common Theme it imports.
_Avoid_: Skin, template set

**Previewed theme**:
The one Theme of the Project whose Pages FTL Preview renders.
_Avoid_: Main theme, current theme, the Theme

**Theme type**:
The Keycloak area a Theme targets: login, account, email, or common. A common Theme holds only shared resources and is reached through an import or through the `common` theme property.
_Avoid_: Theme kind, theme category

**Base theme**:
A Keycloak-provided theme that a Theme builds on, as its parent or as an import, or that renders alone when the Project has no Previewed theme; supplies every file the Themes do not override. A Theme of the Project with the same name and type takes its place.
_Avoid_: Parent theme, default theme

**Theme chain**:
The Previewed theme followed by every Theme and Base theme it builds on, through parents and imports, most specific first. Pages, messages and resources are looked up along it, and the first match wins.
_Avoid_: Theme hierarchy, inheritance chain

**Common theme chain**:
A common theme followed by every Theme and Base theme it builds on, through parents and imports, most specific first. Common resources are looked up along it, and the first match wins.
_Avoid_: Common chain, common hierarchy

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
