import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import { errorMessage } from "./errors.ts";

const execFileAsync = promisify(execFile);

/** The Renderer jar targets Java 21 (renderer/pom.xml maven.compiler.release). */
const REQUIRED_JAVA_MAJOR = 21;

/** Built by `npm run build:renderer`; also holds the Base theme jar extractor. */
const RENDERER_JAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "renderer",
  "target",
  "ftl-preview-renderer.jar",
);

let javaChecked: Promise<void> | undefined;

/**
 * Fails with a message naming the requirement when `java` is missing from the PATH or too old.
 * Checked once per process; every other function here calls it first.
 */
export function requireJava(): Promise<void> {
  javaChecked ??= checkJava();
  return javaChecked;
}

/** Unpacks a jar into a directory, with the Renderer jar's extractor. */
export async function extractJar(jar: string, targetDir: string): Promise<void> {
  await requireJava();
  try {
    await execFileAsync("java", ["-cp", rendererJar(), "ftlpreview.ExtractJar", jar, targetDir]);
  } catch (err) {
    throw new Error(`Could not extract ${jar}: ${errorMessage(err)}`);
  }
}

/** A started Renderer JVM, listening on `port` of the loopback interface. */
export interface LaunchedRenderer {
  readonly port: number;
  /** False once the process has exited, for whatever reason. */
  running(): boolean;
  stop(): void;
}

/**
 * Starts the Renderer JVM (ADR 0001) and resolves once it prints `LISTENING <port>`. It listens on a free port,
 * keeps stderr on ours and exits when its stdin closes, so it never outlives the CLI.
 *
 * @param onUnexpectedExit called when the process exits after starting without `stop()` being called
 */
export async function launchRenderer(
  onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
): Promise<LaunchedRenderer> {
  await requireJava();
  // stdin stays open: the Renderer exits when it closes
  const child = spawn("java", ["-jar", rendererJar(), "0"], { stdio: ["pipe", "pipe", "inherit"] });
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

  let stopping = false;
  child.once("exit", (code, signal) => {
    if (!stopping) onUnexpectedExit(code, signal);
  });
  const running = () => child.exitCode === null && child.signalCode === null;
  return {
    port,
    running,
    stop() {
      stopping = true;
      if (running()) child.kill("SIGTERM");
    },
  };
}

function rendererJar(): string {
  if (!existsSync(RENDERER_JAR)) {
    throw new Error(`Renderer not built: ${RENDERER_JAR} is missing. Run "npm run build:renderer".`);
  }
  return RENDERER_JAR;
}

async function checkJava(): Promise<void> {
  let output: string;
  try {
    // `java -version` prints to stderr
    const { stdout, stderr } = await execFileAsync("java", ["-version"]);
    output = stderr + stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Java was not found on the PATH. FTL Preview needs a JDK ${REQUIRED_JAVA_MAJOR} or newer to run its Renderer.`,
      );
    }
    throw new Error(
      `Could not run "java -version" (FTL Preview needs a JDK ${REQUIRED_JAVA_MAJOR} or newer): ${errorMessage(err)}`,
    );
  }
  const major = javaMajor(output);
  if (major === undefined) {
    throw new Error(`Could not read the Java version from "java -version":\n${output.trim()}`);
  }
  if (major < REQUIRED_JAVA_MAJOR) {
    throw new Error(
      `FTL Preview needs a JDK ${REQUIRED_JAVA_MAJOR} or newer, but java on the PATH is version ${major}.`,
    );
  }
}

/** `version "21.0.4"` gives 21; the old scheme `version "1.8.0_402"` gives 8. */
function javaMajor(versionOutput: string): number | undefined {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(versionOutput);
  if (!match) return undefined;
  const first = Number(match[1]);
  return first === 1 && match[2] !== undefined ? Number(match[2]) : first;
}
