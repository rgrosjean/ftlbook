#!/usr/bin/env node
// The ftl-preview command. Plain JavaScript, so that a Node too old to run the TypeScript
// sources still gets a clear message instead of a syntax error.
import { existsSync, readFileSync } from "node:fs";

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

// A checkout runs the TypeScript sources; the published package ships them compiled to dist/,
// because Node does not run TypeScript from node_modules
const sources = new URL("../src/cli.ts", import.meta.url);
await import(existsSync(sources) ? sources.href : new URL("../dist/cli.js", import.meta.url).href);
