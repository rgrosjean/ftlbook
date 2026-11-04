package ftlpreview;

import java.util.LinkedHashMap;
import java.util.Map;

/** A render failure located in an FTL file, as FreeMarker reports it. */
public final class RenderException extends Exception {
    private final String template;
    private final String file;
    private final Integer line;
    private final Integer column;

    public RenderException(String message, String template, Integer line, Integer column, Throwable cause) {
        this(message, template, null, line, column, cause);
    }

    /** @param file the template's file on disk, as resolved through the Theme chain */
    public RenderException(String message, String template, String file, Integer line, Integer column, Throwable cause) {
        super(message, cause);
        this.template = template;
        this.file = file;
        this.line = line;
        this.column = column;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("message", getMessage());
        json.put("template", template);
        json.put("file", file);
        json.put("line", line);
        json.put("column", column);
        return json;
    }
}
