// =====================================================================
// PARTLENS INTERNATIONALIZATION (i18n) ENGINE
// Supports: English (default), German, extensible via JSON files
// =====================================================================

(function initI18nSystem() {
    const SUPPORTED_LANGS = ['en', 'de'];
    const DEFAULT_LANG = 'en';

    let currentLang = DEFAULT_LANG;
    let translations = {};

    // 1. Determine Initial Language
    const saved = localStorage.getItem('partlens_lang');
    if (saved && SUPPORTED_LANGS.includes(saved)) {
        currentLang = saved;
    } else {
        const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
        if (browserLang.startsWith('de')) {
            currentLang = 'de';
        } else {
            currentLang = DEFAULT_LANG;
        }
    }

    // 2. Load Translations for Language
    async function loadTranslations(lang) {
        try {
            const res = await fetch(`/frontend/locales/${lang}.json?v=2.8.5`);
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn(`[PartLens i18n] Could not load /frontend/locales/${lang}.json:`, e);
        }
        return {};
    }

    // 3. Resolve Nested Key with Placeholder Interpolation
    function resolveKey(obj, path) {
        if (!obj || !path) return null;
        const keys = path.split('.');
        let curr = obj;
        for (const k of keys) {
            if (curr && typeof curr === 'object' && k in curr) {
                curr = curr[k];
            } else {
                return null;
            }
        }
        return typeof curr === 'string' ? curr : null;
    }

    // 4. Global Translation Function
    window.t = function(key, params = {}) {
        let val = resolveKey(translations, key);
        if (!val) {
            // Fallback to key itself or last token
            val = key.split('.').pop();
        }
        if (params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
                val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
            }
        }
        return val;
    };

    // 5. Apply Translations to DOM
    window.applyTranslations = function() {
        document.documentElement.setAttribute('lang', currentLang);

        // Update text content
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                const translated = window.t(key);
                if (translated) el.textContent = translated;
            }
        });

        // Update placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                const translated = window.t(key);
                if (translated) el.placeholder = translated;
            }
        });

        // Update title/tooltips
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                const translated = window.t(key);
                if (translated) el.title = translated;
            }
        });

        // Update document title
        if (window.t) {
            document.title = `${window.t('header.title')} – ${window.t('header.subtitle')}`;
        }

        // Re-render dataset badge if stats are cached
        if (typeof window.renderDatasetStatsBadge === 'function') {
            window.renderDatasetStatsBadge();
        }

        // Update language button indicator
        const langIndicator = document.getElementById('lang-indicator');
        if (langIndicator) {
            langIndicator.textContent = currentLang.toUpperCase();
        }

        const langBtn = document.getElementById('lang-toggle-btn');
        if (langBtn) {
            langBtn.title = currentLang === 'de' ? 'Sprache wechseln / Switch to English' : 'Switch Language / Zu Deutsch wechseln';
        }

        // Notify dynamic modules
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: currentLang } }));
    };

    // Dataset Stats Badge Helper
    let lastDatasetStats = null;
    window.formatDatasetBadge = function(train, val, boxes) {
        lastDatasetStats = { train, val, boxes };
        if (window.t) {
            return window.t('header.dataset_badge', { train, val, boxes });
        }
        return `Dataset: ${train} Train • ${val} Val (${boxes} Boxes)`;
    };

    window.renderDatasetStatsBadge = function() {
        const headerText = document.getElementById('header-dataset-text');
        const badge = document.getElementById('dataset-counter-badge');
        if (!lastDatasetStats) {
            const initialText = window.t ? window.t('header.dataset_status', { count: 0 }) : 'Dataset: 0 images';
            if (headerText) headerText.innerText = initialText;
            else if (badge) badge.innerText = initialText;
            return;
        }
        const text = window.formatDatasetBadge(lastDatasetStats.train, lastDatasetStats.val, lastDatasetStats.boxes);
        if (headerText) headerText.innerText = text;
        else if (badge) badge.innerText = text;
    };

    // 6. Switch Language
    window.setLanguage = async function(lang) {
        if (!SUPPORTED_LANGS.includes(lang)) return;
        currentLang = lang;
        localStorage.setItem('partlens_lang', lang);
        translations = await loadTranslations(lang);
        window.applyTranslations();
    };

    window.toggleLanguage = function() {
        const next = currentLang === 'en' ? 'de' : 'en';
        window.setLanguage(next);
    };

    window.getCurrentLanguage = function() {
        return currentLang;
    };

    // 7. Initialize
    async function init() {
        translations = await loadTranslations(currentLang);
        window.applyTranslations();

        const langBtn = document.getElementById('lang-toggle-btn');
        if (langBtn) {
            langBtn.addEventListener('click', window.toggleLanguage);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
