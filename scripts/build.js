// Compiles src/ to dist/ for the published package: Node does not run TypeScript from node_modules.
// The default Mock models are data read at runtime, so they are copied next to the compiled code.
import { cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
rmSync(new URL("dist/", root), { recursive: true, force: true });
execFileSync(process.execPath, [new URL("node_modules/typescript/bin/tsc", root).pathname, "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
cpSync(new URL("src/mock-models/", root), new URL("dist/mock-models/", root), { recursive: true });
