import { loadConfig } from "./config.ts";
import { ensureBaseThemes } from "./keycloak-themes.ts";
import { mockModelCatalog, type MockModelCatalog } from "./mock-models.ts";
import { addStories, DEFAULT_STORY, findStory, storyIndex, storyUrl, type IndexedPage, type Story } from "./stories.ts";
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
  /**
   * Scaffold: adds a Story to each of the given Pages (duplicates ignored). The name defaults to the
   * Default Story's. Throws, writing nothing, when no Page is given, the name is empty or a Page is not a
   * Page of the Theme chain.
   */
  addStories(pages: string[], name?: string): Promise<AddedStories>;
  storyUrl(page: string, name: string): string;
}

/** What the Scaffold added: the Story's name and, per Page, its Story file and URL. */
export interface AddedStories {
  name: string;
  stories: {
    page: string;
    /** The Story file written. */
    file: string;
    url: string;
    /** False when the tool ships no default Mock model for the Page, so its Stories cannot render yet. */
    hasDefaultMockModel: boolean;
  }[];
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

  const themeChain = async () => resolveThemeChain(config.themeDir, await baseThemesDir(), config.themeType);
  const pageStoryUrl = (page: string, name: string) => storyUrl(config.themeType, page, name);

  return {
    themeType: config.themeType,
    port: config.port,
    strict: config.strict,
    mockModels,
    setUp: async () => {
      await baseThemesDir();
    },
    themeChain,
    findCommonResource: async (baseTheme, resourcePath) =>
      findCommonResource(await baseThemesDir(), baseTheme, resourcePath),
    findStory: (page, name) => findStory(config.storiesDir, page, name),
    storyIndex: () => storyIndex(config.storiesDir, config.themeType),
    addStories: async (pages, requestedName) => {
      const name = (requestedName ?? DEFAULT_STORY).trim();
      if (pages.length === 0) throw new Error("No Pages chosen");
      if (name === "") throw new Error("The Story name must not be empty");
      const themePages = new Set((await (await themeChain()).pages()).map((p) => p.page));
      const unknown = pages.filter((page) => !themePages.has(page));
      if (unknown.length > 0) throw new Error(`Not a Page of the Theme or its Base theme: ${unknown.join(", ")}`);

      const withDefaults = new Set(await mockModels.pages());
      const written = await addStories(config.storiesDir, [...new Set(pages)], name);
      return {
        name,
        stories: [...written].map(([page, file]) => ({
          page,
          file,
          url: pageStoryUrl(page, name),
          hasDefaultMockModel: withDefaults.has(page),
        })),
      };
    },
    storyUrl: pageStoryUrl,
  };
}
