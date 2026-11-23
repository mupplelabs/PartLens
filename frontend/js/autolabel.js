// =====================================================================
// AUTO-LABELING & DATASET MANAGEMENT (SERVER-SIDE CONFIG SYNC)
// =====================================================================

// =====================================================================
// AUTO-LABELING & DATASET MANAGEMENT (PYDANTIC-AI BACKEND)
// =====================================================================

const autolabelProvider = document.getElementById('autolabel-provider');
const autolabelModelSelect = document.getElementById('autolabel-model-select');
const autolabelModelCustom = document.getElementById('autolabel-model-custom');
const modelCountBadge = document.getElementById('model-count-badge');
const refreshModelsBtn = document.getElementById('refresh-models-btn');
const geminiKeyRow = document.getElementById('gemini-key-row');
const geminiApiKey = document.getElementById('gemini-api-key');
const toggleKeyVisBtn = document.getElementById('toggle-key-vis-btn');
const openaiKeyRow = document.getElementById('openai-key-row');
const openaiApiKey = document.getElementById('openai-api-key');
const toggleOpenaiKeyVisBtn = document.getElementById('toggle-openai-key-vis-btn');
const openaiKeyStatus = document.getElementById('openai-key-status');
const localUrlRow = document.getElementById('local-url-row');
const localUrlLabel = document.getElementById('local-url-label');
const localUrl = document.getElementById('local-url');
const localStatusBadge = document.getElementById('local-status-badge');

// --- LLM & OCR Einstellungs-Persistenz im Browser (localStorage) ---
const LLM_STORAGE_KEYS = {
    PROVIDER: 'ct_llm_provider',
    MODEL: 'ct_llm_model',
    CUSTOM_MODEL: 'ct_llm_custom_model',
    MODEL_GEMINI: 'ct_llm_model_gemini',
    MODEL_OPENAI: 'ct_llm_model_openai',
    MODEL_OLLAMA: 'ct_llm_model_ollama',
    LOCAL_URL: 'ct_local_url',
    OPENAI_URL: 'ct_openai_url',
    OLLAMA_URL: 'ct_ollama_url',
    GEMINI_KEY: 'gemini_api_key',
    OCR_ENGINE: 'ct_ocr_engine',
    CUSTOM_CLASSES: 'ct_custom_classes',
    DETECT_FOOTPRINT: 'ct_autolabel_footprint',
    DETECT_MARKING: 'ct_autolabel_marking',
    DETECT_SUBGROUP: 'ct_autolabel_subgroup'
};

const optFootprint = document.getElementById('autolabel-opt-footprint');
const optMarking = document.getElementById('autolabel-opt-marking');
const optSubgroup = document.getElementById('autolabel-opt-subgroup');
const quickOptFootprint = document.getElementById('quick-opt-footprint');
const quickOptMarking = document.getElementById('quick-opt-marking');
const quickOptSubgroup = document.getElementById('quick-opt-subgroup');
const autolabelOptionsBtn = document.getElementById('autolabel-options-btn');
const autolabelOptionsMenu = document.getElementById('autolabel-options-menu');
const closeAutolabelOptionsBtn = document.getElementById('close-autolabel-options-btn');
const autolabelQuickBadge = document.getElementById('autolabel-quick-badge');
const btnSaveLlmSettings = document.getElementById('btn-save-llm-settings');

function updateAutolabelBadge() {
    const fp = optFootprint ? optFootprint.checked : true;
    const mk = optMarking ? optMarking.checked : true;
    const sg = optSubgroup ? optSubgroup.checked : true;
    const parts = [];
    if (fp) parts.push('Bauform');
    if (mk) parts.push('OCR');
    if (sg) parts.push('IC-Typ');
    if (autolabelQuickBadge) {
        autolabelQuickBadge.innerText = parts.length > 0 ? parts.join('+') : 'Basis';
    }
}

function setAutolabelFeatures(fp, mk, sg, persist = true) {
    if (optFootprint) optFootprint.checked = fp;
    if (quickOptFootprint) quickOptFootprint.checked = fp;
    if (optMarking) optMarking.checked = mk;
    if (quickOptMarking) quickOptMarking.checked = mk;
    if (optSubgroup) optSubgroup.checked = sg;
    if (quickOptSubgroup) quickOptSubgroup.checked = sg;
    updateAutolabelBadge();
    if (persist) {
        localStorage.setItem(LLM_STORAGE_KEYS.DETECT_FOOTPRINT, fp ? '1' : '0');
        localStorage.setItem(LLM_STORAGE_KEYS.DETECT_MARKING, mk ? '1' : '0');
        localStorage.setItem(LLM_STORAGE_KEYS.DETECT_SUBGROUP, sg ? '1' : '0');
    }
}

[
    [optFootprint, quickOptFootprint, 'DETECT_FOOTPRINT'],
    [optMarking, quickOptMarking, 'DETECT_MARKING'],
    [optSubgroup, quickOptSubgroup, 'DETECT_SUBGROUP']
].forEach(([mainEl, quickEl, storageKey]) => {
    if (mainEl) {
        mainEl.addEventListener('change', () => {
            if (quickEl) quickEl.checked = mainEl.checked;
            updateAutolabelBadge();
            localStorage.setItem(LLM_STORAGE_KEYS[storageKey], mainEl.checked ? '1' : '0');
        });
    }
    if (quickEl) {
        quickEl.addEventListener('change', () => {
            if (mainEl) mainEl.checked = quickEl.checked;
            updateAutolabelBadge();
            localStorage.setItem(LLM_STORAGE_KEYS[storageKey], quickEl.checked ? '1' : '0');
        });
    }
});

if (autolabelOptionsBtn && autolabelOptionsMenu) {
    autolabelOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isHidden = autolabelOptionsMenu.style.display === 'none' || !autolabelOptionsMenu.style.display;
        if (isHidden) {
            const rect = autolabelOptionsBtn.getBoundingClientRect();
            const menuWidth = 220;
            let left = rect.left;
            if (left + menuWidth > window.innerWidth - 10) {
                left = Math.max(10, window.innerWidth - menuWidth - 10);
            }
            autolabelOptionsMenu.style.position = 'fixed';
            autolabelOptionsMenu.style.top = `${rect.bottom + 6}px`;
            autolabelOptionsMenu.style.left = `${left}px`;
            autolabelOptionsMenu.style.zIndex = '9999';
            autolabelOptionsMenu.style.display = 'block';
        } else {
            autolabelOptionsMenu.style.display = 'none';
        }
    });
    document.addEventListener('click', (e) => {
        if (autolabelOptionsMenu && autolabelOptionsMenu.style.display === 'block') {
            if (!autolabelOptionsMenu.contains(e.target) && !autolabelOptionsBtn.contains(e.target)) {
                autolabelOptionsMenu.style.display = 'none';
            }
        }
    });
    if (closeAutolabelOptionsBtn) {
        closeAutolabelOptionsBtn.addEventListener('click', () => {
            autolabelOptionsMenu.style.display = 'none';
        });
    }
}

async function saveLlmSettingsToStorage(showFeedback = true) {
    try {
        const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
        const modelName = getAutolabelModelName();

        // Validierung: Keine leeren oder temporären Lade-Platzhalter speichern
        if (!modelName || modelName.startsWith('Lade Modelle') || modelName === '__custom__') {
            const feedbackEl = document.getElementById('llm-save-feedback');
            if (feedbackEl && showFeedback) {
                feedbackEl.innerHTML = `<span style="color: #ef4444; display: inline-flex; align-items: center; gap: 4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    ${window.t ? window.t('settings.select_valid_model') : 'Bitte wähle ein gültiges Modell aus.'}
                </span>`;
            }
            return;
        }

        // Provider-isolierte Speicherung im Browser
        if (autolabelProvider) localStorage.setItem(LLM_STORAGE_KEYS.PROVIDER, prov);
        if (prov === 'gemini') {
            localStorage.setItem(LLM_STORAGE_KEYS.MODEL_GEMINI, modelName);
        } else if (prov === 'ollama') {
            localStorage.setItem(LLM_STORAGE_KEYS.MODEL_OLLAMA, modelName);
        } else {
            localStorage.setItem(LLM_STORAGE_KEYS.MODEL_OPENAI, modelName);
        }
        localStorage.setItem(LLM_STORAGE_KEYS.MODEL, modelName);

        if (localUrl) {
            const urlVal = localUrl.value.trim();
            if (prov === 'ollama') {
                localStorage.setItem(LLM_STORAGE_KEYS.OLLAMA_URL, urlVal);
            } else {
                localStorage.setItem(LLM_STORAGE_KEYS.OPENAI_URL, urlVal);
            }
            localStorage.setItem(LLM_STORAGE_KEYS.LOCAL_URL, urlVal);
        }

        if (autolabelModelCustom) localStorage.setItem(LLM_STORAGE_KEYS.CUSTOM_MODEL, autolabelModelCustom.value.trim());
        if (ocrSelect) localStorage.setItem(LLM_STORAGE_KEYS.OCR_ENGINE, ocrSelect.value);
        if (customClassesInput) localStorage.setItem(LLM_STORAGE_KEYS.CUSTOM_CLASSES, customClassesInput.value.trim());

        // Konfiguration an den Backend-Server übertragen
        const payload = {
            provider: prov,
            model: modelName,
            gemini_model: prov === 'gemini' ? modelName : (localStorage.getItem(LLM_STORAGE_KEYS.MODEL_GEMINI) || 'gemini-2.0-flash'),
            openai_model: (prov === 'openai' || prov === 'lmstudio') ? modelName : (localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OPENAI) || 'qwen2-vl-7b-instruct'),
            ollama_model: prov === 'ollama' ? modelName : (localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OLLAMA) || 'qwen2-vl'),
            custom_url: localUrl ? localUrl.value.trim() : '',
            openai_url: (prov === 'openai' || prov === 'lmstudio') && localUrl ? localUrl.value.trim() : '',
            ollama_url: prov === 'ollama' && localUrl ? localUrl.value.trim() : '',
            custom_model: autolabelModelCustom ? autolabelModelCustom.value.trim() : '',
            options: {
                detect_footprint: optFootprint ? optFootprint.checked : true,
                detect_marking: optMarking ? optMarking.checked : true,
                detect_subgroup: optSubgroup ? optSubgroup.checked : true
            }
        };

        const enteredKey = geminiApiKey ? geminiApiKey.value.trim() : '';
        if (enteredKey && !enteredKey.includes('***') && !enteredKey.includes('Server')) {
            payload.gemini_api_key = enteredKey;
        }

        const enteredOpenaiKey = openaiApiKey ? openaiApiKey.value.trim() : '';
        if (enteredOpenaiKey && !enteredOpenaiKey.includes('***') && !enteredOpenaiKey.includes('Server')) {
            payload.openai_api_key = enteredOpenaiKey;
        }

        try {
            await CTApi.saveLlmSettings(payload);
            const statusSpan = document.getElementById('gemini-key-status');
            if (statusSpan && payload.gemini_api_key) {
                statusSpan.innerText = window.t ? window.t('autolabel.saved_on_server') : '(Auf Server gespeichert)';
                statusSpan.style.color = '#10b981';
            }
            const openaiStatusSpan = document.getElementById('openai-key-status');
            if (openaiStatusSpan && payload.openai_api_key) {
                openaiStatusSpan.innerText = window.t ? window.t('autolabel.saved_on_server') : '(Auf Server gespeichert)';
                openaiStatusSpan.style.color = '#10b981';
            }
        } catch (netErr) {
            console.warn('Konnte Einstellungen nicht auf Server speichern:', netErr);
        }

        updateOcrStatusChip();
        updateLlmStatusChip();

        const feedbackEl = document.getElementById('llm-save-feedback');
        if (feedbackEl && showFeedback) {
            feedbackEl.innerHTML = `<span style="color: #10b981; display: inline-flex; align-items: center; gap: 4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                ${window.t ? window.t('settings.saved_success') : 'Einstellungen gespeichert und aktiviert!'}
            </span>`;
            setTimeout(() => {
                if (feedbackEl) feedbackEl.innerHTML = '';
            }, 3500);
        }

        const headerSummary = document.getElementById('llm-active-summary-text');
        if (headerSummary) {
            headerSummary.innerText = `${prov.toUpperCase()}: ${modelName}`;
        }
    } catch (e) {
        console.warn('Fehler beim Speichern der LLM-Einstellungen:', e);
        const feedbackEl = document.getElementById('llm-save-feedback');
        if (feedbackEl && showFeedback) {
            feedbackEl.innerHTML = `<span style="color: #ef4444;">Fehler beim Speichern: ${e.message}</span>`;
        }
    }
}

function getAutolabelModelName() {
    const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
    const fallbackModel = (prov === 'gemini') ? 'gemini-2.0-flash' : ((prov === 'ollama') ? 'qwen2-vl' : 'qwen2-vl-7b-instruct');
    if (!autolabelModelSelect) return fallbackModel;
    let val = autolabelModelSelect.value;
    if (val === '__custom__') {
        const customVal = autolabelModelCustom ? autolabelModelCustom.value.trim() : '';
        return customVal || fallbackModel;
    }
    if (!val || val.startsWith('Lade Modelle') || val.includes('...')) {
        return fallbackModel;
    }
    return val;
}

// --- Status Pillen Synchronisierung (OCR & LLM) ---
function updateOcrStatusChip() {
    const ocrVal = document.getElementById('chip-ocr-val');
    const ocrChip = document.getElementById('chip-ocr');
    const engine = ocrSelect ? ocrSelect.value : (localStorage.getItem(LLM_STORAGE_KEYS.OCR_ENGINE) || 'tesseract');

    const quickLabel = document.getElementById('ocr-engine-quick-label');
    if (quickLabel) {
        quickLabel.innerText = engine === 'florence2' ? 'Florence-2' : 'Tesseract';
    }

    if (!ocrVal) return;
    if (engine === 'florence2') {
        ocrVal.innerText = 'Florence-2 (VisionLM)';
        if (ocrChip) {
            ocrChip.title = 'Aktive OCR-Engine: onnx-community/Florence-2-base-ft (In-Browser ONNX)\nKlick öffnet Einstellungen';
            ocrChip.classList.remove('warning', 'standby');
        }
    } else {
        ocrVal.innerText = 'Tesseract (WASM)';
        if (ocrChip) {
            ocrChip.title = 'Aktive OCR-Engine: Tesseract.js v5 (Lokale Multi-Pass WASM OCR)\nKlick öffnet Einstellungen';
            ocrChip.classList.remove('warning', 'standby');
        }
    }
}

function updateLlmStatusChip() {
    const llmVal = document.getElementById('chip-llm-val');
    const llmChip = document.getElementById('chip-llm');
    if (!llmVal) return;

    const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
    const rawModel = getAutolabelModelName() || '';

    // Kompakte Modellbezeichnung für die Pille
    let shortModel = rawModel || '';
    if (shortModel.length > 18) {
        const m = shortModel.match(/([a-zA-Z0-9_\-\.]+?)(?:-oQ|-Q\d|-Instruct|-fp|-it|\.gguf)/i);
        if (m && m[1] && m[1].length >= 5) {
            shortModel = m[1];
        } else {
            shortModel = shortModel.substring(0, 16) + '…';
        }
    }

    if (prov === 'gemini') {
        const key = geminiApiKey ? geminiApiKey.value.trim() : '';
        const statusSpan = document.getElementById('gemini-key-status');
        const hasKey = key.length > 5 || (statusSpan && statusSpan.innerText.includes('Server')) || (typeof serverData !== 'undefined' && serverData && serverData.has_gemini_env);
        const displayModel = shortModel.replace(/^gemini-/, '');
        llmVal.innerText = `Gemini (${displayModel})`;
        if (llmChip) {
            llmChip.title = `LLM Provider: Google Gemini\nModell: ${rawModel}\nAPI-Key: ${hasKey ? 'Konfiguriert' : 'Fehlt!'}\n(Klick öffnet Einstellungen)`;
            if (hasKey) {
                llmChip.classList.remove('warning', 'standby');
            } else {
                llmChip.classList.add('warning');
            }
        }
    } else if (prov === 'openai' || prov === 'lmstudio') {
        const url = localUrl ? localUrl.value.trim() : 'http://127.0.0.1:1234/v1';
        let provPrefix = 'OpenAI';
        if (url.includes(':8000') || url.includes('omlx')) provPrefix = 'oMLX';
        else if (url.includes(':1234')) provPrefix = 'LM Studio';
        else if (url.includes(':11434')) provPrefix = 'Ollama';

        llmVal.innerText = `${provPrefix}: ${shortModel}`;
        if (llmChip) {
            const hasKey = (openaiApiKey && openaiApiKey.value.trim().length > 3) || (openaiKeyStatus && openaiKeyStatus.innerText.includes('Server'));
            const keyInfo = hasKey ? '\nAPI-Key: Konfiguriert' : '\nAPI-Key: Optional (keiner gesetzt)';
            llmChip.title = `LLM Provider: OpenAI-kompatibel (${provPrefix})\nModell: ${rawModel}\nEndpunkt: ${url}${keyInfo}\n(Klick öffnet Einstellungen)`;
            const isOffline = localStatusBadge && localStatusBadge.innerText.includes('Offline');
            if (isOffline) {
                llmChip.classList.add('warning');
            } else {
                llmChip.classList.remove('warning', 'standby');
            }
        }
    } else if (prov === 'ollama') {
        const url = localUrl ? localUrl.value.trim() : 'http://127.0.0.1:11434/v1';
        llmVal.innerText = `Ollama: ${shortModel}`;
        if (llmChip) {
            llmChip.title = `LLM Provider: Ollama\nModell: ${rawModel}\nEndpunkt: ${url}\n(Klick öffnet Einstellungen)`;
            const isOffline = localStatusBadge && localStatusBadge.innerText.includes('Offline');
            if (isOffline) {
                llmChip.classList.add('warning');
            } else {
                llmChip.classList.remove('warning', 'standby');
            }
        }
    }
}

const chipLlm = document.getElementById('chip-llm');
if (chipLlm) {
    chipLlm.addEventListener('click', () => {
        const navSettings = document.getElementById('nav-settings-btn');
        if (navSettings) navSettings.click();
    });
}
const chipOcr = document.getElementById('chip-ocr');
if (chipOcr) {
    chipOcr.addEventListener('click', () => {
        const navSettings = document.getElementById('nav-settings-btn');
        if (navSettings) navSettings.click();
    });
}

function updateVisionHintForSelectedModel() {
    const localVisionHint = document.getElementById('local-vision-hint');
    if (!localVisionHint) return;
    const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
    if (prov === 'gemini') {
        localVisionHint.style.display = 'none';
        return;
    }
    localVisionHint.style.display = 'block';
    const currentModel = getAutolabelModelName();
    const isVision = /vl|vision|qwen.*vl|minicpm|llava|pixtral|phi-3.5-vision|omni/i.test(currentModel);
    if (isVision) {
        localVisionHint.style.color = '#10b981';
        localVisionHint.innerHTML = `<strong>Vision-Modell gewählt:</strong> <code>${currentModel}</code> beherrscht Bauteil-Erkennung auf Fotos.`;
    } else {
        localVisionHint.style.color = '#f59e0b';
        localVisionHint.innerHTML = `<strong>Kein Vision-Modell gewählt:</strong> <code>${currentModel}</code> ist ein reines Text-Modell. Für die Erkennung von Bauteilen auf Fotos bitte im Server (oMLX, LM Studio, Ollama) ein multimodales Vision-Modell laden (z.B. <em>Qwen2-VL-7B-Instruct</em>, <em>Qwen3.8-27B</em>, <em>Llama-3.2-Vision</em> oder <em>MiniCPM-V</em>).`;
    }
}

if (autolabelModelSelect) {
    autolabelModelSelect.addEventListener('change', () => {
        if (autolabelModelSelect.value === '__custom__') {
            if (autolabelModelCustom) {
                autolabelModelCustom.style.display = 'block';
                autolabelModelCustom.focus();
            }
        } else {
            if (autolabelModelCustom) autolabelModelCustom.style.display = 'none';
        }
        updateVisionHintForSelectedModel();
        updateLlmStatusChip();
    });
}

if (autolabelModelCustom) {
    autolabelModelCustom.addEventListener('input', () => {
        updateVisionHintForSelectedModel();
        updateLlmStatusChip();
    });
}

if (geminiApiKey) {
    let keyDebounceTimer = null;
    geminiApiKey.addEventListener('input', () => {
        clearTimeout(keyDebounceTimer);
        keyDebounceTimer = setTimeout(() => {
            if (autolabelProvider && autolabelProvider.value === 'gemini' && geminiApiKey.value.trim().length > 10) {
                fetchGeminiModels();
            }
        }, 600);
    });
    geminiApiKey.addEventListener('change', () => {
        if (autolabelProvider && autolabelProvider.value === 'gemini' && geminiApiKey.value.trim().length > 10) {
            fetchGeminiModels();
        }
    });
}

if (localUrl) {
    let localUrlDebounceTimer = null;
    localUrl.addEventListener('input', () => {
        clearTimeout(localUrlDebounceTimer);
        localUrlDebounceTimer = setTimeout(() => {
            const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
            if (prov === 'openai' || prov === 'lmstudio' || prov === 'ollama') {
                fetchLocalModels(prov);
            }
        }, 600);
    });
    localUrl.addEventListener('change', () => {
        const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
        if (prov === 'openai' || prov === 'lmstudio' || prov === 'ollama') {
            fetchLocalModels(prov);
        }
    });
}

if (openaiApiKey) {
    let openaiKeyDebounceTimer = null;
    openaiApiKey.addEventListener('input', () => {
        clearTimeout(openaiKeyDebounceTimer);
        openaiKeyDebounceTimer = setTimeout(() => {
            const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
            if (prov === 'openai' || prov === 'lmstudio') {
                fetchLocalModels(prov);
            }
        }, 600);
    });
    openaiApiKey.addEventListener('change', () => {
        const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
        if (prov === 'openai' || prov === 'lmstudio') {
            fetchLocalModels(prov);
        }
    });
}

if (ocrSelect) {
    ocrSelect.addEventListener('change', () => {
        localStorage.setItem(LLM_STORAGE_KEYS.OCR_ENGINE, ocrSelect.value);
        updateOcrStatusChip();
    });
}

const ocrEngineQuickToggle = document.getElementById('ocr-engine-quick-toggle');
if (ocrEngineQuickToggle) {
    ocrEngineQuickToggle.addEventListener('click', () => {
        if (!ocrSelect) return;
        ocrSelect.value = ocrSelect.value === 'florence2' ? 'tesseract' : 'florence2';
        localStorage.setItem(LLM_STORAGE_KEYS.OCR_ENGINE, ocrSelect.value);
        updateOcrStatusChip();
    });
}

if (customClassesInput) {
    customClassesInput.addEventListener('input', () => {
        localStorage.setItem(LLM_STORAGE_KEYS.CUSTOM_CLASSES, customClassesInput.value.trim());
    });
}

if (btnSaveLlmSettings) {
    btnSaveLlmSettings.addEventListener('click', () => {
        saveLlmSettingsToStorage(true);
    });
}

if (toggleKeyVisBtn && geminiApiKey) {
    toggleKeyVisBtn.addEventListener('click', () => {
        geminiApiKey.type = geminiApiKey.type === 'password' ? 'text' : 'password';
    });
}

if (toggleOpenaiKeyVisBtn && openaiApiKey) {
    toggleOpenaiKeyVisBtn.addEventListener('click', () => {
        openaiApiKey.type = openaiApiKey.type === 'password' ? 'text' : 'password';
    });
}

// =====================================================================
// LLM TOKEN USAGE & STATS
// =====================================================================
let cachedTokenUsageStats = null;

async function loadTokenUsageStats() {
    try {
        const res = await fetch('/api/settings/token-usage');
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.usage) {
                cachedTokenUsageStats = data.usage;
                renderTokenUsageStats(data.usage);
            }
        }
    } catch (e) {
        console.warn('Fehler beim Laden der Token-Statistiken:', e);
    }
}

function renderTokenUsageStats(stats) {
    if (!stats) return;

    const totalEl = document.getElementById('token-stat-total');
    const promptEl = document.getElementById('token-stat-prompt');
    const completionEl = document.getElementById('token-stat-completion');
    const requestsEl = document.getElementById('token-stat-requests');
    const avgEl = document.getElementById('token-stat-avg');
    const updatedEl = document.getElementById('token-stat-last-updated');
    const modelListEl = document.getElementById('token-by-model-list');
    const recentListEl = document.getElementById('token-recent-calls-list');
    const recentContainer = document.getElementById('token-recent-container');

    const total = stats.total_tokens || 0;
    const prompt = stats.prompt_tokens || 0;
    const completion = stats.completion_tokens || 0;
    const requests = stats.total_requests || 0;

    if (totalEl) totalEl.innerText = total.toLocaleString();
    if (promptEl) promptEl.innerText = prompt.toLocaleString();
    if (completionEl) completionEl.innerText = completion.toLocaleString();
    if (requestsEl) requestsEl.innerText = requests.toLocaleString();

    if (avgEl) {
        const avg = requests > 0 ? Math.round(total / requests).toLocaleString() : '0';
        avgEl.innerText = window.t
            ? window.t('settings.token_avg_per_call', { avg })
            : `Ø ${avg} Tokens pro Anfrage`;
    }

    if (updatedEl && stats.last_updated) {
        const d = new Date(stats.last_updated * 1000);
        updatedEl.innerText = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }

    // Breakdown by Model
    if (modelListEl) {
        const byModel = stats.by_model || {};
        const modelKeys = Object.keys(byModel);

        if (modelKeys.length === 0) {
            const emptyMsg = window.t ? window.t('settings.token_no_usage') : 'Noch keine Token-Daten erfasst.';
            modelListEl.innerHTML = `<div style="font-size: 0.75rem; color: var(--muted); font-style: italic;">${emptyMsg}</div>`;
        } else {
            const sortedModels = modelKeys.map(k => ({ id: k, ...byModel[k] })).sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0));
            const maxTokens = Math.max(1, total);

            modelListEl.innerHTML = sortedModels.map(m => {
                const mTotal = m.total_tokens || 0;
                const mPct = Math.round((mTotal / maxTokens) * 100);
                const prov = (m.provider || 'gemini').toUpperCase();
                const reqs = m.requests || 0;
                const reqLabel = window.t ? window.t('settings.token_model_calls') : 'Aufrufe';
                return `
                    <div style="background: var(--surface-hover); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 0.75rem;">
                            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600;">
                                <span class="chip" style="font-size: 0.65rem; padding: 1px 5px; border-radius: 3px; background: rgba(59, 130, 246, 0.15); color: #3b82f6;">${prov}</span>
                                <span style="color: var(--text);">${m.id}</span>
                            </div>
                            <div style="color: var(--muted); font-size: 0.72rem;">
                                ${reqs} ${reqLabel} · <strong style="color: var(--text);">${mTotal.toLocaleString()}</strong> (${mPct}%)
                            </div>
                        </div>
                        <div style="width: 100%; height: 5px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden;">
                            <div style="width: ${mPct}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #a855f7); border-radius: 3px;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // Recent Calls Mini-List
    if (recentListEl && recentContainer) {
        const recent = stats.recent_calls || [];
        if (recent.length === 0) {
            recentContainer.style.display = 'none';
        } else {
            recentContainer.style.display = 'block';
            recentListEl.innerHTML = recent.slice(0, 8).map(c => {
                const timeStr = c.timestamp ? new Date(c.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
                let detailsBadge = '';
                if (c.details && typeof c.details === 'object') {
                    const parts = [];
                    if (c.details.image) {
                        const imgLabel = window.t ? window.t('settings.token_mod_image') : 'Bild';
                        parts.push(`${c.details.image.toLocaleString()} ${imgLabel}`);
                    }
                    if (c.details.text) {
                        const txtLabel = window.t ? window.t('settings.token_mod_text') : 'Text';
                        parts.push(`${c.details.text.toLocaleString()} ${txtLabel}`);
                    }
                    if (c.details.thought) {
                        const thkLabel = window.t ? window.t('settings.token_mod_thought') : 'Thinking';
                        parts.push(`${c.details.thought.toLocaleString()} ${thkLabel}`);
                    }
                    if (c.details.output) {
                        const outLabel = window.t ? window.t('settings.token_mod_output') : 'Antwort';
                        parts.push(`${c.details.output.toLocaleString()} ${outLabel}`);
                    }
                    if (parts.length > 0) {
                        detailsBadge = `
                            <div style="font-size: 0.67rem; color: var(--muted); margin-top: 3px; display: flex; align-items: center; gap: 4px; padding-left: 2px;">
                                <span style="opacity: 0.6;">↳</span> ${parts.join(' · ')}
                            </div>
                        `;
                    }
                }
                return `
                    <div style="display: flex; flex-direction: column; font-size: 0.72rem; padding: 5px 8px; background: var(--surface-hover); border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.04); margin-bottom: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="color: var(--muted); font-feature-settings: 'tnum';">${timeStr}</span>
                                <span style="font-weight: 600; color: var(--text);">${c.model}</span>
                                <span style="color: var(--muted);">(${c.latency_ms} ms)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #38bdf8;">${(c.prompt_tokens || 0).toLocaleString()} in</span>
                                <span style="color: #a855f7;">${(c.completion_tokens || 0).toLocaleString()} out</span>
                                <strong style="color: var(--accent);">${(c.total_tokens || 0).toLocaleString()} tok</strong>
                            </div>
                        </div>
                        ${detailsBadge}
                    </div>
                `;
            }).join('');
        }
    }
}

window.loadTokenUsageStats = loadTokenUsageStats;
window.renderTokenUsageStats = renderTokenUsageStats;

const refreshTokenUsageBtn = document.getElementById('refresh-token-usage-btn');
if (refreshTokenUsageBtn) {
    refreshTokenUsageBtn.addEventListener('click', () => {
        loadTokenUsageStats();
    });
}

const resetTokenUsageBtn = document.getElementById('reset-token-usage-btn');
if (resetTokenUsageBtn) {
    resetTokenUsageBtn.addEventListener('click', async () => {
        const confirmMsg = window.t
            ? window.t('settings.token_btn_reset_confirm')
            : 'Möchtest du die Token-Statistiken wirklich auf 0 zurücksetzen?';
        if (!confirm(confirmMsg)) return;

        try {
            const res = await fetch('/api/settings/token-usage/reset', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.usage) {
                    cachedTokenUsageStats = data.usage;
                    renderTokenUsageStats(data.usage);
                }
            }
        } catch (e) {
            console.error('Fehler beim Zurücksetzen der Token-Statistiken:', e);
        }
    });
}

let _activeGeminiModelsController = null;
async function fetchGeminiModels(preferredModel = null) {
    if (modelCountBadge) modelCountBadge.innerText = 'Lade...';
    if (refreshModelsBtn) refreshModelsBtn.disabled = true;

    if (_activeGeminiModelsController) {
        _activeGeminiModelsController.abort();
    }
    _activeGeminiModelsController = new AbortController();
    const signal = _activeGeminiModelsController.signal;

    try {
        const res = await fetch('/api/gemini-models', { signal });
        if (res.ok) {
            const data = await res.json();
            const modelsList = data.details || data.models || [];
            if (data.success && modelsList.length > 0) {
                if (autolabelModelSelect) {
                    autolabelModelSelect.innerHTML = '';
                    modelsList.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.id || m;
                        const dName = m.display_name || m.id || m;
                        const desc = m.description ? ` (${m.description})` : '';
                        opt.textContent = `${dName}${desc}`;
                        autolabelModelSelect.appendChild(opt);
                    });
                    const customOpt = document.createElement('option');
                    customOpt.value = '__custom__';
                    customOpt.textContent = 'Eigenes Modell eingeben...';
                    autolabelModelSelect.appendChild(customOpt);

                    // Bevorzugtes Modell auswählen (ignoriere ungültige oder experimentelle Altwerte)
                    const target = preferredModel || localStorage.getItem(LLM_STORAGE_KEYS.MODEL_GEMINI) || localStorage.getItem(LLM_STORAGE_KEYS.MODEL);
                    const isTargetValid = target && !target.includes('exp') && !target.startsWith('gemini-3.') && target.startsWith('gemini-');
                    const match = isTargetValid ? modelsList.find(m => (m.id || m) === target) : null;
                    if (match) {
                        autolabelModelSelect.value = match.id || match;
                    } else {
                        // Bevorzuge gemini-2.0-flash oder das erste stabile Flash-Modell
                        const topFlash = modelsList.find(m => (m.id || m) === 'gemini-2.0-flash') ||
                                         modelsList.find(m => (m.id || m).includes('flash') && !(m.id || m).includes('exp')) ||
                                         modelsList[0];
                        if (topFlash) {
                            autolabelModelSelect.value = topFlash.id || topFlash;
                        }
                    }
                    updateVisionHintForSelectedModel();
                }
                if (modelCountBadge) modelCountBadge.innerText = `(${modelsList.length} verfügbar)`;
                return;
            } else if (data.error) {
                console.warn('Gemini models info:', data.error);
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Fehler beim Abrufen der Gemini-Modelle:', err);
    } finally {
        if (_activeGeminiModelsController?.signal === signal) {
            if (refreshModelsBtn) refreshModelsBtn.disabled = false;
            if (modelCountBadge && modelCountBadge.innerText === 'Lade...') {
                modelCountBadge.innerText = '';
            }
        }
    }
}

let _activeLocalModelsController = null;
async function fetchLocalModels(provider, preferredModel = null) {
    if (!provider || provider === 'gemini') return;
    const queryProv = (provider === 'lmstudio' || provider === 'openai') ? 'openai' : 'ollama';
    const targetUrl = localUrl ? localUrl.value.trim() : '';
    if (localStatusBadge) localStatusBadge.innerText = 'Verbindung prüfen...';

    if (_activeLocalModelsController) {
        _activeLocalModelsController.abort();
    }
    _activeLocalModelsController = new AbortController();
    const signal = _activeLocalModelsController.signal;
    
    let models = [];
    let errInfo = '';

    // 1. Backend-Proxy versuchen
    try {
        const proxyUrl = `/api/local-models?provider=${queryProv}&url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl, { signal });
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.models && data.models.length > 0) {
                models = data.models;
            } else if (data.error) {
                errInfo = data.error;
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        errInfo = e.message;
    }

    // 2. Direkter Fallback aus dem Browser falls Backend-Proxy blockiert war
    if (models.length === 0 && targetUrl && !signal.aborted) {
        try {
            const fetchOpts = { signal: AbortSignal.timeout(2500) };
            const oaiKey = (openaiApiKey ? openaiApiKey.value.trim() : '');
            if (oaiKey && !oaiKey.includes('***') && !oaiKey.includes('Server')) {
                fetchOpts.headers = { 'Authorization': `Bearer ${oaiKey}` };
            }
            const directRes = await fetch(`${targetUrl.replace(/\/+$/, '')}/models`, fetchOpts);
            if (directRes.ok) {
                const directData = await directRes.json();
                models = (directData.data || []).map(m => m.id).filter(Boolean);
            }
        } catch (e) {
            // Direkter Zugriff schlug auch fehl
        }
    }

    if (signal.aborted) return;

    const localVisionHint = document.getElementById('local-vision-hint');

    if (models.length > 0) {
        if (autolabelModelSelect) {
            autolabelModelSelect.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                const isVision = /vl|vision|qwen.*vl|minicpm|llava|pixtral|phi-3.5-vision|omni/i.test(m);
                opt.textContent = isVision ? `${m} (Vision)` : m;
                autolabelModelSelect.appendChild(opt);
            });
            const customOpt = document.createElement('option');
            customOpt.value = '__custom__';
            customOpt.textContent = 'Eigenes Modell eingeben...';
            autolabelModelSelect.appendChild(customOpt);

            // Automatische Wahl: preferredModel > gespeichertes Provider-Modell > Vision-Modell > models[0]
            const savedProvModel = queryProv === 'ollama' ? localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OLLAMA) : localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OPENAI);
            const targetToSelect = preferredModel || savedProvModel || localStorage.getItem(LLM_STORAGE_KEYS.MODEL);
            const matchPref = targetToSelect ? models.find(m => m === targetToSelect) : null;
            const visionMatch = models.find(m => /vl|vision|qwen.*vl|minicpm|llava|pixtral|phi-3.5-vision|omni/i.test(m));
            if (matchPref) {
                autolabelModelSelect.value = matchPref;
            } else if (visionMatch) {
                autolabelModelSelect.value = visionMatch;
            } else {
                autolabelModelSelect.value = models[0];
            }
        }
        if (autolabelModelCustom) autolabelModelCustom.style.display = 'none';
        if (modelCountBadge) modelCountBadge.innerText = `(${models.length} verfügbar)`;
        if (localStatusBadge) localStatusBadge.innerText = `Verbunden (${models.length} Modelle)`;
        updateVisionHintForSelectedModel();
    } else {
        if (autolabelModelSelect) {
            const savedProvModel = queryProv === 'ollama' ? localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OLLAMA) : localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OPENAI);
            const defModel = savedProvModel || (queryProv === 'ollama' ? 'qwen2-vl' : 'qwen2-vl-7b-instruct');
            autolabelModelSelect.innerHTML = `
                <option value="${defModel}">${defModel} (Standard)</option>
                <option value="__custom__">Eigenes Modell eingeben...</option>
            `;
            const targetToSelect = preferredModel || savedProvModel || localStorage.getItem(LLM_STORAGE_KEYS.MODEL);
            if (targetToSelect === '__custom__') {
                autolabelModelSelect.value = '__custom__';
                if (autolabelModelCustom) autolabelModelCustom.style.display = 'block';
            } else {
                autolabelModelSelect.value = defModel;
            }
        }
        if (modelCountBadge) modelCountBadge.innerText = '';
        if (localStatusBadge) localStatusBadge.innerText = `Offline / Nicht erreichbar`;
        if (localVisionHint) {
            localVisionHint.style.color = '#f59e0b';
            localVisionHint.innerHTML = `<strong>Server nicht erreichbar:</strong> Stelle sicher, dass der Server auf <code>${targetUrl || 'http://127.0.0.1:8000/v1'}</code> läuft und erreichbar ist.`;
        }
    }
}

function handleProviderChange(isUserSwitch = false) {
    if (!autolabelProvider) return;
    const prov = autolabelProvider.value;
    if (prov === 'gemini') {
        if (geminiKeyRow) geminiKeyRow.style.display = 'block';
        if (localUrlRow) localUrlRow.style.display = 'none';
        if (openaiKeyRow) openaiKeyRow.style.display = 'none';
        if (refreshModelsBtn) {
            refreshModelsBtn.style.display = 'inline-block';
            refreshModelsBtn.title = 'Aktuelle Gemini-Modelle von Google abrufen';
        }
        if (modelCountBadge) modelCountBadge.innerText = '';
        const savedGeminiModel = localStorage.getItem(LLM_STORAGE_KEYS.MODEL_GEMINI) || 'gemini-2.0-flash';
        if (autolabelModelSelect) {
            autolabelModelSelect.innerHTML = `
                <option value="gemini-2.0-flash">2.0 Flash (Standard &amp; Schnell · Empfohlen)</option>
                <option value="gemini-3.8-flash">3.8 Flash (Vielseitige Unterstützung)</option>
                <option value="gemini-3.5-flash-lite">3.5 Flash-Lite (Schnellste Antworten)</option>
                <option value="gemini-3.1-pro">3.1 Pro (Logisches Schlussfolgern)</option>
                <option value="gemini-4-argon">4 Argon (Komplexe Aufgaben)</option>
                <option value="gemini-1.5-pro">1.5 Pro (Hohe Genauigkeit)</option>
                <option value="gemini-1.5-flash">1.5 Flash (Klassisch &amp; Sparsam)</option>
                <option value="__custom__">Eigenes Modell eingeben...</option>
            `;
            const hasOpt = Array.from(autolabelModelSelect.options).some(o => o.value === savedGeminiModel);
            if (!hasOpt && savedGeminiModel && savedGeminiModel.startsWith('gemini-')) {
                const opt = document.createElement('option');
                opt.value = savedGeminiModel;
                opt.textContent = savedGeminiModel;
                autolabelModelSelect.insertBefore(opt, autolabelModelSelect.firstChild);
            }
            autolabelModelSelect.value = savedGeminiModel;
        }
        if (autolabelModelCustom) autolabelModelCustom.style.display = savedGeminiModel === '__custom__' ? 'block' : 'none';
        updateVisionHintForSelectedModel();
        if (isUserSwitch) {
            fetchGeminiModels(savedGeminiModel);
        }
    } else if (prov === 'openai' || prov === 'lmstudio') {
        if (geminiKeyRow) geminiKeyRow.style.display = 'none';
        if (localUrlRow) localUrlRow.style.display = 'block';
        if (openaiKeyRow) openaiKeyRow.style.display = 'block';
        if (refreshModelsBtn) {
            refreshModelsBtn.style.display = 'inline-block';
            refreshModelsBtn.title = 'Modelle von OpenAI / oMLX / LM Studio abrufen';
        }
        if (localUrlLabel) localUrlLabel.innerText = 'OpenAI / oMLX Endpoint URL:';
        
        // URL aus lokalem Speicher für OpenAI laden falls vorhanden oder Fallback beibehalten
        const savedUrl = localStorage.getItem(LLM_STORAGE_KEYS.OPENAI_URL) || localStorage.getItem(LLM_STORAGE_KEYS.LOCAL_URL);
        if (savedUrl && localUrl) {
            localUrl.value = savedUrl;
        } else if (localUrl && !localUrl.value) {
            localUrl.value = 'http://127.0.0.1:1234/v1';
        }
        const savedOpenaiModel = localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OPENAI) || 'qwen2-vl-7b-instruct';
        if (autolabelModelSelect) {
            autolabelModelSelect.innerHTML = `<option value="${savedOpenaiModel}">${savedOpenaiModel}</option><option value="">Lade Modelle...</option>`;
            autolabelModelSelect.value = savedOpenaiModel;
        }
        if (autolabelModelCustom) autolabelModelCustom.style.display = savedOpenaiModel === '__custom__' ? 'block' : 'none';
        updateVisionHintForSelectedModel();
        if (isUserSwitch) {
            fetchLocalModels(prov, savedOpenaiModel);
        }
    } else if (prov === 'ollama') {
        if (geminiKeyRow) geminiKeyRow.style.display = 'none';
        if (localUrlRow) localUrlRow.style.display = 'block';
        if (openaiKeyRow) openaiKeyRow.style.display = 'none';
        if (refreshModelsBtn) {
            refreshModelsBtn.style.display = 'inline-block';
            refreshModelsBtn.title = 'Lokale Modelle aus Ollama abrufen';
        }
        if (localUrlLabel) localUrlLabel.innerText = 'Ollama Endpoint URL:';
        
        const savedUrl = localStorage.getItem(LLM_STORAGE_KEYS.OLLAMA_URL);
        if (savedUrl && localUrl) {
            localUrl.value = savedUrl;
        } else if (localUrl && (!localUrl.value || localUrl.value.includes(':8000') || localUrl.value.includes(':1234'))) {
            localUrl.value = 'http://127.0.0.1:11434/v1';
        }
        const savedOllamaModel = localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OLLAMA) || 'qwen2-vl';
        if (autolabelModelSelect) {
            autolabelModelSelect.innerHTML = `<option value="${savedOllamaModel}">${savedOllamaModel}</option><option value="">Lade Modelle aus Ollama...</option>`;
            autolabelModelSelect.value = savedOllamaModel;
        }
        if (autolabelModelCustom) autolabelModelCustom.style.display = savedOllamaModel === '__custom__' ? 'block' : 'none';
        updateVisionHintForSelectedModel();
        if (isUserSwitch) {
            fetchLocalModels('ollama', savedOllamaModel);
        }
    }
}

if (autolabelProvider) {
    autolabelProvider.addEventListener('change', () => {
        handleProviderChange(true);
        updateLlmStatusChip();
    });
}

function loadLlmSettingsFromStorage() {
    try {
        // API-Keys gehoeren sicher auf den Server: veraltete Client-Keys im localStorage bereinigen
        localStorage.removeItem(LLM_STORAGE_KEYS.GEMINI_KEY);
        localStorage.removeItem('gemini_api_key');
        localStorage.removeItem('openai_api_key');
        if (geminiApiKey) geminiApiKey.value = '';

        const savedOcr = localStorage.getItem(LLM_STORAGE_KEYS.OCR_ENGINE);
        if (savedOcr && ocrSelect) ocrSelect.value = savedOcr;

        const savedCustomClasses = localStorage.getItem(LLM_STORAGE_KEYS.CUSTOM_CLASSES);
        if (savedCustomClasses !== null && customClassesInput) customClassesInput.value = savedCustomClasses;

        let savedProvider = localStorage.getItem(LLM_STORAGE_KEYS.PROVIDER) || 'gemini';
        if (savedProvider === 'lmstudio') savedProvider = 'openai';

        let savedLocalUrl = '';
        if (savedProvider === 'ollama') {
            savedLocalUrl = localStorage.getItem(LLM_STORAGE_KEYS.OLLAMA_URL) || localStorage.getItem(LLM_STORAGE_KEYS.LOCAL_URL) || 'http://127.0.0.1:11434/v1';
        } else {
            savedLocalUrl = localStorage.getItem(LLM_STORAGE_KEYS.OPENAI_URL) || localStorage.getItem(LLM_STORAGE_KEYS.LOCAL_URL) || 'http://127.0.0.1:1234/v1';
        }

        const savedGeminiModel = localStorage.getItem(LLM_STORAGE_KEYS.MODEL_GEMINI);
        const savedOpenaiModel = localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OPENAI);
        const savedOllamaModel = localStorage.getItem(LLM_STORAGE_KEYS.MODEL_OLLAMA);
        const savedCustomModel = localStorage.getItem(LLM_STORAGE_KEYS.CUSTOM_MODEL);

        if (savedLocalUrl && localUrl) {
            localUrl.value = savedLocalUrl;
        }

        if (savedCustomModel && autolabelModelCustom) {
            autolabelModelCustom.value = savedCustomModel;
        }

        if (savedProvider && autolabelProvider) {
            autolabelProvider.value = savedProvider;
            handleProviderChange(false);
        }

        let targetModel = '';
        if (savedProvider === 'gemini') {
            targetModel = savedGeminiModel || localStorage.getItem(LLM_STORAGE_KEYS.MODEL) || 'gemini-2.0-flash';
        } else if (savedProvider === 'ollama') {
            targetModel = savedOllamaModel || localStorage.getItem(LLM_STORAGE_KEYS.MODEL) || 'qwen2-vl';
        } else {
            targetModel = savedOpenaiModel || localStorage.getItem(LLM_STORAGE_KEYS.MODEL) || 'qwen2-vl-7b-instruct';
        }

        if (targetModel && autolabelModelSelect) {
            const exists = Array.from(autolabelModelSelect.options).some(o => o.value === targetModel);
            if (!exists && targetModel !== '__custom__') {
                const opt = document.createElement('option');
                opt.value = targetModel;
                opt.textContent = targetModel;
                autolabelModelSelect.insertBefore(opt, autolabelModelSelect.firstChild);
            }
            autolabelModelSelect.value = targetModel;
            if (targetModel === '__custom__' && autolabelModelCustom) {
                autolabelModelCustom.style.display = 'block';
            }
            updateVisionHintForSelectedModel();
        }

        // Einziger kontrollierter Start-Abruf der Modelle basierend auf dem geladenen Provider
        const activeProv = autolabelProvider ? autolabelProvider.value : 'gemini';
        if (activeProv === 'gemini') {
            fetchGeminiModels(targetModel);
        } else if (activeProv === 'openai' || activeProv === 'lmstudio' || activeProv === 'ollama') {
            fetchLocalModels(activeProv, targetModel);
        }

        const savedFp = localStorage.getItem(LLM_STORAGE_KEYS.DETECT_FOOTPRINT);
        const savedMk = localStorage.getItem(LLM_STORAGE_KEYS.DETECT_MARKING);
        const savedSg = localStorage.getItem(LLM_STORAGE_KEYS.DETECT_SUBGROUP);
        const fpVal = savedFp !== null ? savedFp === '1' : true;
        const mkVal = savedMk !== null ? savedMk === '1' : true;
        const sgVal = savedSg !== null ? savedSg === '1' : true;
        setAutolabelFeatures(fpVal, mkVal, sgVal, false);
        updateOcrStatusChip();
        updateLlmStatusChip();
    } catch (e) {
        console.warn('Fehler beim Laden aus localStorage:', e);
    }
}
loadLlmSettingsFromStorage();

if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', () => {
        const prov = autolabelProvider ? autolabelProvider.value : 'gemini';
        if (prov === 'gemini') {
            fetchGeminiModels();
        } else {
            fetchLocalModels(prov);
        }
    });
}


function populateClassDropdown(classes) {
    if (!boxClassSelect) return;
    const currentVal = boxClassSelect.value;
    boxClassSelect.innerHTML = '';
    classes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        if (window.t) {
            const loc = window.t('classes.' + c);
            if (loc && loc !== c && !loc.startsWith('classes.')) {
                opt.textContent = `${loc} (${c})`;
            } else {
                opt.textContent = c;
            }
        } else {
            opt.textContent = c;
        }
        boxClassSelect.appendChild(opt);
    });
    if (currentVal) {
        boxClassSelect.value = currentVal;
    }
}
populateClassDropdown(knownDatasetClasses);

let currentSplitRecommendation = null;

function renderSplitRecommendation() {
    const hintEl = document.getElementById('split-recommendation-hint');
    const textEl = document.getElementById('split-recommendation-text');
    if (!hintEl || !textEl || !currentSplitRecommendation) return;

    const { targetSplit, code, params, rawReason } = currentSplitRecommendation;
    const splitUpper = (targetSplit || 'train').toUpperCase();

    let localizedReason = '';
    if (code) {
        if (code === 'val_underrepresented_general') {
            localizedReason = window.t ? window.t('curation.split_reason_val_general', params || {}) : `Validation-Split allgemein unterrepräsentiert (${params?.ratio || 0}%)`;
        } else if (code === 'val_underrepresented_class') {
            localizedReason = window.t ? window.t('curation.split_reason_val_class', params || {}) : `Klasse '${params?.class || ''}' in Val unterrepräsentiert (${params?.ratio || 0}%)`;
        } else if (code === 'leakage_protection') {
            localizedReason = window.t ? window.t('curation.split_reason_leakage', params || {}) : `Part-Marking '${params?.marking || ''}' existiert bereits in ${params?.split || ''} (Leakage-Schutz)`;
        } else if (code === 'standard_allocation') {
            localizedReason = window.t ? window.t('curation.split_reason_standard') : 'Standard 80:20 Train-Allokation';
        }
    }

    if (!localizedReason && rawReason) {
        const generalMatch = rawReason.match(/Validation-Split\s+allgemein\s+unterrepräsentiert\s*\(([^)]+)\)/i);
        const classMatch = rawReason.match(/Klasse\s+'([^']+)'\s+in\s+Val\s+unterrepräsentiert\s*\(([^)]+)\)/i);
        const leakageMatch = rawReason.match(/Part-Marking\s+'([^']+)'\s+existiert\s+bereits\s+in\s+(\w+)/i);
        const standardMatch = rawReason.match(/Standard\s+80:20/i);

        if (generalMatch) {
            localizedReason = window.t ? window.t('curation.split_reason_val_general', { ratio: generalMatch[1].replace('%', '') }) : rawReason;
        } else if (classMatch) {
            localizedReason = window.t ? window.t('curation.split_reason_val_class', { class: classMatch[1], ratio: classMatch[2].replace('%', '') }) : rawReason;
        } else if (leakageMatch) {
            localizedReason = window.t ? window.t('curation.split_reason_leakage', { marking: leakageMatch[1], split: leakageMatch[2] }) : rawReason;
        } else if (standardMatch) {
            localizedReason = window.t ? window.t('curation.split_reason_standard') : rawReason;
        } else {
            localizedReason = rawReason;
        }
    }

    if (!localizedReason) {
        localizedReason = targetSplit === 'val'
            ? (window.t ? window.t('curation.split_reason_val_balancing') : '20% Val-Balancing')
            : (window.t ? window.t('curation.split_reason_standard') : 'Train Split');
    }

    const fullText = window.t
        ? window.t('curation.recommendation_prefix', { split: splitUpper, reason: localizedReason })
        : `Empfehlung: ${splitUpper} (${localizedReason})`;

    textEl.innerText = fullText;
    hintEl.style.display = 'block';
}
window.renderSplitRecommendation = renderSplitRecommendation;

const splitHintEl = document.getElementById('split-recommendation-hint');
if (splitHintEl) {
    splitHintEl.addEventListener('click', () => {
        if (!currentSplitRecommendation) return;
        const targetSplit = currentSplitRecommendation.targetSplit;
        if (typeof datasetSplit !== 'undefined' && datasetSplit) datasetSplit.value = targetSplit;
        if (typeof splitPillBtns !== 'undefined' && splitPillBtns) {
            splitPillBtns.forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-split') === targetSplit);
            });
        }
    });
}

window.addEventListener('languageChanged', () => {
    populateClassDropdown(knownDatasetClasses);
    if (currentSplitRecommendation) {
        renderSplitRecommendation();
    }
    if (cachedTokenUsageStats) {
        renderTokenUsageStats(cachedTokenUsageStats);
    }
});

const boxIcTypeSelect = document.getElementById('box-ic-type-select');
const boxFootprintInput = document.getElementById('box-footprint-input');
const icSubgroupWrap = document.getElementById('ic-subgroup-wrap');

window.updateBoxEditBar = function() {
    if (!boxEditBar) return;
    if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
        const b = detectedBoxes[selectedBoxIndex];
        boxEditBar.style.display = 'flex';
        selectedBoxTag.innerText = `#${selectedBoxIndex + 1}`;
        
        // Passende Klasse im Dropdown wählen
        const cleanLabel = (b.label || 'other').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        let foundMatch = knownDatasetClasses.find(k => cleanLabel === k || cleanLabel.includes(k) || k.includes(cleanLabel));
        if (!foundMatch) {
            if (cleanLabel.includes('resistor') || cleanLabel.includes('widerstand')) foundMatch = 'resistor';
            else if (cleanLabel.includes('capacitor') || cleanLabel.includes('kondensator') || cleanLabel.includes('elko')) foundMatch = 'capacitor';
            else if (cleanLabel.includes('inductor') || cleanLabel.includes('spule') || cleanLabel.includes('drossel')) foundMatch = 'inductor';
            else if (cleanLabel.includes('led')) foundMatch = 'led';
            else if (cleanLabel.includes('diode')) foundMatch = 'diode';
            else if (cleanLabel.includes('transistor') || cleanLabel.includes('mosfet') || cleanLabel.includes('bjt')) foundMatch = 'transistor';
            else if (cleanLabel.includes('ic') || cleanLabel.includes('dip') || cleanLabel.includes('chip') || cleanLabel.includes('processor')) foundMatch = 'ic';
            else if (cleanLabel.includes('potentiometer') || cleanLabel.includes('poti') || cleanLabel.includes('trimmer')) foundMatch = 'potentiometer';
            else if (cleanLabel.includes('switch') || cleanLabel.includes('button') || cleanLabel.includes('taster')) foundMatch = 'switch_button';
            else if (cleanLabel.includes('relay') || cleanLabel.includes('relais')) foundMatch = 'relay';
            else if (cleanLabel.includes('connector') || cleanLabel.includes('header') || cleanLabel.includes('pin')) foundMatch = 'connector';
            else if (cleanLabel.includes('display') || cleanLabel.includes('oled') || cleanLabel.includes('lcd')) foundMatch = 'display';
            else if (cleanLabel.includes('board') || cleanLabel.includes('arduino') || cleanLabel.includes('esp32')) foundMatch = 'board';
            else foundMatch = 'other';
        }
        boxClassSelect.value = foundMatch;

        // IC-Subgruppen Anzeige & Wert
        if (icSubgroupWrap) {
            icSubgroupWrap.style.display = (foundMatch === 'ic') ? 'block' : 'none';
        }
        if (boxIcTypeSelect) {
            boxIcTypeSelect.value = b.icSubgroup || '';
        }

        // Footprint Wert & visuelle Vorschau
        if (boxFootprintInput) {
            boxFootprintInput.value = b.footprint || '';
            if (typeof updateBoxFootprintPreview === 'function') {
                updateBoxFootprintPreview(b.footprint || '', b.footprintPath || null);
            }
        }

        // Part Marking (OCR) Wert & Bauteil-Datenblatt-Chips
        const partMarkingInput = document.getElementById('part-marking-input');
        if (partMarkingInput) {
            partMarkingInput.value = b.partMarking || '';
        }
        if (b.partMarking && typeof extractPartNumbersAndRenderLinks === 'function') {
            extractPartNumbersAndRenderLinks(b.partMarking);
        } else if (!b.partMarking && typeof partChips !== 'undefined' && partChips) {
            partChips.innerHTML = '';
        }

        // Kontext-sensitive Widerstands-Smart-Card im Inspector
        const resistorSmartCard = document.getElementById('resistor-smart-card');
        if (resistorSmartCard) {
            const isResistor = (foundMatch === 'resistor' || cleanLabel.includes('resistor') || cleanLabel.includes('widerstand'));
            resistorSmartCard.style.display = isResistor ? 'block' : 'none';
            if (isResistor && typeof scanResistorBandsFromImage === 'function') {
                scanResistorBandsFromImage();
            }
        }
    } else {
        boxEditBar.style.display = 'none';
        const resistorSmartCard = document.getElementById('resistor-smart-card');
        if (resistorSmartCard) resistorSmartCard.style.display = 'none';
    }
};

const applyOhmMarkingBtn = document.getElementById('apply-ohm-marking-btn');
if (applyOhmMarkingBtn) {
    applyOhmMarkingBtn.addEventListener('click', () => {
        const ohmDisplayEl = document.getElementById('ohm-display');
        const partMarkingInp = document.getElementById('part-marking-input');
        if (ohmDisplayEl && partMarkingInp) {
            const fullText = ohmDisplayEl.innerText.trim();
            const cleanVal = fullText.split('±')[0].trim();
            partMarkingInp.value = cleanVal;
            if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
                detectedBoxes[selectedBoxIndex].partMarking = cleanVal;
                drawBboxOverlay();
                renderStage0Chips();
                updateStage0CropPreview();
            }
        }
    });
}

if (boxClassSelect) {
    boxClassSelect.addEventListener('change', () => {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            const newClass = boxClassSelect.value;
            detectedBoxes[selectedBoxIndex].label = newClass;
            detectedBoxes[selectedBoxIndex].kind = (newClass === 'ic' || newClass === 'transistor' || newClass === 'diode' || newClass === 'led') ? 'semiconductor' : (newClass === 'resistor' ? 'resistor' : 'other');
            if (icSubgroupWrap) {
                icSubgroupWrap.style.display = (newClass === 'ic') ? 'block' : 'none';
            }
            const isResistor = (newClass === 'resistor');
            const resistorSmartCard = document.getElementById('resistor-smart-card');
            if (resistorSmartCard) {
                resistorSmartCard.style.display = isResistor ? 'block' : 'none';
                if (isResistor && typeof scanResistorBandsFromImage === 'function') {
                    scanResistorBandsFromImage();
                }
            }
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            if (typeof updateQuickPaletteActiveState === 'function') updateQuickPaletteActiveState();
            updateStage0CropPreview();
            if (boxFootprintInput && boxFootprintInput.value && typeof updateBoxFootprintPreview === 'function') {
                updateBoxFootprintPreview(boxFootprintInput.value);
            }
        }
    });
}

if (boxIcTypeSelect) {
    boxIcTypeSelect.addEventListener('change', () => {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            detectedBoxes[selectedBoxIndex].icSubgroup = boxIcTypeSelect.value || null;
        }
    });
}

if (boxFootprintInput) {
    boxFootprintInput.addEventListener('input', () => {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            const fpVal = boxFootprintInput.value.trim();
            detectedBoxes[selectedBoxIndex].footprint = fpVal || null;
            detectedBoxes[selectedBoxIndex].footprintPath = null;
            if (typeof updateBoxFootprintPreview === 'function') {
                updateBoxFootprintPreview(fpVal);
            }
        }
    });

    // Automatische Übernahme der Katalog-Schreibweise bei Verlassen / Enter / Change
    const canonicalizeBoxFootprintInput = async () => {
        if (selectedBoxIndex < 0 || selectedBoxIndex >= detectedBoxes.length) return;
        const b = detectedBoxes[selectedBoxIndex];
        const rawVal = boxFootprintInput.value.trim();
        if (!rawVal) return;

        const normClass = (typeof getNormalizedClass === 'function')
            ? getNormalizedClass(b.label || (boxClassSelect ? boxClassSelect.value : 'ic'))
            : 'ic';

        let fp = (typeof footprintIndexByName !== 'undefined')
            ? (footprintIndexByName.get(`${normClass}:${rawVal.toLowerCase()}`) || footprintIndexByName.get(rawVal.toLowerCase()))
            : null;

        if (!fp && typeof fetchFootprintsCatalog === 'function') {
            const results = await fetchFootprintsCatalog(normClass, rawVal);
            if (results && results.length > 0) {
                fp = results.find(f => f.name.toLowerCase() === rawVal.toLowerCase() || (f.aliases && f.aliases.includes(rawVal.toLowerCase().replace(/[^a-z0-9]/g, ''))))
                     || results[0];
            }
        }

        if (fp && fp.name) {
            boxFootprintInput.value = fp.name;
            b.footprint = fp.name;
            b.footprintPath = fp.path || b.footprintPath;
            if (typeof updateBoxFootprintPreview === 'function') {
                updateBoxFootprintPreview(fp.name, fp.path);
            }
        }
    };

    boxFootprintInput.addEventListener('change', canonicalizeBoxFootprintInput);
    boxFootprintInput.addEventListener('blur', canonicalizeBoxFootprintInput);
    boxFootprintInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            canonicalizeBoxFootprintInput();
            boxFootprintInput.blur();
        }
    });
}

const clearFpBtn = document.getElementById('clear-footprint-btn');
if (clearFpBtn) {
    clearFpBtn.addEventListener('click', () => {
        if (boxFootprintInput) boxFootprintInput.value = '';
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            detectedBoxes[selectedBoxIndex].footprint = null;
            detectedBoxes[selectedBoxIndex].footprintPath = null;
        }
        if (typeof updateBoxFootprintPreview === 'function') {
            updateBoxFootprintPreview('');
        }
    });
}

if (deleteBoxBtn) {
    deleteBoxBtn.addEventListener('click', () => {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            if (typeof pushBoxHistorySnapshot === 'function') {
                pushBoxHistorySnapshot('Box #' + (selectedBoxIndex + 1) + ' gelöscht');
            }
            detectedBoxes.splice(selectedBoxIndex, 1);
            selectedBoxIndex = detectedBoxes.length > 0 ? Math.min(selectedBoxIndex, detectedBoxes.length - 1) : -1;
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            if (typeof closeQuickTagPopover === 'function') closeQuickTagPopover();
            updateStage0CropPreview();
            updateBoxEditBar();
            if (typeof showUndoToast === 'function') {
                showUndoToast('Box gelöscht');
            }
        }
    });
}

// Tastaturkürzel: Escape (bricht KI/OCR ab) / Entf (löscht Box) / V (Select) / R (Box zeichnen)
window.addEventListener('keydown', (e) => {
    const isTyping = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (isTyping) return;

    if (e.key === 'Escape') {
        if (autoLabelAbortController) abortAutoLabel();
        if (ocrAbortController) abortOcrRecognition();
        if (isDrawingManualBox) {
            setCanvasToolMode('select');
            e.preventDefault();
        }
        if (typeof closeQuickTagPopover === 'function') closeQuickTagPopover();
        return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBoxIndex >= 0) {
        e.preventDefault();
        deleteBoxBtn?.click();
        return;
    }

    const k = (e.key || '').toLowerCase();
    if ((k === 'v' || e.code === 'KeyV') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setCanvasToolMode('select');
        return;
    }

    if ((k === 'r' || e.code === 'KeyR') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setCanvasToolMode(isDrawingManualBox ? 'select' : 'box');
        return;
    }
});

// Modus-Umschaltung: Select (V) vs. Box zeichnen (R) (Zwei-Zustands-Werkzeug wie in CVAT / Photoshop)
function setCanvasToolMode(mode) {
    isDrawingManualBox = (mode === 'box');

    // 1. Tool-Buttons Toggle-Zustand (beide behalten ihre Beschriftung, kein störendes 'Abbrechen')
    if (modeSelectBtn) {
        modeSelectBtn.classList.toggle('active', mode === 'select');
    }
    if (addManualBoxBtn) {
        addManualBoxBtn.classList.toggle('active', mode === 'box');
        addManualBoxBtn.style.background = '';
        addManualBoxBtn.innerHTML = '<svg class="tool-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/></svg>';
    }
    if (mobileAddBoxBtn) {
        mobileAddBoxBtn.classList.toggle('active', mode === 'box');
        const boxSpan = mobileAddBoxBtn.querySelector('span');
        if (boxSpan) boxSpan.innerText = (mode === 'box') ? 'Fertig' : 'Box';
    }

    // 2. Canvas-Cursor anpassen
    if (bboxOverlayCanvas) bboxOverlayCanvas.style.cursor = (mode === 'box') ? 'crosshair' : 'default';
    if (webcamBboxCanvas) webcamBboxCanvas.style.cursor = (mode === 'box') ? 'crosshair' : 'default';

    // 3. Wenn in Box-Modus gewechselt wird: Vorhandene Box-Auswahl aufheben, damit Anfasser nicht stören
    if (mode === 'box') {
        if (typeof closeQuickTagPopover === 'function') closeQuickTagPopover();
        if (selectedBoxIndex !== -1) {
            selectedBoxIndex = -1;
            drawBboxOverlay();
            renderStage0Chips();
            updateStage0CropPreview();
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
        }
    } else {
        drawBboxOverlay();
    }

    // 4. Statuszeile
    if (typeof updateStudioStatus === 'function') {
        updateStudioStatus(
            (mode === 'box')
                ? 'Modus: Box zeichnen (R) aktiv – Klicke und ziehe im Bild, um ein neues Bauteil einzurahmen. (Taste V oder Esc für Auswahl)'
                : 'Modus: Select (V) aktiv – Klicke auf ein Bauteil zum Auswählen, Verschieben oder Skalieren.',
            'ready'
        );
    }
}
window.setCanvasToolMode = setCanvasToolMode;

if (modeSelectBtn) {
    modeSelectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setCanvasToolMode('select');
    });
}
if (addManualBoxBtn) {
    addManualBoxBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setCanvasToolMode(isDrawingManualBox ? 'select' : 'box');
    });
}

function captureCurrentImageBase64() {
    const { el: sourceEl, w: srcW, h: srcH, ready } = getActiveMediaSource();
    if (!ready || !srcW || !srcH) return null;
    const c = document.createElement('canvas');
    c.width = srcW;
    c.height = srcH;
    const cx = c.getContext('2d');
    cx.drawImage(sourceEl, 0, 0, srcW, srcH);
    return c.toDataURL('image/jpeg', 0.95);
}

async function fetchDatasetStatus() {
    try {
        const res = await fetch('/api/status');
        if (res.ok) {
            const data = await res.json();
            if (data.classes) {
                knownDatasetClasses = data.classes;
                populateClassDropdown(knownDatasetClasses);
            }
            if (data.stats && datasetCounterBadge) {
                datasetCounterBadge.innerText = typeof window.formatDatasetBadge === 'function'
                    ? window.formatDatasetBadge(data.stats.train_images, data.stats.val_images, data.stats.total_annotations)
                    : `Datensatz: ${data.stats.train_images} Train • ${data.stats.val_images} Val (${data.stats.total_annotations} Boxen)`;
            }
            if (typeof setBackendStatus === 'function') {
                setBackendStatus(true);
            } else {
                const backendVal = document.getElementById('chip-backend-val');
                const backendChip = document.getElementById('chip-backend');
                if (backendVal) backendVal.innerText = 'Online';
                if (backendChip) backendChip.classList.remove('warning');
            }

            updateOcrStatusChip();
            updateLlmStatusChip();
            return data;
        }
    } catch (err) {
        console.warn('Backend status noch nicht erreichbar:', err);
        if (typeof setBackendStatus === 'function') {
            setBackendStatus(false);
        } else {
            const backendVal = document.getElementById('chip-backend-val');
            const backendChip = document.getElementById('chip-backend');
            if (backendVal) backendVal.innerText = 'Offline';
            if (backendChip) backendChip.classList.add('warning');
        }
    }
    return null;
}

let autoLabelAbortController = null;
let autoLabelTimerInterval = null;
let autoLabelStartTime = 0;

function showAutoLabelLoading(modelName, provider) {
    const mobileBtn = document.getElementById('mobile-autolabel-btn');
    const provName = provider === 'gemini' ? 'Google Gemini' : (provider === 'lmstudio' ? 'LM Studio / oMLX' : 'Ollama');

    // Buttons in Ladezustand versetzen
    const stopAutolabelBtn = document.getElementById('stop-autolabel-btn');
    if (stopAutolabelBtn) stopAutolabelBtn.style.display = 'inline-flex';
    if (runAutolabelBtn) runAutolabelBtn.style.display = 'none';

    if (mobileBtn) {
        mobileBtn.classList.remove('loading');
        mobileBtn.classList.add('dock-btn-danger');
        mobileBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>Stopp</span>';
        mobileBtn.disabled = false;
    }

    // Bild & Canvas sanft unscharf schalten
    const stageWrap = document.querySelector('.image-stage-wrap');
    if (stageWrap) stageWrap.classList.add('is-inferring');

    // Dynamic Island Status-Pille einblenden
    const pill = document.getElementById('autolabel-status-pill');
    const pillTimer = document.getElementById('autolabel-pill-timer');
    const pillBar = document.getElementById('autolabel-pill-progress-bar');
    const pillModel = document.getElementById('autolabel-pill-model');
    const pillLabel = document.getElementById('autolabel-pill-label');
    if (pill) pill.style.display = 'flex';
    if (pillTimer) pillTimer.innerText = '00:00.0';
    if (pillBar) pillBar.style.width = '12%';
    if (pillModel) pillModel.innerText = modelName;
    if (pillLabel) pillLabel.innerText = window.t ? window.t('canvas.ai_analyzing_short') : 'AI analyzing';

    autoLabelStartTime = performance.now();
    clearInterval(autoLabelTimerInterval);

    const isMobile = window.innerWidth <= 768;
    const aiAnalyzingBase = window.t ? window.t('canvas.ai_analyzing') : 'KI analysiert Bauteile';
    const initialStatusText = isMobile ? `${aiAnalyzingBase}...` : `${aiAnalyzingBase} (${modelName})...`;
    if (typeof updateStudioStatus === 'function') {
        updateStudioStatus(initialStatusText, 'active');
    } else if (statusDiv) {
        statusDiv.innerText = initialStatusText;
    }

    autoLabelTimerInterval = setInterval(() => {
        const elapsed = (performance.now() - autoLabelStartTime) / 1000;
        const mins = Math.floor(elapsed / 60);
        const secs = (elapsed % 60).toFixed(1);
        const timeStr = `${mins.toString().padStart(2, '0')}:${secs.padStart(4, '0')}`;

        if (pillTimer) pillTimer.innerText = timeStr;
        if (pillBar) {
            const pct = elapsed < 2.0 ? Math.min(65, 12 + elapsed * 26) : Math.min(94, 65 + (elapsed - 2.0) * 3);
            pillBar.style.width = `${pct}%`;
        }

        const tickStatusText = isMobile ? `${aiAnalyzingBase} (${timeStr})...` : `${aiAnalyzingBase} (${modelName} · ${timeStr})...`;
        if (typeof updateStudioStatus === 'function') {
            updateStudioStatus(tickStatusText, 'active');
        } else if (statusDiv) {
            statusDiv.innerText = tickStatusText;
        }
    }, 100);
}

function hideAutoLabelLoading(success = true) {
    clearInterval(autoLabelTimerInterval);
    const mobileBtn = document.getElementById('mobile-autolabel-btn');
    const stopAutolabelBtn = document.getElementById('stop-autolabel-btn');
    const stageWrap = document.querySelector('.image-stage-wrap');
    if (stageWrap) stageWrap.classList.remove('is-inferring');

    const pill = document.getElementById('autolabel-status-pill');
    const pillBar = document.getElementById('autolabel-pill-progress-bar');
    if (pillBar && success) pillBar.style.width = '100%';

    setTimeout(() => {
        if (pill) pill.style.display = 'none';
    }, success ? 220 : 60);

    if (stopAutolabelBtn) stopAutolabelBtn.style.display = 'none';
    if (runAutolabelBtn) {
        runAutolabelBtn.style.display = 'inline-flex';
        runAutolabelBtn.classList.remove('loading');
        runAutolabelBtn.innerHTML = '<svg class="tool-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg><span style="font-size: 0.74rem; font-weight: 700; margin-left: 2px;">AI</span>';
        runAutolabelBtn.disabled = false;
    }
    if (mobileBtn) {
        mobileBtn.classList.remove('dock-btn-danger');
        mobileBtn.classList.remove('loading');
        mobileBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg><span>Auto-Label</span>';
        mobileBtn.disabled = false;
    }
}

function abortAutoLabel() {
    if (autoLabelAbortController) {
        autoLabelAbortController.abort();
        autoLabelAbortController = null;
    }
    hideAutoLabelLoading(false);
    if (typeof updateStudioStatus === 'function') {
        updateStudioStatus('Auto-Label abgebrochen · Bereit', 'ready');
    }
}

const stopAutolabelBtn = document.getElementById('stop-autolabel-btn');
if (stopAutolabelBtn) {
    stopAutolabelBtn.addEventListener('click', abortAutoLabel);
}

const aiCancelLoadingBtn = document.getElementById('ai-cancel-loading-btn');
if (aiCancelLoadingBtn) {
    aiCancelLoadingBtn.addEventListener('click', abortAutoLabel);
}

if (runAutolabelBtn) {
    runAutolabelBtn.addEventListener('click', async () => {
        const imgB64 = captureCurrentImageBase64();
        if (!imgB64) {
            alert(window.t ? window.t('autolabel.please_load_image') : 'Bitte zuerst ein Bild laden oder die Webcam aktivieren!');
            return;
        }

        const chosenModel = getAutolabelModelName();
        const provider = autolabelProvider ? autolabelProvider.value : 'gemini';

        autoLabelAbortController = new AbortController();
        showAutoLabelLoading(chosenModel, provider);

        try {
            const detectFp = optFootprint ? optFootprint.checked : true;
            const detectMk = optMarking ? optMarking.checked : true;
            const detectSg = optSubgroup ? optSubgroup.checked : true;

            const payload = {
                image_base64: imgB64,
                provider: provider,
                model_name: chosenModel,
                api_key: geminiApiKey.value.trim() || null,
                openai_url: localUrl ? localUrl.value.trim() : null,
                lmstudio_url: localUrl ? localUrl.value.trim() : null,
                ollama_url: localUrl ? localUrl.value.trim() : null,
                detect_footprint: detectFp,
                detect_part_marking: detectMk,
                detect_ic_subgroup: detectSg
            };

            const response = await fetch('/api/auto-label', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: autoLabelAbortController.signal
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || `Server-Fehler ${response.status}`);
            }

            const data = await response.json();
            let { w: srcW, h: srcH } = getActiveMediaSource();
            if (!srcW || !srcH) {
                if (previewImage && (previewImage.naturalWidth || previewImage.width)) {
                    srcW = previewImage.naturalWidth || previewImage.width;
                    srcH = previewImage.naturalHeight || previewImage.height;
                }
            }

            if (!data.components || data.components.length === 0) {
                hideAutoLabelLoading(true);
                const noCompMsg = (window.t)
                    ? ((window.innerWidth <= 768)
                        ? window.t('autolabel.no_components_found', { ms: data.latency_ms })
                        : window.t('autolabel.no_components_found_model', { model: data.model, ms: data.latency_ms }))
                    : `Keine Bauteile im Bild gefunden (${data.latency_ms} ms).`;
                if (typeof updateStudioStatus === 'function') {
                    updateStudioStatus(noCompMsg, 'warning');
                } else if (statusDiv) {
                    statusDiv.innerText = noCompMsg;
                }
                return;
            }

            detectedBoxes = data.components.map(c => {
                const x1 = Math.round(c.xmin * srcW);
                const y1 = Math.round(c.ymin * srcH);
                const x2 = Math.round(c.xmax * srcW);
                const y2 = Math.round(c.ymax * srcH);
                return {
                    x1, y1, x2, y2,
                    ocrX1: x1, ocrY1: y1, ocrX2: x2, ocrY2: y2,
                    label: c.label,
                    score: Math.round((c.confidence || 0.95) * 100),
                    confidence: c.confidence || 0.95,
                    footprint: c.footprint || null,
                    footprintPath: c.footprint_path || null,
                    icSubgroup: c.ic_subgroup || null,
                    partMarking: c.part_marking || null,
                    kind: c.label.includes('ic') ? 'semiconductor' : (c.label.includes('transistor') ? 'semiconductor' : (c.label.includes('resistor') ? 'resistor' : 'other'))
                };
            });

            drawBboxOverlay();
            renderStage0Chips();
            updateStage0CropPreview();
            if (typeof renderObjectsList === 'function') {
                renderObjectsList();
            }
            if (typeof updateBoxEditBar === 'function') {
                updateBoxEditBar();
            }

            if (stage0Summary) {
                stage0Summary.innerText = window.t
                    ? window.t('canvas.autolabel_result', { count: detectedBoxes.length, ms: data.latency_ms })
                    : `Auto-Label: ${detectedBoxes.length} Bauteile erkannt (${data.latency_ms} ms)`;
            }
            selectComponentBox(0, true);

            // Automatische Split-Empfehlung (Train vs. Val) anwenden & anzeigen
            if (data.suggested_split) {
                const targetSplit = data.suggested_split;
                if (typeof datasetSplit !== 'undefined' && datasetSplit) datasetSplit.value = targetSplit;
                if (typeof splitPillBtns !== 'undefined' && splitPillBtns) {
                    splitPillBtns.forEach(b => {
                        b.classList.toggle('active', b.getAttribute('data-split') === targetSplit);
                    });
                }
                currentSplitRecommendation = {
                    targetSplit: targetSplit,
                    code: data.suggested_split_code,
                    params: data.suggested_split_params,
                    rawReason: data.suggested_split_reason
                };
                renderSplitRecommendation();
            }

            hideAutoLabelLoading(true);
            const hasTokens = typeof data.total_tokens === 'number' && data.total_tokens > 0;
            const successStatus = hasTokens
                ? (window.t
                    ? window.t('canvas.autolabel_result_tokens', { count: detectedBoxes.length, ms: data.latency_ms, tokens: data.total_tokens.toLocaleString() })
                    : `Auto-Label: ${detectedBoxes.length} Bauteil${detectedBoxes.length === 1 ? '' : 'e'} erkannt (${data.latency_ms} ms · ${data.total_tokens.toLocaleString()} Tokens) · Bereit`)
                : (window.t
                    ? window.t('canvas.autolabel_result', { count: detectedBoxes.length, ms: data.latency_ms })
                    : `Auto-Label: ${detectedBoxes.length} Bauteil${detectedBoxes.length === 1 ? '' : 'e'} erkannt (${data.latency_ms} ms) · Bereit`);
            if (typeof updateStudioStatus === 'function') {
                updateStudioStatus(successStatus, 'ready');
            } else if (statusDiv) {
                statusDiv.innerText = successStatus;
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('Auto-Label vom Benutzer abgebrochen.');
                return;
            }
            console.error('Auto-Label Fehler:', err);
            hideAutoLabelLoading(false);
            const errStatus = window.t ? window.t('autolabel.error_prefix', { error: err.message }) : `Auto-Label Fehler: ${err.message}`;
            if (typeof updateStudioStatus === 'function') {
                updateStudioStatus(errStatus, 'warning');
            } else if (statusDiv) {
                statusDiv.innerText = errStatus;
            }
            const errTitle = window.t ? window.t('autolabel.error_prefix', { error: '' }) : 'Auto-Label Fehler: ';
            alert(`${errTitle}\n${err.message}`);
        } finally {
            autoLabelAbortController = null;
        }
    });
}

function normalizeLabelForYolo(rawLabel) {
    if (!rawLabel) return 'other';
    const clean = String(rawLabel).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const direct = knownDatasetClasses.find(k => clean === k);
    if (direct) return direct;
    if (clean.includes('resistor') || clean.includes('widerstand')) return 'resistor';
    if (clean.includes('capacitor') || clean.includes('kondensator') || clean.includes('elko') || clean.includes('cap_')) return 'capacitor';
    if (clean.includes('inductor') || clean.includes('spule') || clean.includes('drossel') || clean.includes('ferrite')) return 'inductor';
    if (clean.includes('led') || clean.includes('leuchtdiode')) return 'led';
    if (clean.includes('diode') || clean.includes('zener') || clean.includes('rectifier')) return 'diode';
    if (clean.includes('transistor') || clean.includes('fet') || clean.includes('mosfet') || clean.includes('bjt') || clean.includes('to_92') || clean.includes('to_220')) return 'transistor';
    if (clean.includes('ic') || clean.includes('chip') || clean.includes('dip') || clean.includes('processor') || clean.includes('microcontroller') || clean.includes('mcu')) return 'ic';
    if (clean.includes('potentiometer') || clean.includes('poti') || clean.includes('trimmer')) return 'potentiometer';
    if (clean.includes('switch') || clean.includes('button') || clean.includes('taster') || clean.includes('schalter')) return 'switch_button';
    if (clean.includes('relay') || clean.includes('relais')) return 'relay';
    if (clean.includes('connector') || clean.includes('header') || clean.includes('pin_header') || clean.includes('terminal')) return 'connector';
    if (clean.includes('display') || clean.includes('oled') || clean.includes('lcd') || clean.includes('7_segment')) return 'display';
    if (clean.includes('board') || clean.includes('platine') || clean.includes('arduino') || clean.includes('esp32') || clean.includes('pcb') || clean.includes('module')) return 'board';
    return 'other';
}

let isCurrentSampleSaved = false;

function updateCurationSampleUI() {
    const activeSampleBanner = document.getElementById('active-sample-banner');
    const activeSampleIdDisplay = document.getElementById('active-sample-id-display');
    const activeSampleSplitBadge = document.getElementById('active-sample-split-badge');
    const saveAsCopyBtn = document.getElementById('save-as-copy-btn');
    const saveBtn = document.getElementById('save-dataset-btn');

    if (window.currentActiveSample && window.currentActiveSample.id) {
        if (activeSampleBanner) activeSampleBanner.style.display = 'block';
        if (activeSampleIdDisplay) activeSampleIdDisplay.innerText = window.currentActiveSample.id;
        if (activeSampleSplitBadge) activeSampleSplitBadge.innerText = window.currentActiveSample.split || 'train';
        if (saveAsCopyBtn) saveAsCopyBtn.style.display = 'inline-flex';

        if (saveBtn && !isCurrentSampleSaved) {
            const btnText = window.t ? window.t('curation.save_changes_btn') : 'Änderungen an Sample speichern';
            saveBtn.title = window.t
                ? window.t('curation.save_changes_title', { id: window.currentActiveSample.id })
                : `Aktualisiert Bounding Boxes und Metadaten von ${window.currentActiveSample.id} direkt im Datensatz (kein neues Bild).`;
            saveBtn.innerHTML = `
                <svg class="tool-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                <span id="save-dataset-btn-text" data-i18n="curation.save_changes_btn">${btnText}</span>
            `;
        }
    } else {
        if (activeSampleBanner) activeSampleBanner.style.display = 'none';
        if (saveAsCopyBtn) saveAsCopyBtn.style.display = 'none';

        if (saveBtn && !isCurrentSampleSaved) {
            const defaultText = window.t ? window.t('curation.save_btn') : 'Sample im Datensatz speichern';
            saveBtn.title = defaultText;
            saveBtn.innerHTML = `
                <svg class="tool-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                <span id="save-dataset-btn-text" data-i18n="curation.save_btn">${defaultText}</span>
            `;
        }
    }
}
window.updateCurationSampleUI = updateCurationSampleUI;
window.addEventListener('languageChanged', () => {
    updateCurationSampleUI();
});

function resetSampleSavedState(resetActiveSample = false) {
    isCurrentSampleSaved = false;
    if (resetActiveSample) {
        window.currentActiveSample = null;
    }
    if (saveDatasetBtn) {
        saveDatasetBtn.disabled = false;
    }
    updateCurationSampleUI();
    const nextImageCtaBtn = document.getElementById('next-image-cta-btn');
    if (nextImageCtaBtn) {
        nextImageCtaBtn.style.display = 'none';
    }
}
window.resetSampleSavedState = resetSampleSavedState;

const unloadActiveSampleBtn = document.getElementById('unload-active-sample-btn');
if (unloadActiveSampleBtn) {
    unloadActiveSampleBtn.addEventListener('click', () => {
        window.currentActiveSample = null;
        resetSampleSavedState(true);
        if (autolabelStatus) {
            autolabelStatus.innerText = window.t
                ? window.t('curation.sample_detached')
                : 'Verknüpfung gelöst. Nächstes Speichern erstellt ein neues Bild-Sample.';
        }
    });
}

function buildBoxesPayload() {
    const { w: srcW, h: srcH } = getActiveMediaSource();
    return detectedBoxes.map(b => {
        const ymin = Math.max(0.0, Math.min(1.0, (b.y1 || 0) / srcH));
        const xmin = Math.max(0.0, Math.min(1.0, (b.x1 || 0) / srcW));
        const ymax = Math.max(0.0, Math.min(1.0, (b.y2 || 0) / srcH));
        const xmax = Math.max(0.0, Math.min(1.0, (b.x2 || 0) / srcW));
        return {
            label: normalizeLabelForYolo(b.label),
            ymin: Math.min(ymin, ymax),
            xmin: Math.min(xmin, xmax),
            ymax: Math.max(ymin, ymax),
            xmax: Math.max(xmin, xmax),
            confidence: b.confidence !== undefined ? b.confidence : 1.0,
            part_marking: b.partMarking || null,
            ic_subgroup: b.icSubgroup || null,
            footprint: b.footprint || null
        };
    });
}

async function updateDatasetSampleBoxesSafe(split, id, boxes) {
    if (typeof CTApi !== 'undefined' && typeof CTApi.updateDatasetSampleBoxes === 'function') {
        return CTApi.updateDatasetSampleBoxes(split, id, boxes);
    }
    if (typeof window.CTApi !== 'undefined' && typeof window.CTApi.updateDatasetSampleBoxes === 'function') {
        return window.CTApi.updateDatasetSampleBoxes(split, id, boxes);
    }
    // Robuster Direktaufruf als Fallback
    const res = await fetch(`/api/dataset/samples/${encodeURIComponent(split)}/${encodeURIComponent(id)}/boxes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(boxes)
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        let errMsg = `HTTP ${res.status}`;
        if (err && err.detail) {
            errMsg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
        }
        throw new Error(errMsg);
    }
    return res.json();
}

if (saveDatasetBtn) {
    saveDatasetBtn.addEventListener('click', async () => {
        if (detectedBoxes.length === 0) {
            alert(window.t ? window.t('autolabel.no_boxes_to_save') : 'Es gibt keine Bounding Boxes zum Speichern! Bitte zuerst Auto-Label ausführen oder manuell Boxen zeichnen.');
            return;
        }

        const boxesPayload = buildBoxesPayload();

        // -------------------------------------------------------------
        // FALL 1: Bestehendes Sample bearbeiten (In-Place Update ohne neues Bild)
        // -------------------------------------------------------------
        if (window.currentActiveSample && window.currentActiveSample.id) {
            const { split, id } = window.currentActiveSample;
            saveDatasetBtn.disabled = true;
            autolabelStatus.innerText = window.t
                ? window.t('curation.updating_sample', { id })
                : `Aktualisiere Annotationen für ${id}...`;

            try {
                const resData = await updateDatasetSampleBoxesSafe(split, id, boxesPayload);

                if (datasetCounterBadge && resData.stats) {
                    datasetCounterBadge.innerText = typeof window.formatDatasetBadge === 'function'
                        ? window.formatDatasetBadge(resData.stats.train_images, resData.stats.val_images, resData.stats.total_annotations)
                        : `Datensatz: ${resData.stats.train_images} Train • ${resData.stats.val_images} Val (${resData.stats.total_annotations} Boxen)`;
                }

                autolabelStatus.innerText = window.t
                    ? window.t('curation.sample_updated', { id, count: resData.box_count || boxesPayload.length })
                    : `Änderungen an ${id} erfolgreich aktualisiert (${resData.box_count || boxesPayload.length} Boxen).`;

                // Inkrementelle Aktualisierung der Datensatz-Galerie im Cache
                if (typeof cachedGallerySamples !== 'undefined' && Array.isArray(cachedGallerySamples)) {
                    const cachedItem = cachedGallerySamples.find(s => s.id === id && s.split === split);
                    if (cachedItem) {
                        cachedItem.boxes = boxesPayload;
                        cachedItem.box_count = boxesPayload.length;
                        cachedItem.classes = Array.from(new Set(boxesPayload.map(b => b.label)));
                    }
                }

                if (viewDataset && viewDataset.classList.contains('active') && typeof renderFilteredGallery === 'function') {
                    renderFilteredGallery();
                }

                isCurrentSampleSaved = true;
                saveDatasetBtn.disabled = false;
                const savedText = window.t ? window.t('curation.changes_saved_btn') : 'Änderungen gespeichert';
                saveDatasetBtn.innerHTML = `
                    <svg class="tool-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>${savedText}</span>
                `;
                setTimeout(() => {
                    updateCurationSampleUI();
                }, 2500);

            } catch (err) {
                console.error('Fehler beim Aktualisieren des Samples:', err);
                autolabelStatus.innerText = window.t
                    ? window.t('curation.sample_update_failed', { error: err.message })
                    : `Aktualisieren fehlgeschlagen: ${err.message}`;
                saveDatasetBtn.disabled = false;
            }
            return;
        }

        // -------------------------------------------------------------
        // FALL 2: Neues Bild-Sample im Datensatz anlegen
        // -------------------------------------------------------------
        const imgB64 = captureCurrentImageBase64();
        if (!imgB64) {
            alert(window.t ? window.t('autolabel.no_image_to_save') : 'Kein Bild zum Speichern vorhanden!');
            return;
        }

        saveDatasetBtn.disabled = true;
        autolabelStatus.innerText = 'Speichere Bild und YOLO-Label auf dem Server...';

        try {
            const chosenSplit = datasetSplit ? datasetSplit.value : 'train';
            const payload = {
                image_base64: imgB64,
                boxes: boxesPayload,
                split: chosenSplit
            };

            const response = await CTApi.saveDatasetSample(payload);

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                let errMsg = `HTTP ${response.status}`;
                if (err && err.detail) {
                    if (Array.isArray(err.detail)) {
                        errMsg = err.detail.map(d => `${d.loc ? d.loc.slice(-2).join('.') + ': ' : ''}${d.msg || JSON.stringify(d)}`).join('; ');
                    } else if (typeof err.detail === 'object') {
                        errMsg = JSON.stringify(err.detail);
                    } else {
                        errMsg = String(err.detail);
                    }
                }
                throw new Error(errMsg);
            }

            const resData = await response.json();
            if (datasetCounterBadge && resData.stats) {
                datasetCounterBadge.innerText = typeof window.formatDatasetBadge === 'function'
                    ? window.formatDatasetBadge(resData.stats.train_images, resData.stats.val_images, resData.stats.total_annotations)
                    : `Datensatz: ${resData.stats.train_images} Train • ${resData.stats.val_images} Val (${resData.stats.total_annotations} Boxen)`;
            }
            autolabelStatus.innerText = window.t
                ? window.t('autolabel.saved_as', { id: resData.sample_id, count: resData.annotations_saved })
                : `Gespeichert als ${resData.sample_id} (${resData.annotations_saved} Boxen)!`;

            const newSampleObj = {
                id: resData.sample_id,
                split: payload.split,
                image_url: `/dataset/images/${payload.split}/${resData.sample_id}.jpg`,
                thumb_url: `/api/dataset/thumbnails/${payload.split}/${resData.sample_id}`,
                boxes: boxesPayload,
                box_count: boxesPayload.length,
                classes: Array.from(new Set(boxesPayload.map(b => b.label))),
                created_at: Math.floor(Date.now() / 1000)
            };

            if (typeof cachedGallerySamples !== 'undefined' && Array.isArray(cachedGallerySamples)) {
                cachedGallerySamples.unshift(newSampleObj);
            }

            if (viewDataset && viewDataset.classList.contains('active') && typeof renderFilteredGallery === 'function') {
                renderFilteredGallery();
            }

            // Nach erfolgreichem Speichern wird dieses Bild nun als aktives Sample geführt
            window.currentActiveSample = {
                split: payload.split,
                id: resData.sample_id,
                tags: []
            };

            isCurrentSampleSaved = true;
            saveDatasetBtn.disabled = false;
            const alreadySavedText = window.t ? window.t('curation.already_saved_btn') : 'Bereits gespeichert';
            saveDatasetBtn.innerHTML = `
                <svg class="tool-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>${alreadySavedText}</span>
            `;
            updateCurationSampleUI();

            const nextImageCtaBtn = document.getElementById('next-image-cta-btn');
            if (nextImageCtaBtn) {
                nextImageCtaBtn.style.display = 'inline-flex';
                nextImageCtaBtn.onclick = () => {
                    resetSampleSavedState(true);
                    document.getElementById('file-input')?.click();
                };
            }
        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            autolabelStatus.innerText = window.t
                ? window.t('autolabel.save_failed', { error: err.message })
                : `Speichern fehlgeschlagen: ${err.message}`;
            saveDatasetBtn.disabled = false;
        }
    });
}

const saveAsCopyBtn = document.getElementById('save-as-copy-btn');
if (saveAsCopyBtn) {
    saveAsCopyBtn.addEventListener('click', async () => {
        if (detectedBoxes.length === 0) {
            alert(window.t ? window.t('autolabel.no_boxes_to_save') : 'Es gibt keine Bounding Boxes zum Duplizieren!');
            return;
        }
        const imgB64 = captureCurrentImageBase64();
        if (!imgB64) {
            alert(window.t ? window.t('autolabel.no_image_to_save') : 'Kein Bild zum Duplizieren vorhanden!');
            return;
        }

        saveAsCopyBtn.disabled = true;
        autolabelStatus.innerText = window.t
            ? window.t('curation.duplicating_sample')
            : 'Dupliziere Bild als neues Sample...';

        try {
            const boxesPayload = buildBoxesPayload();
            const chosenSplit = datasetSplit ? datasetSplit.value : (window.currentActiveSample?.split || 'train');
            const payload = {
                image_base64: imgB64,
                boxes: boxesPayload,
                split: chosenSplit
            };

            const response = await CTApi.saveDatasetSample(payload);
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            const resData = await response.json();
            if (datasetCounterBadge && resData.stats) {
                datasetCounterBadge.innerText = typeof window.formatDatasetBadge === 'function'
                    ? window.formatDatasetBadge(resData.stats.train_images, resData.stats.val_images, resData.stats.total_annotations)
                    : `Datensatz: ${resData.stats.train_images} Train • ${resData.stats.val_images} Val (${resData.stats.total_annotations} Boxen)`;
            }

            const newSampleObj = {
                id: resData.sample_id,
                split: payload.split,
                image_url: `/dataset/images/${payload.split}/${resData.sample_id}.jpg`,
                thumb_url: `/api/dataset/thumbnails/${payload.split}/${resData.sample_id}`,
                boxes: boxesPayload,
                box_count: boxesPayload.length,
                classes: Array.from(new Set(boxesPayload.map(b => b.label))),
                created_at: Math.floor(Date.now() / 1000)
            };

            if (typeof cachedGallerySamples !== 'undefined' && Array.isArray(cachedGallerySamples)) {
                cachedGallerySamples.unshift(newSampleObj);
            }

            if (viewDataset && viewDataset.classList.contains('active') && typeof renderFilteredGallery === 'function') {
                renderFilteredGallery();
            }

            window.currentActiveSample = {
                split: payload.split,
                id: resData.sample_id,
                tags: []
            };

            autolabelStatus.innerText = window.t
                ? window.t('curation.sample_duplicated', { id: resData.sample_id })
                : `Erfolgreich als neues Sample ${resData.sample_id} dupliziert!`;
            updateCurationSampleUI();
        } catch (err) {
            console.error('Fehler beim Duplizieren:', err);
            autolabelStatus.innerText = `Duplizieren fehlgeschlagen: ${err.message}`;
        } finally {
            saveAsCopyBtn.disabled = false;
        }
    });
}

// Initialisierung der Widerstands-Dropdowns
initResistorSelectors();
updateCurationSampleUI();


async function syncLlmSettingsWithServer() {
    try {
        const res = await CTApi.getLlmSettings();
        const s = res?.settings || res;
        if (s) {
            if (s.gemini_model) localStorage.setItem(LLM_STORAGE_KEYS.MODEL_GEMINI, s.gemini_model);
            if (s.openai_model) localStorage.setItem(LLM_STORAGE_KEYS.MODEL_OPENAI, s.openai_model);
            if (s.ollama_model) localStorage.setItem(LLM_STORAGE_KEYS.MODEL_OLLAMA, s.ollama_model);

            const prov = s.default_provider || s.provider;
            if (prov && autolabelProvider) {
                autolabelProvider.value = prov;
                handleProviderChange(false);
            }
            if (s.openai_url && localUrl && (prov === 'openai' || prov === 'lmstudio')) {
                localUrl.value = s.openai_url;
                localStorage.setItem(LLM_STORAGE_KEYS.OPENAI_URL, s.openai_url);
            } else if (s.ollama_url && localUrl && prov === 'ollama') {
                localUrl.value = s.ollama_url;
                localStorage.setItem(LLM_STORAGE_KEYS.OLLAMA_URL, s.ollama_url);
            } else if (s.custom_url && localUrl) {
                localUrl.value = s.custom_url;
            }
            if (s.custom_model && autolabelModelCustom) {
                autolabelModelCustom.value = s.custom_model;
            }
            const hasGemini = s.has_gemini_key || s.gemini_api_key_set;
            if (hasGemini && geminiApiKey) {
                geminiApiKey.value = '';
                geminiApiKey.placeholder = '•••••••••••••••• (Aktiv auf Server konfiguriert)';
                const statusSpan = document.getElementById('gemini-key-status');
                if (statusSpan) {
                    statusSpan.innerText = 'Aktiv (Server)';
                    statusSpan.style.color = '#10b981';
                }
            }
            const hasOpenai = s.has_openai_key || s.openai_api_key_set;
            if (hasOpenai && openaiApiKey) {
                openaiApiKey.value = '';
                openaiApiKey.placeholder = '•••••••••••••••• (Aktiv auf Server konfiguriert)';
                const openaiStatusSpan = document.getElementById('openai-key-status');
                if (openaiStatusSpan) {
                    openaiStatusSpan.innerText = 'Aktiv (Server)';
                    openaiStatusSpan.style.color = '#10b981';
                }
            }
            if (s.options) {
                setAutolabelFeatures(
                    s.options.detect_footprint ?? true,
                    s.options.detect_marking ?? true,
                    s.options.detect_subgroup ?? true,
                    false
                );
            }
            updateLlmStatusChip();
        }
    } catch (err) {
        console.warn('Server-LLM-Einstellungen konnten nicht abgerufen werden:', err);
    }
}
