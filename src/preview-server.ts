import http from "node:http";
import type { Project } from "./project.ts";
import type { RendererProcess } from "./renderer-process.ts";
import { StoryFileError } from "./stories.ts";
import { renderStory } from "./render-story.ts";
import { errorOverlay } from "./error-overlay.ts";
import { previewUi } from "./preview-ui.ts";

export interface PreviewServerOptions {
  project: Project;
  renderer: RendererProcess;
  /** Strict mode (default): a missing Mock model value fails the render. Lenient: the failing part is skipped. */
  strict: boolean;
  port: number;
}

const PREVIEW_ROUTE = /^\/preview\/([^/]+)\/([^/]+)\/([^/]+)$/;
/**
 * Mirrors Keycloak's url.resourcesPath (/resources/<theme-type>/<theme>, e.g. /resources/login/acme)
 * and url.resourcesCommonPath (/resources/common/<theme>).
 */
const RESOURCES_ROUTE = /^\/resources\/([\w.-]+)\/([\w.-]+)\/(.+)$/;

/** Dev server: renders each Story fresh on every request (no caching in dev). */
export async function startPreviewServer(options: PreviewServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    handle(req, res, options).catch((err: unknown) => {
      send(res, 500, "text/plain; charset=utf-8", `Internal error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, options: PreviewServerOptions) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET") return send(res, 404, "text/plain; charset=utf-8", "Not found");
  if (url.pathname === "/") return serveUi(res, options);
  if (url.pathname === "/api/stories") return serveStoryIndex(res, options);
  const resource = RESOURCES_ROUTE.exec(url.pathname);
  const common = resource?.[1] === "common";
  if (resource && (common || resource[1] === options.project.themeType)) {
    return serveResource(res, options, common, resource[2], resource[3]);
  }
  const match = PREVIEW_ROUTE.exec(url.pathname);
  if (!match) return send(res, 404, "text/plain; charset=utf-8", "Not found");

  let themeType: string, page: string, storyName: string;
  try {
    [themeType, page, storyName] = match.slice(1).map(decodeURIComponent);
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "Malformed URL");
  }

  const outcome = await renderStory(options.project, options.renderer, {
    themeType,
    page,
    storyName,
    locale: url.searchParams.get("locale") ?? undefined,
    strict: options.strict,
  });
  switch (outcome.kind) {
    case "unsupported-theme-type":
      return send(res, 404, "text/plain; charset=utf-8", `Unsupported Theme type: ${outcome.themeType} (this Project previews ${outcome.supported})`);
    case "no-default-mock-model":
      return send(res, 404, "text/plain; charset=utf-8", `No default Mock model for Page: ${outcome.page}`);
    case "invalid-story-file":
      return send(res, 500, "text/html; charset=utf-8", await errorOverlay("Invalid Story file", { message: outcome.message }));
    case "unknown-story":
      return send(res, 404, "text/plain; charset=utf-8", `Unknown Story: ${outcome.page}/${outcome.storyName}`);
    case "render-failed":
      return send(res, 500, "text/html; charset=utf-8", await errorOverlay("Render failed", outcome.error));
    case "ok":
      for (const warning of outcome.warnings) console.warn(`[lenient] ${page}/${storyName}: skipped missing Mock model value\n${warning}\n`);
      return send(res, 200, "text/html; charset=utf-8", outcome.html);
  }
}

/** The UI page; problems with Story files or the Theme are shown in its sidebar rather than failing it. */
async function serveUi(res: http.ServerResponse, options: PreviewServerOptions) {
  let locales = ["en"];
  try {
    locales = await (await options.project.themeChain()).locales();
    const pages = await options.project.storyIndex();
    send(res, 200, "text/html; charset=utf-8", previewUi({ pages, locales }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(res, 200, "text/html; charset=utf-8", previewUi({ pages: [], locales, storyError: message }));
  }
}

/** The Page/Story list the preview UI shows. */
async function serveStoryIndex(res: http.ServerResponse, options: PreviewServerOptions) {
  try {
    const pages = await options.project.storyIndex();
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ pages }));
  } catch (err) {
    if (!(err instanceof StoryFileError)) throw err;
    send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: err.message }));
  }
}

/**
 * Resources of the Project's Theme type come from the Theme chain (the theme name in the URL is cosmetic, as with one
 * Theme per project); common resources from the named Base theme's common type.
 */
async function serveResource(
  res: http.ServerResponse,
  options: PreviewServerOptions,
  common: boolean,
  themeName: string,
  encodedPath: string,
) {
  let resourcePath: string;
  try {
    resourcePath = decodeURIComponent(encodedPath);
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "Malformed URL");
  }
  const found =
    common
      ? await options.project.findCommonResource(themeName, resourcePath)
      : await (await options.project.themeChain()).findResource(resourcePath);
  if (!found) return send(res, 404, "text/plain; charset=utf-8", `Resource not found: ${resourcePath}`);
  res.writeHead(200, { "content-type": found.contentType, "cache-control": "no-store" });
  res.end(found.body);
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string) {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}
