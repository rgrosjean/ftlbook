import { REQUIRED_JAVA_MAJOR, spawnRenderer } from "./java.ts";

export interface RenderRequest {
  /** Theme chain directories, most specific first. */
  themes: string[];
  /** The Theme type, for the resource URLs. */
  themeType: string;
  /** The Theme's name as Keycloak would know it, for the resource URLs. */
  themeName: string;
  /** theme.properties merged over the Theme chain; the Renderer does not read them itself. */
  properties: Record<string, string>;
  page: string;
  /** The Story's URL, which the locale switcher links to with ?locale=. */
  storyUrl: string;
  locale: string;
  model: Record<string, unknown>;
  /** Strict mode: a missing Mock model value fails the render. false (lenient): it is skipped and reported as a warning. */
  strict: boolean;
}

export interface RenderError {
  message: string;
  template: string | null;
  /** The template's file on disk, resolved through the Theme chain. */
  file: string | null;
  line: number | null;
  column: number | null;
}

/**
 * On success, `warnings` lists template errors skipped in lenient mode (always empty when strict). A located
 * `error` is a template error; a `rendererFailure` is the Renderer itself failing (an error response, or a
 * Renderer that stopped and could not be restarted).
 */
export type RenderResult =
  | { ok: true; html: string; warnings: string[] }
  | { ok: false; error: RenderError }
  | { ok: false; rendererFailure: string };

export interface RendererProcess {
  render(request: RenderRequest): Promise<RenderResult>;
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
  const failure = (message: string): RenderResult => ({ ok: false, rendererFailure: message });

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
        const res = await fetch(renderer.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        if (res.status === 200) {
          const body = (await res.json().catch(() => undefined)) as { html?: string; warnings?: string[] } | undefined;
          if (typeof body?.html !== "string") {
            return failure('Unexpected Renderer response; rebuild it with "npm run build:renderer".');
          }
          return { ok: true, html: body.html, warnings: body.warnings ?? [] };
        }
        if (res.status === 422) return { ok: false, error: ((await res.json()) as { error: RenderError }).error };
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

  /** Spawns a Renderer and waits for its LISTENING line. */
  async function launch() {
    // stdin stays open: the Renderer exits when it closes, so it never outlives the CLI
    const child = await spawnRenderer();
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      child.once("error", (err) =>
        reject(new Error(`Could not start Java (${err.message}). A JDK ${REQUIRED_JAVA_MAJOR} or newer must be on the PATH.`)),
      );
      child.once("exit", (code) => reject(new Error(`Renderer exited early with code ${code}`)));
      const onData = (chunk: Buffer) => {
        out += chunk;
        const match = out.match(/LISTENING (\d+)/);
        if (match) {
          child.stdout.off("data", onData);
          child.stdout.resume();
          resolve(Number(match[1]));
        }
      };
      child.stdout.on("data", onData);
    });
    child.once("exit", (code, signal) => {
      if (!stopped) console.error(`Renderer stopped unexpectedly (code ${code}, signal ${signal}); the next render restarts it.`);
    });
    return {
      endpoint: `http://127.0.0.1:${port}/render`,
      running: () => child.exitCode === null && child.signalCode === null,
      stop() {
        if (this.running()) child.kill("SIGTERM");
      },
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
