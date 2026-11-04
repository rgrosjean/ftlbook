package ftlpreview;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * {@code java -cp ftl-preview-renderer.jar ftlpreview.ExtractJar <jar> <dir>}: unpacks a jar so the
 * CLI can read Base themes as plain directories (no zip library needed on the Node side).
 */
public final class ExtractJar {
    public static void main(String[] args) throws IOException {
        if (args.length != 2) {
            System.err.println("Usage: ExtractJar <jar> <targetDir>");
            System.exit(2);
        }
        Path target = Path.of(args[1]).toAbsolutePath().normalize();
        try (ZipFile zip = new ZipFile(args[0])) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                Path out = target.resolve(entry.getName()).normalize();
                if (!out.startsWith(target)) throw new IOException("Entry escapes target dir: " + entry.getName());
                if (entry.isDirectory()) {
                    Files.createDirectories(out);
                } else {
                    Files.createDirectories(out.getParent());
                    try (InputStream in = zip.getInputStream(entry)) {
                        Files.copy(in, out, StandardCopyOption.REPLACE_EXISTING);
                    }
                }
            }
        }
    }
}
