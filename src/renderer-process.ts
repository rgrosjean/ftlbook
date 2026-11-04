import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const RENDERER_JAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "renderer",
  "target",
  "ftl-preview-renderer.jar",
);

export interface RenderRequest {
  /** Theme chain directories, most specific first. */
  themes: string[];
  page: string;
  locale: string;
  model: Record<string, unknown>;
}

export interface RenderError {
  message: string;
  template: string | null;
  line: number | null;
  column: number | null;
}

export type RenderResult = { ok: true; html: string } | { ok: false; error: RenderError };

export interface RendererProcess {
  render(request: RenderRequest): Promise<RenderResult>;
  stop(): void;
}

/** Starts the long-lived JVM Renderer (ADR 0001) and resolves once it listens. */
export async function startRenderer(): Promise<RendererProcess> {
  if (!existsSync(RENDERER_JAR)) {
    throw new Error(`Renderer not built: ${RENDERER_JAR} is missing. Run "npm run build:renderer".`);
  }
  // stdin stays open: the Renderer exits when it closes, so it never outlives the CLI
  const child = spawn("java", ["-jar", RENDERER_JAR, "0"], { stdio: ["pipe", "pipe", "inherit"] });

  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    child.once("error", (err) =>
      reject(new Error(`Could not start Java (${err.message}). A JDK 21 or newer must be on the PATH.`)),
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
      if (res.status === 200) return { ok: true, html: await res.text() };
      if (res.status === 422) return { ok: false, error: ((await res.json()) as { error: RenderError }).error };
      throw new Error(`Renderer failed with HTTP ${res.status}: ${await res.text()}`);
    },
    stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
    },
  };
}
