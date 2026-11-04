#!/usr/bin/env node
// The ftl-preview command. Plain JavaScript, so that a Node too old to run the TypeScript
// sources still gets a clear message instead of a syntax error.
import { readFileSync } from "node:fs";

const { engines } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// engines.node is ">=<major>.<minor>"
const [, requiredMajor, requiredMinor] = /^>=\s*(\d+)\.(\d+)/.exec(engines.node).map(Number);
const [major, minor] = process.versions.node.split(".").map(Number);

if (major < requiredMajor || (major === requiredMajor && minor < requiredMinor)) {
  console.error(
    `FTL Preview needs Node.js ${requiredMajor}.${requiredMinor} or newer (found ${process.versions.node}).`,
  );
  process.exit(1);
}

await import("../src/cli.ts");
