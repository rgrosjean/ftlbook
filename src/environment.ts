import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The Renderer jar targets Java 21 (renderer/pom.xml maven.compiler.release). */
export const REQUIRED_JAVA_MAJOR = 21;

/** Fails with a message naming the requirement when `java` is missing from the PATH or too old. */
export async function checkJava(): Promise<void> {
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
      `Could not run "java -version" (FTL Preview needs a JDK ${REQUIRED_JAVA_MAJOR} or newer): ${err instanceof Error ? err.message : String(err)}`,
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
