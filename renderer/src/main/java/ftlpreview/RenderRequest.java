package ftlpreview;

import java.util.List;
import java.util.Map;

/**
 * One render: the Theme, the Page, the Story's URL (for the locale switcher links), the locale and the merged
 * Mock model.
 *
 * @param strict false to skip failing template parts (e.g. missing Mock model keys) instead of failing the
 *               render; null means strict
 */
public record RenderRequest(Theme theme, String page, String storyUrl, String locale, Map<String, Object> model,
                            Boolean strict) {
    boolean isStrict() {
        return strict == null || strict;
    }

    /**
     * What the Renderer needs of the Theme chain, all prepared by the Node side.
     *
     * @param dirs                Theme chain directories, most specific first
     * @param properties          theme.properties merged over the chain
     * @param resourcesPath       Keycloak's url.resourcesPath, put in the model as is
     * @param resourcesCommonPath Keycloak's url.resourcesCommonPath, put in the model as is
     */
    public record Theme(List<String> dirs, Map<String, String> properties, String resourcesPath,
                        String resourcesCommonPath) {
    }
}
