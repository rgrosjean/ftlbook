package ftlpreview;

import freemarker.cache.TemplateLoader;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Path;

/** Resolves every template name (including each {@code <#import>}) independently through the Theme chain. */
final class ThemeTemplateLoader implements TemplateLoader {
    private final ThemeChain chain;

    ThemeTemplateLoader(ThemeChain chain) {
        this.chain = chain;
    }

    @Override
    public Object findTemplateSource(String name) {
        return chain.find(name).orElse(null);
    }

    @Override
    public long getLastModified(Object source) {
        try {
            return Files.getLastModifiedTime((Path) source).toMillis();
        } catch (IOException e) {
            return -1;
        }
    }

    @Override
    public Reader getReader(Object source, String encoding) throws IOException {
        return Files.newBufferedReader((Path) source, Charset.forName(encoding));
    }

    @Override
    public void closeTemplateSource(Object source) {}
}
