import { loadConfig } from "./config.ts";
import { ensureBaseThemes } from "./keycloak-themes.ts";
import { mockModelCatalog, type MockModelCatalog } from "./mock-models.ts";
import { addStories, findStory, storyIndex, storyUrl, type IndexedPage, type Story } from "./stories.ts";
import { findCommonResource, resolveThemeChain, type ThemeChain } from "./theme-chain.ts";
import type { Resource } from "./resources.ts";

/**
 * The customer repository FTL Preview runs in: its Theme, Story files and pinned Keycloak version.
 *
 * Config, Mock model choice and Base themes are fixed when the Project opens (config edits need a
 * restart); the Theme chain and Story files are read fresh on every call, so edits show on reload.
 * Nothing here writes to the console.
 */
export interface Project {
  /** The Theme type previewed; only login so far (see config). */
  readonly themeType: string;
  /** Configured port of the preview server. */
  readonly port: number;
  /** Configured strict mode: a missing Mock model value fails the render. */
  readonly strict: boolean;
  /** Default Mock models of the Theme type, with the warning to show when they come from another Keycloak version. */
  readonly mockModels: MockModelCatalog;
  /**
   * Sets up Java and the Base themes now rather than on first need, so a command can fail before
   * it starts serving. Done once; every later call reuses the result.
   */
  setUp(): Promise<void>;
  themeChain(): Promise<ThemeChain>;
  /** A resource of a Base theme's common type, e.g. keycloak/common. */
  findCommonResource(baseTheme: string, resourcePath: string): Promise<Resource | undefined>;
  /** A Story by Page and name, the Default Story included. */
  findStory(page: string, name: string): Promise<Story | undefined>;
  storyIndex(): Promise<IndexedPage[]>;
  /** Adds a Story named `name` to each Page; returns the Story file written for each Page. */
  addStories(pages: string[], name: string): Promise<Map<string, string>>;
  storyUrl(page: string, name: string): string;
}

/**
 * Opens the Project at `projectDir`: reads the config and picks the default Mock models. Cheap and
 * Java-free; Java and the Base themes are set up on the first call that needs them.
 *
 * @param progress receives progress messages, such as Base theme downloads
 */
export async function openProject(projectDir: string, progress: (msg: string) => void): Promise<Project> {
  const config = await loadConfig(projectDir);
  const mockModels = await mockModelCatalog(config.keycloakVersion, config.themeType);

  let baseThemes: Promise<string> | undefined;
  const baseThemesDir = () => (baseThemes ??= ensureBaseThemes(config.keycloakVersion, config.mavenRepository, progress));

  return {
    themeType: config.themeType,
    port: config.port,
    strict: config.strict,
    mockModels,
    setUp: async () => {
      await baseThemesDir();
    },
    themeChain: async () => resolveThemeChain(config.themeDir, await baseThemesDir(), config.themeType),
    findCommonResource: async (baseTheme, resourcePath) =>
      findCommonResource(await baseThemesDir(), baseTheme, resourcePath),
    findStory: (page, name) => findStory(config.storiesDir, page, name),
    storyIndex: () => storyIndex(config.storiesDir, config.themeType),
    addStories: (pages, name) => addStories(config.storiesDir, pages, name),
    storyUrl: (page, name) => storyUrl(config.themeType, page, name),
  };
}
