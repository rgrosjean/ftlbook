import type { IndexedPage } from "./stories.ts";
import { escapeHtml } from "./html.ts";

export interface PreviewUiData {
  pages: IndexedPage[];
  /** Locales the Theme supports (theme.properties `locales`). */
  locales: string[];
  /** Problem with the Story files or the Theme, shown instead of the list. */
  storyError?: string;
}

/**
 * The preview UI: a sidebar of Pages and Stories, and the selected Story in an iframe.
 * Story links target the iframe directly, so selecting a Story needs no script.
 */
export function previewUi({ pages, locales, storyError }: PreviewUiData): string {
  const firstStoryUrl = pages[0]?.stories[0]?.url;
  const sidebar = storyError
    ? `<p class="problem">${escapeHtml(storyError)}</p>`
    : pages.length === 0
      ? `<p class="hint">No Stories yet. Add a <code>*.stories.json</code> file to <code>stories/</code>.</p>`
      : pages.map(pageSection).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FTL Preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: grid; grid-template-columns: 260px 1fr; font: 14px/1.4 system-ui, sans-serif; color: #222; }
  nav { border-right: 1px solid #ddd; overflow-y: auto; padding: 0.75rem; background: #fafafa; }
  nav h1 { font-size: 1rem; margin: 0 0 0.75rem; }
  nav h2 { font-size: 0.85rem; margin: 1rem 0 0.25rem; color: #555; font-family: ui-monospace, monospace; }
  nav ul { list-style: none; margin: 0; padding: 0; }
  nav a { display: block; padding: 0.2rem 0.5rem; border-radius: 4px; color: inherit; text-decoration: none; }
  nav a:hover { background: #eee; }
  nav a.selected { background: #0066cc; color: #fff; }
  .problem { color: #b00020; white-space: pre-wrap; }
  .hint { color: #666; }
  main { display: flex; flex-direction: column; min-width: 0; background: #e9e9e9; }
  .toolbar { display: flex; gap: 1rem; align-items: center; padding: 0.4rem 0.75rem; border-bottom: 1px solid #ddd; background: #fff; }
  .stage { flex: 1; overflow: auto; display: flex; justify-content: center; }
  iframe { border: 0; background: #fff; width: 100%; height: 100%; transition: width 0.15s; }
  .viewports button { border: 1px solid #ccc; background: #fff; padding: 0.2rem 0.6rem; cursor: pointer; }
  .viewports button[aria-pressed="true"] { background: #0066cc; border-color: #0066cc; color: #fff; }
</style>
</head>
<body>
<nav>
<h1>FTL Preview</h1>
${sidebar}
</nav>
<main>
<div class="toolbar">
<label>Locale <select id="locale" autocomplete="off">
<option value="">Story locale</option>
${locales.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("\n")}
</select></label>
<span class="viewports" role="group" aria-label="Viewport">
${VIEWPORTS.map((v) => `<button type="button" data-viewport-width="${v.width}">${v.label}</button>`).join("")}
</span>
</div>
<div class="stage"><iframe name="preview" title="Story preview"${firstStoryUrl ? ` src="${escapeHtml(firstStoryUrl)}"` : ""}></iframe></div>
</main>
<script>${UI_SCRIPT}</script>
</body>
</html>`;
}

const VIEWPORTS = [
  { label: "Desktop", width: "100%" },
  { label: "Tablet", width: "768px" },
  { label: "Mobile", width: "375px" },
];

/** Keeps the chosen locale when switching Stories, and marks the selected Story. Links work without it. */
const UI_SCRIPT = `
const frame = document.querySelector('iframe[name="preview"]');
const locale = document.getElementById("locale");
const links = [...document.querySelectorAll('nav a[target="preview"]')];
// The Story last shown, so the locale can still be applied after navigating inside the preview
let storyUrl = frame.getAttribute("src") ? new URL(frame.getAttribute("src"), location.href) : null;

function show(url) {
  storyUrl = url;
  if (locale.value) url.searchParams.set("locale", locale.value);
  else url.searchParams.delete("locale");
  frame.src = url.pathname + url.search;
}
function iframeUrl() {
  try { return new URL(frame.contentWindow.location.href); } catch { return null; }
}
function markSelected(pathname) {
  for (const a of links) a.classList.toggle("selected", new URL(a.href).pathname === pathname);
}
for (const a of links) {
  a.addEventListener("click", (event) => { event.preventDefault(); show(new URL(a.href)); });
}
locale.addEventListener("change", () => {
  const url = iframeUrl();
  if (url && url.pathname.startsWith("/preview/")) show(url);
  else if (storyUrl) show(new URL(storyUrl));
});
// Keep the sidebar in step with whatever the preview shows
frame.addEventListener("load", () => {
  const url = iframeUrl();
  if (url && url.pathname.startsWith("/preview/")) {
    storyUrl = url;
    markSelected(url.pathname);
  }
});
if (storyUrl) markSelected(storyUrl.pathname);

const viewportButtons = [...document.querySelectorAll("button[data-viewport-width]")];
function setViewport(button) {
  frame.style.width = button.dataset.viewportWidth;
  for (const b of viewportButtons) b.setAttribute("aria-pressed", String(b === button));
}
for (const b of viewportButtons) b.addEventListener("click", () => setViewport(b));
if (viewportButtons[0]) setViewport(viewportButtons[0]);
`;

function pageSection(page: IndexedPage): string {
  const links = page.stories
    .map((s) => `<li><a href="${escapeHtml(s.url)}" target="preview">${escapeHtml(s.name)}</a></li>`)
    .join("");
  return `<section><h2>${escapeHtml(page.page)}</h2><ul>${links}</ul></section>`;
}
