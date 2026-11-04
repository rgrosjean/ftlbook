# FTL Preview

Preview Keycloak FreeMarker login themes without running Keycloak. FTL Preview renders each Page of your Theme with real FreeMarker, on top of the Keycloak Base theme of the version you target, and serves the result in a browser, rendered fresh on every request.

## Requirements

- Node.js 22.18 or newer
- A JDK 21 or newer, with `java` on the PATH (the Renderer runs on the JVM)

## Install

The package is published to a private npm registry. Route its scope there once, in your user `~/.npmrc` (along with the registry's credentials):

```ini
@ftl-preview:registry=https://<your-registry>/repository/npm-private/
```

Then add it to your theme project:

```sh
npm install --save-dev @ftl-preview/cli
npx ftl-preview serve
```

A dev dependency pins the FTL Preview version per project, next to the Keycloak version it targets. A global install (`npm install --global @ftl-preview/cli`, then `ftl-preview serve`) also works when one version is enough for every project.

## Project layout

With the defaults, no config file is needed:

```
my-theme-project/
  theme/login/     # your login Theme: theme.properties, *.ftl, messages/, resources/
  stories/         # *.stories.json Story files
```

Without a `theme/login` directory, the `keycloak.v2` Base theme renders on its own.

## Commands

Run them from the project root.

| Command | What it does |
| --- | --- |
| `ftl-preview serve [--port <n>] [--lenient]` | Starts the preview server (default http://localhost:6006). |
| `ftl-preview add-story [--page <page>]... [--story <name>]` | Adds a Story (default name `Default`) for Pages of the Theme or its Base theme. Without `--page`, lists every Page and asks which to add. |
| `ftl-preview model <page>` | Prints the default Mock model of a Page (e.g. `login.ftl`) as JSON: the fields a Story can override. |

The first `serve` or `add-story` downloads the Base theme of the configured Keycloak version from Maven and caches it.

## Stories

A Story file defines Stories for exactly one Page. Every Page also has a `Default` Story, its default Mock model as is, even without a Story file.

```json
{
  "page": "login.ftl",
  "stories": {
    "Invalid password": {
      "locale": "de",
      "model": {
        "message": { "type": "error", "summary": "Invalid username or password." }
      }
    }
  }
}
```

The `model` overrides are merged into the default Mock model: objects merge, arrays and other values replace, and `null` removes a key. Each Story has a stable URL, `/preview/login/<page>/<story>`.

Edits to templates, `theme.properties`, messages, resources and Story files show on the next reload. Config changes need a restart.

## Strict and lenient mode

By default (strict mode), a value the template needs but the Mock model lacks fails the render with an error page naming it. With `--lenient` (or `"strict": false`), the failing part is skipped and logged instead.

## Config

An optional `ftl-preview.json` at the project root. Every key is optional, and relative paths are resolved against the project root.

```json
{
  "keycloakVersion": "26.8.1",
  "themeType": "login",
  "themeDir": "theme/login",
  "storiesDir": "stories",
  "port": 6006,
  "strict": true,
  "mavenRepository": "https://<your-maven-mirror>/repository/maven-public"
}
```

- `keycloakVersion`: the Keycloak version whose Base theme the Theme builds on.
- `themeType`: only `login` is supported so far.
- `mavenRepository`: where to download the Base theme from; Maven Central when unset.

## Environment variables

- `FTL_PREVIEW_MAVEN_REPO`: Maven repository for this machine, e.g. a mirror; wins over `mavenRepository`.
- `FTL_PREVIEW_CACHE_DIR`: cache directory for the downloaded Base themes. Default: `$XDG_CACHE_HOME/ftl-preview`, else `~/.cache/ftl-preview`.

## Developing FTL Preview

You need Maven in addition to the requirements above.

```sh
npm install
npm run build:renderer   # builds the Renderer jar
npm run typecheck
npm test
```

A checkout runs the TypeScript sources directly (`node bin/ftl-preview.js serve`).

### Publishing

Publishing is done by hand, and only to the private registry:

```sh
npm login --registry https://<your-registry>/repository/npm-private/
npm version <patch|minor|major>
npm publish --registry https://<your-registry>/repository/npm-private/
```

`npm publish` refuses to run without a `--registry` pointing away from the public npm registry. It runs the typecheck and the tests, builds the Renderer jar and compiles the sources to `dist/` before packing.
