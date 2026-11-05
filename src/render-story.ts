import type { Project } from "./project.ts";
import type { RenderError, RendererProcess } from "./renderer-process.ts";
import { applyOverrides, StoryFileError } from "./stories.ts";
import { DEFAULT_LOCALE } from "./theme-chain.ts";

export interface StoryRequest {
  themeType: string;
  page: string;
  storyName: string;
  /** Overrides the Story's locale, as the preview UI's locale selector does. */
  locale: string | undefined;
  /** Strict mode: a missing Mock model value fails the render. Lenient: the failing part is skipped. */
  strict: boolean;
}

/** What rendering a Story came to: one outcome per case. */
export type StoryOutcome =
  | { kind: "unsupported-theme-type"; themeType: string; supported: string }
  | { kind: "no-default-mock-model"; page: string }
  | { kind: "invalid-story-file"; message: string }
  | { kind: "unknown-story"; page: string; storyName: string }
  | { kind: "render-failed"; error: RenderError }
  | { kind: "renderer-failed"; message: string }
  /** `warnings` lists the template errors skipped in lenient mode. */
  | { kind: "ok"; html: string; warnings: string[] };

/**
 * Renders a Story of the Project: its overrides applied to the Page's default Mock model, in the
 * requested locale, else the Story's, else en. Story files and the Theme chain are read fresh, so
 * edits show on the next call.
 */
export async function renderStory(project: Project, renderer: RendererProcess, request: StoryRequest): Promise<StoryOutcome> {
  const { themeType, page } = request;
  if (themeType !== project.themeType) {
    return { kind: "unsupported-theme-type", themeType, supported: project.themeType };
  }

  const defaults = await project.mockModels.defaultFor(page);
  if (!defaults) return { kind: "no-default-mock-model", page };

  let story;
  try {
    story = await project.findStory(page, request.storyName);
  } catch (err) {
    if (err instanceof StoryFileError) return { kind: "invalid-story-file", message: err.message };
    throw err;
  }
  if (!story) return { kind: "unknown-story", page, storyName: request.storyName };

  const chain = await project.themeChain();
  const result = await renderer.render({
    theme: { dirs: chain.dirs, properties: chain.properties, ...chain.resourceUrls },
    page,
    storyUrl: project.storyUrl(page, story.name),
    locale: request.locale || story.locale || DEFAULT_LOCALE,
    model: applyOverrides(defaults, story.model),
    strict: request.strict,
  });
  if (result.ok) return { kind: "ok", html: result.html, warnings: result.warnings };
  return "error" in result ? { kind: "render-failed", error: result.error } : { kind: "renderer-failed", message: result.rendererFailure };
}
