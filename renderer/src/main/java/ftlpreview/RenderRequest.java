package ftlpreview;

import java.util.List;
import java.util.Map;

/**
 * One render: the Theme chain (most specific first), the Page, the locale and the merged Mock model.
 *
 * @param themes each entry is a Theme directory, either on disk ({@code jar} absent)
 *               or inside a jar ({@code jar} = jar file, {@code path} = directory inside it)
 */
public record RenderRequest(List<ThemeRoot> themes, String page, String locale, Map<String, Object> model) {
    public record ThemeRoot(String jar, String path) {}
}
