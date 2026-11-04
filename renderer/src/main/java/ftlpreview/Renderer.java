package ftlpreview;

import freemarker.core.HTMLOutputFormat;
import freemarker.core.InvalidReferenceException;
import freemarker.core.TemplateClassResolver;
import freemarker.template.Configuration;
import freemarker.template.SimpleScalar;
import freemarker.template.Template;
import freemarker.template.TemplateException;
import freemarker.template.TemplateExceptionHandler;
import freemarker.template.TemplateMethodModelEx;
import freemarker.template.TemplateModelException;

import java.io.IOException;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

/** Renders one Page with real FreeMarker, configured as Keycloak's DefaultFreeMarkerProvider. */
final class Renderer {

    /** Where the preview server serves Theme resources (Keycloak's theme root URL). */
    private static final String THEME_ROOT = "/resources";

    RenderResult render(RenderRequest request) throws RenderException {
        ThemeChain chain = ThemeChain.of(request.themes());
        Locale locale = Locale.forLanguageTag(request.locale() == null ? "en" : request.locale());
        Properties properties = chain.properties();
        Properties messages = chain.messages(locale);

        Map<String, Object> model = new HashMap<>(request.model() == null ? Map.of() : request.model());
        model.put("properties", properties);
        TemplateMethodModelEx msg = KeycloakShims.msg(messages, locale);
        model.put("msg", msg);
        model.put("advancedMsg", KeycloakShims.advancedMsg(messages, locale));
        model.put("kcSanitize", KeycloakShims.kcSanitize());
        model.put("auth", KeycloakShims.auth(model.get("auth")));
        model.put("messagesPerField", KeycloakShims.messagesPerField(model.get("messagesPerField")));
        // Derived keys Keycloak computes rather than takes from the request
        model.put("lang", locale.toLanguageTag());
        model.put("templateName", request.page());
        model.put("pageId", request.page().replaceFirst("\\.ftl$", ""));
        model.putIfAbsent("darkMode", "true".equals(properties.getProperty("darkMode")));
        model.putIfAbsent("title", title(model, msg));
        model.put("url", urlBean(model.get("url"), request.themeType(), request.themeName(), properties));

        List<String> warnings = new ArrayList<>();
        Configuration cfg = configuration(chain, request.isStrict(), warnings);
        try {
            Template template = cfg.getTemplate(request.page(), "UTF-8");
            StringWriter out = new StringWriter();
            template.process(model, out);
            return new RenderResult(out.toString(), warnings);
        } catch (TemplateException e) {
            throw new RenderException(e.getMessageWithoutStackTop(), e.getTemplateSourceName(),
                    fileOf(chain, e.getTemplateSourceName()), e.getLineNumber(), e.getColumnNumber(), e);
        } catch (freemarker.core.ParseException e) {
            throw new RenderException(e.getEditorMessage(), e.getTemplateName(), fileOf(chain, e.getTemplateName()),
                    e.getLineNumber(), e.getColumnNumber(), e);
        } catch (freemarker.template.TemplateNotFoundException e) {
            throw new RenderException("Page not found in the Theme chain: " + request.page(), null, null, null, e);
        } catch (IOException e) {
            throw new RenderException(e.getMessage(), null, null, null, e);
        }
    }

    private static String fileOf(ThemeChain chain, String templateName) {
        return templateName == null ? null : chain.find(templateName).map(Object::toString).orElse(null);
    }

    /**
     * @param strict   true: any template error fails the render (RETHROW). false (lenient): a missing or null
     *                 Mock model value skips the failing interpolation or directive and is added to {@code warnings};
     *                 every other template error still fails the render.
     */
    private static Configuration configuration(ThemeChain chain, boolean strict, List<String> warnings) {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);
        cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
        cfg.setNewBuiltinClassResolver(TemplateClassResolver.ALLOWS_NOTHING_RESOLVER);
        cfg.setTemplateLoader(new ThemeTemplateLoader(chain));
        cfg.setDefaultEncoding("UTF-8");
        // Strict: a missing Mock model key fails and names the key and template line
        cfg.setTemplateExceptionHandler(strict ? TemplateExceptionHandler.RETHROW_HANDLER : (e, env, out) -> {
            if (!(e instanceof InvalidReferenceException)) throw e;
            warnings.add(e.getMessageWithoutStackTop());
        });
        cfg.setLogTemplateExceptions(false);
        return cfg;
    }

    /**
     * Keycloak's UrlBean: the Mock model's flow URLs plus the resource URLs derived from the Theme, which
     * replace any mocked value:
     * resourcesPath is the theme root, type and name; resourcesCommonPath the theme root and the
     * {@code common} theme property, else common/keycloak. The theme root is the preview server's /resources.
     */
    private static Map<String, Object> urlBean(Object mocked, String themeType, String themeName, Properties properties) {
        Map<String, Object> url = new HashMap<>();
        if (mocked instanceof Map<?, ?> m) m.forEach((k, v) -> url.put(String.valueOf(k), v));
        url.put("resourcesPath", THEME_ROOT + "/" + themeType + "/" + themeName);
        String common = properties.getProperty("common");
        url.put("resourcesCommonPath", THEME_ROOT + "/" + (common == null || common.isEmpty() ? "common/keycloak" : common));
        return url;
    }

    /** Keycloak: title = msg("loginTitle", realm.displayName). */
    private static Object title(Map<String, Object> model, TemplateMethodModelEx msg) throws RenderException {
        Object realm = model.get("realm");
        Object displayName = realm instanceof Map<?, ?> r ? r.get("displayName") : null;
        if (displayName == null) return null;
        try {
            return msg.exec(List.of(new SimpleScalar("loginTitle"), new SimpleScalar(String.valueOf(displayName))));
        } catch (TemplateModelException e) {
            throw new RenderException(e.getMessage(), null, null, null, e);
        }
    }
}
