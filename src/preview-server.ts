import http from "node:http";
import { defaultMockModel } from "./mock-models.ts";
import type { RendererProcess } from "./renderer-process.ts";
import { resolveThemeChain } from "./theme-chain.ts";

export interface PreviewServerOptions {
  renderer: RendererProcess;
  /** Customer login Theme directory, if the project has one. */
  loginThemeDir: string | undefined;
  /** Extracted Base themes of the pinned Keycloak version. */
  baseThemesDir: string;
  port: number;
}

const PREVIEW_ROUTE = /^\/preview\/([^/]+)\/([^/]+)\/([^/]+)$/;

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
  const match = PREVIEW_ROUTE.exec(url.pathname);
  if (req.method !== "GET" || !match) return send(res, 404, "text/plain; charset=utf-8", "Not found");

  let themeType: string, page: string, story: string;
  try {
    [themeType, page, story] = match.slice(1).map(decodeURIComponent);
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "Malformed URL");
  }
  if (themeType !== "login") return send(res, 404, "text/plain; charset=utf-8", `Unsupported Theme type: ${themeType}`);
  if (story !== "Default") return send(res, 404, "text/plain; charset=utf-8", `Unknown Story: ${page}/${story}`);

  const model = await defaultMockModel(themeType, page);
  if (!model) return send(res, 404, "text/plain; charset=utf-8", `No default Mock model for Page: ${page}`);

  // Resolved per request, so theme.properties edits show on the next reload
  const themes = await resolveThemeChain(options.loginThemeDir, options.baseThemesDir, themeType);
  const result = await options.renderer.render({
    themes,
    page,
    // ?locale= selects the locale; defaults to en until Stories carry their own locale (ticket 04)
    locale: url.searchParams.get("locale") || "en",
    model,
  });
  if (result.ok) return send(res, 200, "text/html; charset=utf-8", result.html);

  const { message, template, line, column } = result.error;
  const where = template ? `${template}:${line ?? "?"}:${column ?? "?"}\n\n` : "";
  send(res, 500, "text/plain; charset=utf-8", `Render failed\n\n${where}${message}`);
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string) {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}
