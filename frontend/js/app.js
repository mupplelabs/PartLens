// =====================================================================
// PARTLENS MAIN APP ENTRY POINT & INITIALIZATION
// =====================================================================

// =====================================================================
// COMPONENTTRACKER STUDIO REDESIGN: NAVIGATION, GALERIE & MOBILE DOCK
// =====================================================================

const navStudioBtn = document.getElementById('nav-studio-btn');
const navDatasetBtn = document.getElementById('nav-dataset-btn');
const navAnalyticsBtn = document.getElementById('nav-analytics-btn');
const navSettingsBtn = document.getElementById('nav-settings-btn');

const viewStudio = document.getElementById('view-studio');
const viewDataset = document.getElementById('view-dataset');
const viewAnalytics = document.getElementById('view-analytics');
const viewSettings = document.getElementById('view-settings');

const navTabs = [
    { btn: navStudioBtn, view: viewStudio },
    { btn: navDatasetBtn, view: viewDataset, onOpen: loadDatasetGallery },
    { btn: navAnalyticsBtn, view: viewAnalytics, onOpen: loadAnalyticsView },
    { btn: navSettingsBtn, view: viewSettings }
];

function switchAppView(targetBtn) {
    if (typeof toggleStudioInspectorSheet === 'function') {
        toggleStudioInspectorSheet(false);
    }
    document.body.classList.toggle('view-studio-active', targetBtn === navStudioBtn);
    document.body.classList.toggle('view-dataset-active', targetBtn === navDatasetBtn);
    document.body.classList.toggle('view-analytics-active', targetBtn === navAnalyticsBtn);
    document.body.classList.toggle('view-settings-active', targetBtn === navSettingsBtn);
    navTabs.forEach(({ btn, view, onOpen }) => {
        if (btn === targetBtn) {
            btn?.classList.add('active');
            view?.classList.add('active');
            if (onOpen) onOpen();
            if (btn === navStudioBtn && typeof fitImageToWorkspace === 'function') {
                setTimeout(fitImageToWorkspace, 30);
            }
        } else {
            btn?.classList.remove('active');
            view?.classList.remove('active');
        }
    });
}

navTabs.forEach(({ btn }) => {
    btn?.addEventListener('click', () => switchAppView(btn));
});



// =====================================================================
// IPHONE 16 PRO MOBILE DOCK HANDLERS
// =====================================================================
const mobilePhotoBtn = document.getElementById('mobile-photo-btn');
const mobileAutolabelBtn = document.getElementById('mobile-autolabel-btn');
const mobileAddBoxBtn = document.getElementById('mobile-add-box-btn');
const mobileSaveBtn = document.getElementById('mobile-save-btn');

if (cameraFileInput) {
    cameraFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
            if (typeof handleFile === 'function') {
                handleFile(file);
            } else {
                if (currentMode !== 'upload' && tabUpload) tabUpload.click();
                const reader = new FileReader();
                reader.onload = (ev) => {
                    previewImage.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }
        }
        cameraFileInput.value = '';
    });
}

// Synchronisiere DOM-Platzierung des Studio-Inspectors (Auf Mobile als Body-Child, um Clipping/Containing-Block zu verhindern)
function syncInspectorDomPlacement() {
    const isMobile = window.innerWidth <= 768;
    const inspector = document.querySelector('.studio-inspector');
    const studioGrid = document.querySelector('.studio-grid');
    if (!inspector) return;
    if (isMobile) {
        if (inspector.parentElement !== document.body) {
            document.body.appendChild(inspector);
        }
    } else {
        if (studioGrid && inspector.parentElement !== studioGrid) {
            studioGrid.appendChild(inspector);
        }
    }
}
window.addEventListener('resize', syncInspectorDomPlacement);
syncInspectorDomPlacement();

// Mobile Inspector Sheet Drawer Toggle (Option E)
function toggleStudioInspectorSheet(open) {
    syncInspectorDomPlacement();
    const isCurrentlyOpen = document.body.classList.contains('studio-inspector-open');
    const shouldOpen = open !== undefined ? open : !isCurrentlyOpen;
    document.body.classList.toggle('studio-inspector-open', shouldOpen);
    const backdrop = document.getElementById('studio-inspector-backdrop');
    if (backdrop) backdrop.style.display = shouldOpen ? 'block' : 'none';
    const mobileInfo = document.getElementById('mobile-info-btn');
    if (mobileInfo) mobileInfo.classList.toggle('active', shouldOpen);
}
window.toggleStudioInspectorSheet = toggleStudioInspectorSheet;

const mobileInfoBtn = document.getElementById('mobile-info-btn');
if (mobileInfoBtn) {
    mobileInfoBtn.addEventListener('click', () => toggleStudioInspectorSheet());
}

const btnCloseStudioSheet = document.getElementById('btn-close-studio-sheet');
if (btnCloseStudioSheet) {
    btnCloseStudioSheet.addEventListener('click', () => toggleStudioInspectorSheet(false));
}

const studioInspectorBackdrop = document.getElementById('studio-inspector-backdrop');
if (studioInspectorBackdrop) {
    studioInspectorBackdrop.addEventListener('click', () => toggleStudioInspectorSheet(false));
}

// Swipe down on sheet drag handle to close
const studioSheetDragHandle = document.getElementById('studio-sheet-drag-handle');
if (studioSheetDragHandle) {
    let sheetTouchStartY = 0;
    studioSheetDragHandle.addEventListener('touchstart', (e) => {
        sheetTouchStartY = e.touches[0].clientY;
    }, { passive: true });
    studioSheetDragHandle.addEventListener('touchmove', (e) => {
        const dy = e.touches[0].clientY - sheetTouchStartY;
        if (dy > 35) {
            toggleStudioInspectorSheet(false);
        }
    }, { passive: true });
}

if (mobilePhotoBtn && cameraFileInput) {
    mobilePhotoBtn.addEventListener('click', () => {
        toggleStudioInspectorSheet(false);
        cameraFileInput.click();
    });
}

if (mobileAutolabelBtn) {
    mobileAutolabelBtn.addEventListener('click', () => {
        if (autoLabelAbortController) {
            abortAutoLabel();
        } else if (runAutolabelBtn) {
            runAutolabelBtn.click();
        }
    });
}
if (mobileAddBoxBtn && addManualBoxBtn) {
    mobileAddBoxBtn.addEventListener('click', () => {
        toggleStudioInspectorSheet(false);
        addManualBoxBtn.click();
    });
}
if (mobileSaveBtn && saveDatasetBtn) {
    mobileSaveBtn.addEventListener('click', () => {
        toggleStudioInspectorSheet(false);
        saveDatasetBtn.click();
    });
}

// Mobile Dock Gallery Handlers
const mobileDockImportBtn = document.getElementById('mobile-dock-import-btn');
const mobileDockFilterBtn = document.getElementById('mobile-dock-filter-btn');
const mobileDockSelectBtn = document.getElementById('mobile-dock-select-btn');
const mobileDockExportBtn = document.getElementById('mobile-dock-export-btn');

if (mobileDockImportBtn) {
    mobileDockImportBtn.addEventListener('click', () => {
        const importBtn = document.getElementById('open-import-modal-btn');
        if (importBtn) importBtn.click();
    });
}

if (mobileDockFilterBtn) {
    mobileDockFilterBtn.addEventListener('click', () => {
        if (typeof openGalleryFilterModal === 'function') {
            openGalleryFilterModal();
        }
    });
}

if (mobileDockSelectBtn) {
    mobileDockSelectBtn.addEventListener('click', () => {
        const toggleBtn = document.getElementById('toggle-select-mode-btn');
        if (toggleBtn) toggleBtn.click();
        mobileDockSelectBtn.classList.toggle('active', document.body.classList.contains('dataset-select-mode-active'));
    });
}

if (mobileDockExportBtn) {
    mobileDockExportBtn.addEventListener('click', () => {
        if (typeof openExportSheet === 'function') {
            openExportSheet();
        }
    });
}


// =====================================================================
// STUDIO WERKZEUGE & ASYNCHRONE HINTERGRUND-INITIALISIERUNG
// =====================================================================
function setStudioToolsState(ready, reason = '') {
    // Hinweis: save-dataset-btn und add-manual-box-btn werden bewusst NICHT gesperrt,
    // damit der Nutzer sofort Samples zeichnen und abspeichern kann.
    const toolBtns = [
        document.getElementById('run-autolabel-btn'),
        document.getElementById('run-detect-btn'),
        document.getElementById('rotate-image-btn'),
        document.getElementById('clear-boxes-btn'),
        document.getElementById('run-ocr-btn'),
        document.getElementById('scan-resistor-btn'),
        document.getElementById('reclassify-btn')
    ];

    toolBtns.forEach(btn => {
        if (!btn) return;
        if (!ready) {
            btn.classList.add('tool-disabled');
            btn.setAttribute('aria-disabled', 'true');
            if (reason) btn.setAttribute('title', reason);
        } else {
            btn.classList.remove('tool-disabled');
            btn.removeAttribute('aria-disabled');
            const i18nKey = btn.getAttribute('data-i18n-title');
            if (i18nKey && window.t) {
                btn.title = window.t(i18nKey);
            }
        }
    });
}

function updateStudioStatus(text, state = 'info') {
    if (statusDiv) statusDiv.innerText = text;
    const indicator = document.getElementById('status-live-indicator');
    if (!indicator) return;
    if (state === 'ready') {
        indicator.className = 'status-radar-dot ready';
    } else if (state === 'busy' || state === 'loading') {
        indicator.className = 'status-radar-dot busy';
    } else if (state === 'warning') {
        indicator.className = 'status-radar-dot warning';
    } else {
        indicator.className = 'status-radar-dot initializing';
    }
}

async function initStudioBackground() {
    const t0 = performance.now();
    const liveIndicator = document.getElementById('status-live-indicator');
    const backendVal = document.getElementById('chip-backend-val');
    const ocrVal = document.getElementById('chip-ocr-val');
    const clipVal = document.getElementById('chip-clip-val');
    const backendChip = document.getElementById('chip-backend');

    // 1. Visuelles Feedback: Werkzeuge in Standby, Startstatus
    setStudioToolsState(false, window.t ? window.t('telemetry.init_tools_wait') : 'Studio initialisiert im Hintergrund (Backend & Bildanalyse)...');
    if (liveIndicator) liveIndicator.className = 'status-radar-dot initializing';
    if (statusDiv) statusDiv.innerText = window.t ? window.t('telemetry.step_connect') : 'Schritt 1/3: Verbinde mit Backend...';

    // Parallele Vorbereitung: Bild-Laden und Backend-Abfrage laufen zeitgleich
    const ensurePreviewReady = () => {
        return new Promise((resolve) => {
            if (previewImage && previewImage.complete && previewImage.naturalWidth > 0) {
                resolve(true);
            } else if (previewImage) {
                const onLoaded = () => {
                    previewImage.removeEventListener('load', onLoaded);
                    resolve(true);
                };
                previewImage.addEventListener('load', onLoaded);
                setTimeout(() => resolve(false), 500); // Schneller Fallback nach 500ms
            } else {
                resolve(false);
            }
        });
    };

    const queryBackendStatus = async () => {
        try {
            const res = await fetch('/api/status');
            if (res.ok) return await res.json();
        } catch (err) {
            console.warn('Backend /api/status nicht erreichbar:', err);
        }
        return null;
    };

    // Starte beides parallel
    const [serverData] = await Promise.all([
        queryBackendStatus(),
        ensurePreviewReady()
    ]);

    let sampleCount = 0;
    let boxCount = 0;

    // Schritt 2: Backend-Daten verarbeiten
    if (serverData) {
        if (backendVal) backendVal.innerText = 'Online';
        if (backendChip) backendChip.classList.remove('warning');

        if (serverData.classes) {
            knownDatasetClasses = serverData.classes;
            populateClassDropdown(knownDatasetClasses);
            if (typeof renderClassQuickBar === 'function') {
                renderClassQuickBar();
            }
        }
        if (serverData.stats) {
            sampleCount = (serverData.stats.train_images || 0) + (serverData.stats.val_images || 0);
            boxCount = serverData.stats.total_annotations || 0;
            const badgeText = typeof window.formatDatasetBadge === 'function'
                ? window.formatDatasetBadge(serverData.stats.train_images, serverData.stats.val_images, boxCount)
                : `Datensatz: ${serverData.stats.train_images} Train • ${serverData.stats.val_images} Val (${boxCount} Boxen)`;
            const headerText = document.getElementById('header-dataset-text');
            if (headerText) {
                headerText.innerText = badgeText;
            } else if (datasetCounterBadge) {
                datasetCounterBadge.innerText = badgeText;
            }
        }
        updateOcrStatusChip();
        updateLlmStatusChip();
        if (serverData.has_gemini_env && autolabelStatus && !geminiApiKey.value) {
            autolabelStatus.innerText = window.t ? window.t('telemetry.server_env_key') : 'Server nutzt GEMINI_API_KEY aus Umgebungsvariable.';
        }
        if (statusDiv) {
            statusDiv.innerText = window.t
                ? window.t('telemetry.step_sync', { samples: sampleCount, boxes: boxCount })
                : `Schritt 2/3: Datensatz synchronisiert (${sampleCount} Bilder, ${boxCount} Boxen)...`;
        }
    } else {
        if (backendVal) backendVal.innerText = 'Offline';
        if (backendChip) backendChip.classList.add('warning');
        updateOcrStatusChip();
        updateLlmStatusChip();
        if (statusDiv) {
            statusDiv.innerText = window.t ? window.t('telemetry.step_offline') : 'Schritt 2/3: Lokaler Offline-Modus aktiv...';
        }
    }

    if (clipVal) clipVal.innerText = window.t ? window.t('footer.standby') : 'Standby';

    // Schritt 3: Heuristik-Detektor (Stage 0) auf Canvas ausführen
    if (statusDiv) {
        statusDiv.innerText = window.t ? window.t('telemetry.step_stage0') : 'Schritt 3/3: Führe Heuristik-Detektor für Bauteile aus...';
    }

    if (previewImage && previewImage.complete && previewImage.naturalWidth > 0) {
        if (typeof fitImageToWorkspace === 'function') {
            fitImageToWorkspace();
        }
        if (typeof runStage0Detection === 'function') {
            runStage0Detection();
        }
    } else if (previewImage) {
        previewImage.addEventListener('load', () => {
            if (typeof fitImageToWorkspace === 'function') {
                fitImageToWorkspace();
            }
        }, { once: true });
    }

    // Fertig! Werkzeuge aktivieren & Bereit-Zustand melden
    setStudioToolsState(true);
    const elapsed = Math.round(performance.now() - t0);

    if (liveIndicator) {
        liveIndicator.className = serverData ? 'status-radar-dot ready' : 'status-radar-dot warning';
    }

    if (statusDiv) {
        if (serverData) {
            statusDiv.innerText = window.t
                ? window.t('footer.studio_ready', { samples: sampleCount, boxes: boxCount, ms: elapsed })
                : `Studio einsatzbereit · Backend online (${sampleCount} Samples, ${boxCount} Boxen) · ${elapsed}ms`;
        } else {
            statusDiv.innerText = window.t
                ? window.t('footer.studio_ready_offline', { ms: elapsed })
                : `Studio einsatzbereit (Offline-Modus: Detektor & Tools aktiv) · ${elapsed}ms`;
        }
    }

    if (outputDiv) {
        outputDiv.innerText = window.t ? window.t('telemetry.clip_ready_ondemand') : 'Bereit (CLIP-Modell wird bei Bedarf geladen)';
    }
}

// Asynchroner Hintergrund-Start (blockiert Navigation und Datensatz-Browsen nicht)
initStudioBackground();


// =====================================================================
// THEME MANAGEMENT (VSCODE & ANTIGRAVITY DARK / LIGHT)
// =====================================================================
function initThemeUI() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        btn.title = current === 'dark' ? 'Zu Light Mode wechseln' : 'Zu Dark Mode wechseln';
        btn.setAttribute('aria-label', current === 'dark' ? 'Zu Light Mode wechseln' : 'Zu Dark Mode wechseln');
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('componenttracker_theme', next);
    initThemeUI();
}

const themeToggleBtn = document.getElementById('theme-toggle-btn');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}
initThemeUI();

if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('componenttracker_theme')) {
            const sysTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', sysTheme);
            initThemeUI();
        }
    });
}

// =====================================================================
// INSPECTOR TABS (CVAT / ROBOFLOW STYLE)
// =====================================================================
const inspectorTabBtns = document.querySelectorAll('.inspector-tab-btn');
inspectorTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        inspectorTabBtns.forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.inspector-tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `${targetTab}-pane`);
        });
    });
});


// Synchronize LLM configuration with server on startup
if (typeof syncLlmSettingsWithServer === 'function') {
    syncLlmSettingsWithServer();
}

// Initialer Workspace-Fit für zentrierte & formatfüllende Bild-Einpassung
if (typeof fitImageToWorkspace === 'function') {
    setTimeout(fitImageToWorkspace, 60);
    setTimeout(fitImageToWorkspace, 300);
}
