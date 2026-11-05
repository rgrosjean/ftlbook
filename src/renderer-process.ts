import { launchRenderer } from "./java.ts";
import { errorMessage } from "./errors.ts";

/** What the Renderer needs of the Theme chain. */
export interface RenderTheme {
  /** Theme chain directories, most specific first. */
  dirs: string[];
  /** theme.properties merged over the Theme chain; the Renderer does not read them itself. */
  properties: Record<string, string>;
  /** Keycloak's url.resourcesPath, built by the Theme chain; the Renderer only puts it in the model. */
  resourcesPath: string;
  /** Keycloak's url.resourcesCommonPath, built by the Theme chain; the Renderer only puts it in the model. */
  resourcesCommonPath: string;
}

export interface RenderRequest {
  theme: RenderTheme;
  page: string;
  /** The Story's URL, which the locale switcher links to with ?locale=. */
  storyUrl: string;
  locale: string;
  model: Record<string, unknown>;
  /** Strict mode: a missing Mock model value fails the render. false (lenient): it is skipped and reported as a warning. */
  strict: boolean;
}

/** An FTL error, located by file and line. */
export interface FtlError {
  message: string;
  template: string | null;
  /** The template's file on disk, resolved through the Theme chain. */
  file: string | null;
  line: number | null;
  column: number | null;
}

/**
 * How a render ended. `rendered`: `warnings` lists template errors skipped in lenient mode (always empty when
 * strict). `ftl-error`: an FTL error in the Theme chain. `renderer-failure`: the Renderer itself failing (an error
 * response, or a Renderer that stopped and could not be restarted).
 */
export type RenderOutcome =
  | { kind: "rendered"; html: string; warnings: string[] }
  | { kind: "ftl-error"; error: FtlError }
  | { kind: "renderer-failure"; message: string };

export interface RendererProcess {
  render(request: RenderRequest): Promise<RenderOutcome>;
  stop(): void;
}

/**
 * Starts the long-lived JVM Renderer (ADR 0001) and resolves once it listens. When the Renderer process dies,
 * the next render starts a new one, once per render.
 */
export async function startRenderer(): Promise<RendererProcess> {
  let current = launch();
  await current;
  let stopped = false;
  const failure = (message: string): RenderOutcome => ({ kind: "renderer-failure", message });

  /** The running Renderer, started anew if it died; concurrent renders share one restart. */
  async function running() {
    const pending = current;
    const launched = await pending.catch(() => undefined);
    if (launched?.running()) return launched;
    if (current === pending) current = launch();
    return current;
  }

  return {
    async render(request) {
      if (stopped) return failure("The Renderer has been stopped.");
      let renderer;
      try {
        renderer = await running();
      } catch (err) {
        return failure(`The Renderer stopped and could not be restarted: ${errorMessage(err)}. Restart ftl-preview serve.`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${renderer.port}/render`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        if (res.status === 200) {
          const body = (await res.json().catch(() => undefined)) as { html?: string; warnings?: string[] } | undefined;
          if (typeof body?.html !== "string") {
            return failure('Unexpected Renderer response; rebuild it with "npm run build:renderer".');
          }
          return { kind: "rendered", html: body.html, warnings: body.warnings ?? [] };
        }
        if (res.status === 422) return { kind: "ftl-error", error: ((await res.json()) as { error: FtlError }).error };
        return failure(`The Renderer answered HTTP ${res.status}: ${await res.text()}`);
      } catch (err) {
        // The Renderer stopped mid-request, or its answer broke off; the next render restarts it if needed
        return failure(`Could not get an answer from the Renderer (${errorMessage(err)}); reload to try again.`);
      }
    },
    stop() {
      stopped = true;
      current.then((launched) => launched.stop(), () => {});
    },
  };

  function launch() {
    return launchRenderer((code, signal) =>
      console.error(`Renderer stopped unexpectedly (code ${code}, signal ${signal}); the next render restarts it.`),
    );
  }
}
