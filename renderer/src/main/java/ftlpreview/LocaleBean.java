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

import java.text.Bidi;
import java.text.Collator;
import java.util.List;
import java.util.Properties;

/**
 * The {@code locale} attribute of a Page whose realm has internationalization enabled: the current locale's
 * tag, label and direction, and the realm's supported locales, labelled from the {@code locale_<tag>} messages
 * and sorted by label.
 *
 * Copied from Keycloak 26.8.1 (org.keycloak.theme.beans.LocaleBean, Apache-2.0). Changes: the package; the
 * realm's supported locales arrive as a list of tags from the Mock model instead of a RealmModel; each
 * locale links to the current Story with {@code ?locale=<tag>} (the preview's counterpart of Keycloak's
 * kc_locale query parameter) instead of a UriBuilder link; right-to-left is computed without Keycloak's
 * cache; the nested locale class is final with package-private constructors.
 */
public final class LocaleBean {

    private final String current;
    private final String currentLanguageTag;
    private final boolean rtl;
    private final List<Locale> supported;

    LocaleBean(List<String> supportedLocales, java.util.Locale current, String storyUrl, Properties messages) {
        this.currentLanguageTag = current.toLanguageTag();
        this.current = messages.getProperty("locale_" + currentLanguageTag, currentLanguageTag);
        this.rtl = !new Bidi(this.current, Bidi.DIRECTION_DEFAULT_LEFT_TO_RIGHT).isLeftToRight();

        Collator collator = Collator.getInstance(current);
        collator.setStrength(Collator.PRIMARY); // ignore case and accents
        this.supported = supportedLocales.stream()
                .map(l -> new Locale(l, messages.getProperty("locale_" + l, l), storyUrl + "?locale=" + l))
                .sorted((a, b) -> collator.compare(a.label, b.label))
                .toList();
    }

    public String getCurrent() {
        return current;
    }

    public String getCurrentLanguageTag() {
        return currentLanguageTag;
    }

    public boolean isRtl() {
        return rtl;
    }

    public List<Locale> getSupported() {
        return supported;
    }

    public static final class Locale {
        private final String languageTag;
        private final String label;
        private final String url;

        Locale(String languageTag, String label, String url) {
            this.languageTag = languageTag;
            this.label = label;
            this.url = url;
        }

        public String getLanguageTag() {
            return languageTag;
        }

        public String getLabel() {
            return label;
        }

        public String getUrl() {
            return url;
        }
    }
}
