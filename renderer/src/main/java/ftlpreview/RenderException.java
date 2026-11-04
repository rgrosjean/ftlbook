package ftlpreview;

import java.util.LinkedHashMap;
import java.util.Map;

/** A render failure located in an FTL file, as FreeMarker reports it. */
public final class RenderException extends Exception {
    private final String template;
    private final Integer line;
    private final Integer column;

    public RenderException(String message, String template, Integer line, Integer column, Throwable cause) {
        super(message, cause);
        this.template = template;
        this.line = line;
        this.column = column;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("message", getMessage());
        json.put("template", template);
        json.put("line", line);
        json.put("column", column);
        return json;
    }
}
