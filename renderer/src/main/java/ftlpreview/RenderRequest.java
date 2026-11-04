package ftlpreview;

import java.util.List;
import java.util.Map;

/**
 * One render: the Theme chain (directories, most specific first), the Page, the locale and the merged Mock model.
 */
public record RenderRequest(List<String> themes, String page, String locale, Map<String, Object> model) {}
