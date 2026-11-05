import { readFile } from "node:fs/promises";
import type { FtlError } from "./renderer-process.ts";
import { escapeHtml } from "./html.ts";

/** An error to show; location fields are optional (e.g. an invalid Story file has none). */
export type LocatedError = Pick<FtlError, "message"> & Partial<Omit<FtlError, "message">>;

const CONTEXT_LINES = 3;

/** A readable HTML page for a failed render: what failed, where, and the surrounding FTL source. */
export async function errorOverlay(title: string, error: LocatedError): Promise<string> {
  const location = error.file ?? error.template;
  const where = location
    ? `${location}${error.line ? `, line ${error.line}` : ""}${error.column ? `, column ${error.column}` : ""}`
    : "";
  const excerpt = await sourceExcerpt(error.file, error.line);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}${location ? ` · ${escapeHtml(location)}` : ""}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #1e1e1e; color: #eee; }
  main { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { color: #ff6b6b; font-size: 1.4rem; }
  .where { color: #9cdcfe; font-family: ui-monospace, monospace; }
  pre { background: #111; padding: 1rem; overflow-x: auto; border-radius: 4px; }
  .excerpt .line { display: block; }
  .excerpt .failing { background: #5a1d1d; }
  .excerpt .no { color: #777; user-select: none; display: inline-block; width: 4ch; text-align: right; margin-right: 1ch; }
</style>
</head>
<body>
<main id="ftl-preview-error">
<h1>${escapeHtml(title)}</h1>
${where ? `<p class="where">${escapeHtml(where)}</p>` : ""}
${excerpt}
<pre class="message">${escapeHtml(error.message)}</pre>
</main>
</body>
</html>`;
}

async function sourceExcerpt(file: string | null | undefined, line: number | null | undefined): Promise<string> {
  if (!file || !line) return "";
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return "";
  }
  const lines = source.split(/\r?\n/);
  const from = Math.max(1, line - CONTEXT_LINES);
  const to = Math.min(lines.length, line + CONTEXT_LINES);
  const rows = [];
  for (let n = from; n <= to; n++) {
    const cls = n === line ? "line failing" : "line";
    rows.push(`<span class="${cls}"><span class="no">${n}</span>${escapeHtml(lines[n - 1])}</span>`);
  }
  return `<pre class="excerpt">${rows.join("")}</pre>`;
}
