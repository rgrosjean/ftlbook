import { REQUIRED_JAVA_MAJOR, spawnRenderer } from "./java.ts";

export interface RenderRequest {
  /** Theme chain directories, most specific first. */
  themes: string[];
  /** The Theme type, for the resource URLs. */
  themeType: string;
  /** The Theme's name as Keycloak would know it, for the resource URLs. */
  themeName: string;
  page: string;
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

/** On success, `warnings` lists template errors skipped in lenient mode (always empty when strict). */
export type RenderResult = { ok: true; html: string; warnings: string[] } | { ok: false; error: RenderError };

export interface RendererProcess {
  render(request: RenderRequest): Promise<RenderResult>;
  stop(): void;
}

/** Starts the long-lived JVM Renderer (ADR 0001) and resolves once it listens. */
export async function startRenderer(): Promise<RendererProcess> {
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
    if (signal !== "SIGTERM") console.error(`Renderer stopped unexpectedly (code ${code}, signal ${signal}).`);
  });
  const endpoint = `http://127.0.0.1:${port}/render`;

  return {
    async render(request) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (res.status === 200) {
        const body = (await res.json().catch(() => undefined)) as { html?: string; warnings?: string[] } | undefined;
        if (typeof body?.html !== "string") {
          throw new Error('Unexpected Renderer response; rebuild it with "npm run build:renderer".');
        }
        return { ok: true, html: body.html, warnings: body.warnings ?? [] };
      }
      if (res.status === 422) return { ok: false, error: ((await res.json()) as { error: RenderError }).error };
      throw new Error(`Renderer failed with HTTP ${res.status}: ${await res.text()}`);
    },
    stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
    },
  };
}
