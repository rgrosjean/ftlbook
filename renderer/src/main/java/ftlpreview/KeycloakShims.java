package ftlpreview;

import freemarker.template.TemplateMethodModelEx;
import freemarker.template.TemplateModelException;
import freemarker.template.TemplateScalarModel;
import freemarker.template.utility.DeepUnwrap;
import org.owasp.html.Encoding;

import java.text.MessageFormat;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Model members that Keycloak provides as Java objects, rebuilt from plain Mock model data
 * so Stories stay declarative.
 */
final class KeycloakShims {
    private static final Pattern VARIABLE = Pattern.compile("\\$\\{([^}]+)}");
    private static final Pattern HREF = Pattern.compile("\\s+href=\"([^\"]*)\"");

    private KeycloakShims() {}

    /** {@code msg(key, args...)}, as Keycloak's MessageFormatterMethod. */
    static TemplateMethodModelEx msg(Properties messages, Locale locale) {
        return args -> {
            if (args.isEmpty()) throw new TemplateModelException("msg() needs a key");
            String key = string(args.get(0));
            Object[] params = args.subList(1, args.size()).stream()
                    .map(a -> resolveVariables(string(a), messages))
                    .toArray();
            String value = resolveVariables(messages.getProperty(key, key), messages);
            return new MessageFormat(value, locale).format(params);
        };
    }

    /** {@code advancedMsg(arg, args...)}, as Keycloak's AdvancedMessageFormatterMethod. */
    static TemplateMethodModelEx advancedMsg(Properties messages, Locale locale) {
        return args -> {
            if (args.isEmpty()) throw new TemplateModelException("advancedMsg() needs an argument");
            String arg = string(args.get(0));
            Object[] params = args.subList(1, args.size()).stream().map(KeycloakShims::string).toArray();
            if (arg.startsWith("${") && arg.endsWith("}")) {
                String key = arg.substring(2, arg.length() - 1);
                return new MessageFormat(messages.getProperty(key, key), locale).format(params);
            }
            return params.length > 0 ? new MessageFormat(arg, locale).format(params) : arg;
        };
    }

    /**
     * {@code kcSanitize(html)}, as Keycloak's KeycloakSanitizerMethod: HTML-decodes up to 5 times,
     * sanitizes with Keycloak's OWASP policy, then un-escapes {@code href} values.
     */
    static TemplateMethodModelEx kcSanitize() {
        return args -> {
            if (args.isEmpty() || args.get(0) == null) throw new TemplateModelException("Can not escape null value.");
            String sanitized = KeycloakSanitizerPolicy.POLICY_DEFINITION.sanitize(decodeHtmlFull(string(args.get(0))));
            return fixUrls(sanitized);
        };
    }

    /** Keycloak assumes HTML may be encoded several times; still encoded after 5 decodings yields "". */
    private static String decodeHtmlFull(String html) {
        for (int i = 0; i < 5; i++) {
            String decoded = Encoding.decodeHtml(html);
            if (decoded.equals(html)) return html;
            html = decoded;
        }
        return "";
    }

    /** Keycloak undoes the sanitizer's escaping inside {@code href} values. */
    private static String fixUrls(String html) {
        Matcher m = HREF.matcher(html);
        StringBuilder out = new StringBuilder(html.length());
        int last = 0;
        while (m.find()) {
            String href = m.group(1).replaceAll("&#61;", "=").replaceAll("\\.\\.", ".").replaceAll("&amp;", "&");
            out.append(html, last, m.start(1)).append(href);
            last = m.end(1);
        }
        return out.append(html.substring(last)).toString();
    }

    /** {@code auth}: Keycloak exposes {@code show*} as methods; Mock model data gives them as booleans. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> auth(Object data) {
        Map<String, Object> auth = new HashMap<>();
        if (!(data instanceof Map<?, ?> map)) return auth;
        ((Map<String, Object>) map).forEach((key, value) -> {
            if (key.startsWith("show")) {
                auth.put(key, (TemplateMethodModelEx) args -> value);
            } else {
                auth.put(key, value);
            }
        });
        return auth;
    }

    /** {@code messagesPerField}, built from Mock model data {@code {field: {type, summary}}}. */
    @SuppressWarnings("unchecked")
    static MessagesPerField messagesPerField(Object data) {
        return new MessagesPerField(data instanceof Map<?, ?> map ? (Map<String, Map<String, String>>) map : Map.of());
    }

    /** Same public surface as Keycloak's MessagesPerFieldBean. */
    public static final class MessagesPerField {
        private final Map<String, Map<String, String>> fields;

        MessagesPerField(Map<String, Map<String, String>> fields) {
            this.fields = fields;
        }

        public boolean exists(String field) {
            return fields.containsKey(field);
        }

        public boolean existsError(String... names) {
            for (String name : names) {
                if (exists(name) && "error".equals(fields.get(name).get("type"))) return true;
            }
            return false;
        }

        public String getFirstError(String... names) {
            for (String name : names) {
                if (existsError(name)) return get(name);
            }
            return "";
        }

        public String get(String field) {
            return exists(field) ? fields.get(field).getOrDefault("summary", "") : "";
        }

        public String printIfExists(String field, String text) {
            return exists(field) ? text : "";
        }
    }

    private static String resolveVariables(String value, Properties messages) {
        Matcher m = VARIABLE.matcher(value);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            m.appendReplacement(out, Matcher.quoteReplacement(messages.getProperty(m.group(1), m.group(0))));
        }
        m.appendTail(out);
        return out.toString();
    }

    private static String string(Object arg) {
        try {
            if (arg instanceof TemplateScalarModel scalar) return scalar.getAsString();
            Object unwrapped = arg instanceof freemarker.template.TemplateModel model ? DeepUnwrap.unwrap(model) : arg;
            return String.valueOf(unwrapped);
        } catch (TemplateModelException e) {
            throw new IllegalArgumentException(e);
        }
    }
}
