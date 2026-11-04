/*
 * Copyright 2016 Red Hat, Inc. and/or its affiliates
 * and other contributors as indicated by the @author tags.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package ftlpreview;

import java.util.Locale;
import java.util.Objects;
import java.util.Properties;
import java.util.regex.Pattern;

/**
 * Labels for the locales a Theme lists, used by the locale switcher: each locale without a
 * {@code locale_<tag>} message gets one, its name in the current locale followed by its own name unless it is
 * the current locale.
 *
 * Copied from Keycloak 26.8.1 (org.keycloak.theme.DefaultThemeManager: addlocaleTranslations, capitalize,
 * resolveChineseLocale and LATIN_CHARACTERS, Apache-2.0). Changes: the package and a class of its own; the
 * Theme's {@code locales} property is passed in rather than read from the theme; the labels are added once to
 * the messages merged over the locale fallback chain instead of to each locale's bundle before merging; the
 * fallback pattern for JVMs without the Latin script blocks is dropped (Java 21 has them).
 */
final class LocaleTranslations {

    private LocaleTranslations() {
    }

    private static final Pattern LATIN_CHARACTERS = Pattern.compile(
            "(\\p{L1}|\\p{InLATIN_EXTENDED_A}|\\p{InLATIN_EXTENDED_B}|\\p{InLATIN_EXTENDED_C}|\\p{InLATIN_EXTENDED_D}|\\p{InLATIN_EXTENDED_E}).*");

    static void add(Locale locale, String themeLocales, Properties messages) {
        Locale currentLocale = Locale.forLanguageTag(resolveChineseLocale(locale.toLanguageTag()));

        for (String l : themeLocales.split(",")) {
            l = l.trim();
            String key = "locale_" + l;
            String label = messages.getProperty(key);
            if (label != null) {
                continue;
            }
            String rl = resolveChineseLocale(l);
            Locale loc = Locale.forLanguageTag(rl);
            label = capitalize(loc.getDisplayName(locale), locale);
            if (!Objects.equals(loc, currentLocale)) {
                label += " (" + capitalize(loc.getDisplayName(loc), loc) + ")";
            }
            messages.put(key, label);
        }
    }

    private static String capitalize(String name, Locale locale) {
        if (LATIN_CHARACTERS.matcher(name).matches()) {
            return name.substring(0, 1).toUpperCase(locale) + name.substring(1);
        } else {
            return name;
        }
    }

    private static String resolveChineseLocale(String locale) {
        // This is mapping old locale codes to the new locale codes for Simplified and Traditional Chinese.
        if (locale.equals("zh-CN")) {
            return "zh-Hans";
        } else if (locale.equals("zh-TW")) {
            return "zh-Hant";
        }
        return locale;
    }
}
