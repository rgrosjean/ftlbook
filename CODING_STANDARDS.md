# Coding standards

Read during code review. Mechanical checks (typecheck, `bin` entries tracked by git)
run in the pre-commit hook and CI, so they are not repeated here.

## Domain language

Use the terms in `GLOSSARY.md` (Page, Story, Mock model, Theme, Base theme, Renderer,
Scaffold, strict/lenient mode) in names, comments, messages and test titles.

## One seam for tests

Tests drive the tool as a user does: start the real server (`startServer`) or run the
real CLI (`runCli`), then assert on HTTP responses, CLI output and files written.
Story merging, the Renderer shims and other internals are covered through the
rendered HTML, never imported into a test directly. Expected values come from
Keycloak or a literal worked example, not from recomputing what the code does.

## Reuse before writing

- Test setup shared by two or more test files lives in `test/harness.ts` (`startServer`,
  `runCli`, `runCliAsync`, `copyProject`, `configure`, `tempDir`) or `test/maven-repository.ts`
  (`startFakeKeycloakRepository`, `zip`). Extend those rather than copying a helper.
- Use the exported constants and helpers for domain values: `DEFAULT_STORY`, `storyUrl`,
  `CONFIG_FILE`, `CONFIG_KEYS`. A literal that duplicates one of them is a finding. Keys from
  JSON input are set with `setOwn` (in `src/stories.ts`), never by plain assignment.

## Keycloak fidelity

The tool is only useful if it behaves like Keycloak.

- Behaviour reimplemented from Keycloak (template methods, beans, sanitizing, theme
  layering) names the Keycloak class it follows in a comment.
- Code copied from Keycloak keeps its Apache-2.0 header, names the Keycloak version it
  came from, and lists exactly what was changed.
- Dependency versions that must match Keycloak (FreeMarker, OWASP sanitizer) carry a
  "Same version as Keycloak <x>" comment.
- Default Mock models hold what Keycloak puts in the model for that Page: realistic
  values, and keys that templates test with `??` left out unless Keycloak sets them.
  Keycloakify mocks are a source of values only, never of shape.

## Errors a developer can act on

User-facing errors name the thing at fault (file, key, Page, version) and what is
expected, like `StoryFileError` and `ConfigError`: `<file>: "port" must be an integer
from 0 to 65535`.

## CLI output

stdout carries only a command's result, so it can be piped (`model` prints just the
JSON). Warnings and progress go to stderr.
