package ftlpreview;

import java.util.List;
import java.util.Map;

/**
 * One render: the Theme chain (directories, most specific first), the Theme's type and name (for the resource
 * URLs Keycloak derives), the Page, the Story's URL (for the locale switcher links), the locale and the merged
 * Mock model.
 *
 * @param strict false to skip failing template parts (e.g. missing Mock model keys) instead of failing the
 *               render; null means strict
 */
public record RenderRequest(List<String> themes, String themeType, String themeName, String page, String storyUrl, String locale, Map<String, Object> model,
                            Boolean strict) {
    boolean isStrict() {
        return strict == null || strict;
    }
}
