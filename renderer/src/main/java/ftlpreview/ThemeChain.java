package ftlpreview;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.PropertyResourceBundle;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The ordered Theme directories a Page is resolved against, most specific first
 * (mirrors Keycloak's ExtendingTheme: theme, its import, its parent, ...).
 * Every lookup reads from disk, so edits show on the next render.
 */
final class ThemeChain {
    private static final Map<Path, FileSystem> JARS = new ConcurrentHashMap<>();

    private final List<Path> roots;

    private ThemeChain(List<Path> roots) {
        this.roots = roots;
    }

    static ThemeChain of(List<RenderRequest.ThemeRoot> themes) {
        List<Path> roots = new ArrayList<>();
        for (RenderRequest.ThemeRoot theme : themes) {
            if (theme.jar() == null) {
                roots.add(Path.of(theme.path()));
            } else {
                roots.add(jar(Path.of(theme.jar())).getPath("/" + theme.path()));
            }
        }
        return new ThemeChain(roots);
    }

    private static FileSystem jar(Path jarFile) {
        return JARS.computeIfAbsent(jarFile.toAbsolutePath(), p -> {
            try {
                return FileSystems.newFileSystem(p);
            } catch (IOException e) {
                throw new UncheckedIOException("Cannot open theme jar " + p, e);
            }
        });
    }

    /** First Theme in the chain that has the file; names escaping the Theme directory are rejected. */
    Optional<Path> find(String name) {
        for (Path root : roots) {
            Path candidate = root.resolve(name).normalize();
            if (candidate.startsWith(root) && Files.isRegularFile(candidate)) {
                return Optional.of(candidate);
            }
        }
        return Optional.empty();
    }

    /** theme.properties merged from least to most specific Theme, so the child wins. */
    Properties properties() {
        Properties merged = new Properties();
        for (Path root : reversed()) {
            load(root.resolve("theme.properties"), merged);
        }
        return merged;
    }

    /**
     * Messages for a locale: each locale in the fallback chain (least specific first),
     * and within a locale each Theme from least to most specific, so the child wins.
     */
    Properties messages(Locale locale) {
        Properties merged = new Properties();
        for (Locale l : fallbackChain(locale)) {
            for (Path root : reversed()) {
                load(root.resolve("messages/messages_" + bundleSuffix(l) + ".properties"), merged);
            }
        }
        return merged;
    }

    /** en, then e.g. de, then de_CH (mirrors Keycloak LocaleUtil.getParentLocale, without realm default). */
    static List<Locale> fallbackChain(Locale locale) {
        List<Locale> chain = new ArrayList<>();
        for (Locale l = locale; l != null; l = parent(l)) {
            chain.add(0, l);
        }
        return chain;
    }

    private static Locale parent(Locale l) {
        if (!l.getVariant().isEmpty()) return new Locale.Builder().setLanguage(l.getLanguage()).setRegion(l.getCountry()).build();
        if (!l.getCountry().isEmpty()) return Locale.of(l.getLanguage());
        if (!l.getLanguage().equals("en")) return Locale.ENGLISH;
        return null;
    }

    /** de, de_CH, zh_Hant_TW: language, then optional script, country and variant (Locale.toString adds "#" for scripts). */
    private static String bundleSuffix(Locale l) {
        StringBuilder suffix = new StringBuilder(l.getLanguage());
        for (String part : List.of(l.getScript(), l.getCountry(), l.getVariant())) {
            if (!part.isEmpty()) suffix.append('_').append(part);
        }
        return suffix.toString();
    }

    private List<Path> reversed() {
        List<Path> reversed = new ArrayList<>(roots);
        Collections.reverse(reversed);
        return reversed;
    }

    private static void load(Path file, Properties into) {
        if (!Files.isRegularFile(file)) return;
        try (InputStream in = Files.newInputStream(file)) {
            // Same reader Keycloak uses: UTF-8 with ISO-8859-1 fallback
            PropertyResourceBundle bundle = new PropertyResourceBundle(in);
            for (String key : Collections.list(bundle.getKeys())) {
                into.put(key, bundle.getString(key));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + file, e);
        }
    }
}
