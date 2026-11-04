import http from "node:http";
import { defaultMockModel } from "./mock-models.ts";
import type { RendererProcess, ThemeRoot } from "./renderer-process.ts";

export interface PreviewServerOptions {
  renderer: RendererProcess;
  /** Theme chain for the login Theme type, most specific first. */
  themes: ThemeRoot[];
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
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const match = PREVIEW_ROUTE.exec(pathname);
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

  const result = await options.renderer.render({ themes: options.themes, page, locale: "en", model });
  if (result.ok) return send(res, 200, "text/html; charset=utf-8", result.html);

  const { message, template, line, column } = result.error;
  const where = template ? `${template}:${line ?? "?"}:${column ?? "?"}\n\n` : "";
  send(res, 500, "text/plain; charset=utf-8", `Render failed\n\n${where}${message}`);
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string) {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}
