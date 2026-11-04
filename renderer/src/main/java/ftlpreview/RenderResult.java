package ftlpreview;

import java.util.List;

/**
 * A successful render. In lenient mode, {@code warnings} lists the missing Mock model values that
 * were skipped; in strict mode it is always empty.
 */
public record RenderResult(String html, List<String> warnings) {}
