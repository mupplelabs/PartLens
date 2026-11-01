// =====================================================================
// EXTERNAL DATASET IMPORT MODAL CONTROLLER (Mendeley / Roboflow)
// =====================================================================

// =====================================================================
// EXTERNER DATENSATZ-IMPORT CONTROLLER (Mendeley / Roboflow -> YOLO)
// =====================================================================
(function initDatasetImportModal() {
    const modal = document.getElementById('dataset-import-modal');
    const openBtn = document.getElementById('open-import-modal-btn');
    const closeBtn = document.getElementById('btn-close-import-modal');
    const cancelBtn = document.getElementById('btn-cancel-import-modal');
    const startBtn = document.getElementById('btn-start-import-exec');
    const abortBtn = document.getElementById('btn-abort-import-exec');
    const sourcesGrid = document.getElementById('import-sources-grid');
    const sourcesLoading = document.getElementById('import-sources-loading');
    const mappingTbody = document.getElementById('import-mapping-tbody');
    const mappingStats = document.getElementById('import-mapping-stats');
    const progressContainer = document.getElementById('import-progress-container');
    const progressBar = document.getElementById('import-progress-bar');
    const progressStatus = document.getElementById('import-progress-status');
    const progressCounter = document.getElementById('import-progress-counter');
    const statImported = document.getElementById('import-stat-imported');
    const statBoxes = document.getElementById('import-stat-boxes');
    const statSkipped = document.getElementById('import-stat-skipped');
    const skipOtherCheckbox = document.getElementById('import-skip-other-checkbox');
    const scopeAllDesc = document.getElementById('import-scope-all-desc');
    const footerHint = document.getElementById('import-footer-hint');

    let availableSources = [];
    let targetClassesList = [
        'resistor', 'capacitor', 'inductor', 'diode', 'led', 
        'transistor', 'ic', 'potentiometer', 'switch_button', 
        'relay', 'connector', 'display', 'board', 'other'
    ];
    let selectedSourceId = 'mendeley';
    let activeMappings = {}; // sourceId -> { rawClass: targetClass }
    let pollInterval = null;
    let isImporting = false;

    if (!modal || !openBtn) return;

    // Radio Card Selection Handler
    const scopeCards = document.querySelectorAll('.import-radio-card');
    scopeCards.forEach(card => {
        card.addEventListener('click', () => {
            scopeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    // Modal öffnen
    openBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        loadImportSources();
    });

    // Modal schließen
    function closeModal() {
        if (isImporting) {
            const confirmMsg = window.t
                ? window.t('import.confirm_background_close')
                : 'Der Import läuft im Hintergrund weiter. Möchten Sie dieses Fenster schließen?';
            if (!confirm(confirmMsg)) {
                return;
            }
        }
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    // Quellen laden
    async function loadImportSources() {
        if (sourcesLoading) sourcesLoading.style.display = 'inline';
        try {
            const res = await fetch('/api/dataset/import/sources');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            
            availableSources = data.sources || [];
            if (data.target_classes && data.target_classes.length > 0) {
                targetClassesList = data.target_classes;
            }

            // Mapping Initialisierung
            availableSources.forEach(src => {
                if (!activeMappings[src.id]) {
                    activeMappings[src.id] = Object.assign({}, src.default_mapping || {});
                }
            });

            renderSourcesCards();
            renderMappingTable();

            // Prüfen ob bereits ein Import läuft
            if (data.current_status && data.current_status.status === 'running') {
                setRunningUI(true);
                startPolling();
            }
        } catch (err) {
            console.error('Fehler beim Laden der Import-Quellen:', err);
            if (sourcesGrid) {
                sourcesGrid.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 16px; text-align: center; color: #ef4444; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span>Fehler beim Scannen von external_datasets: ${err.message}</span>
                    </div>
                `;
            }
        } finally {
            if (sourcesLoading) sourcesLoading.style.display = 'none';
        }
    }

    // Quellenkarten rendern
    function renderSourcesCards() {
        if (!sourcesGrid) return;
        if (availableSources.length === 0) {
            const emptyMsg = window.t
                ? window.t('import.no_sources_found')
                : 'Keine Datensätze in external_datasets/ gefunden.';
            sourcesGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 16px; text-align: center; color: var(--muted); font-size: 0.8rem;">
                    ${emptyMsg}
                </div>
            `;
            if (startBtn) startBtn.disabled = true;
            return;
        }

        // Default Quelle auswählen falls nicht vorhanden
        if (!availableSources.some(s => s.id === selectedSourceId)) {
            selectedSourceId = availableSources[0].id;
        }

        sourcesGrid.innerHTML = availableSources.map(src => {
            const isSelected = src.id === selectedSourceId;
            const splitText = Object.entries(src.splits || {})
                .map(([k, v]) => `${v} ${k}`)
                .join(' · ');
            const isCoco = (src.format || '').toLowerCase() === 'coco';
            const fmtBadge = isCoco
                ? `<span style="font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; background: rgba(168, 85, 247, 0.18); color: #c084fc; font-weight: 800; border: 1px solid rgba(168, 85, 247, 0.35); text-transform: uppercase;">COCO</span>`
                : `<span style="font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; background: rgba(16, 185, 129, 0.18); color: #34d399; font-weight: 800; border: 1px solid rgba(16, 185, 129, 0.35); text-transform: uppercase;">YOLO</span>`;

            const imagesBadgeText = window.t
                ? window.t('import.images_badge', { count: src.total_images })
                : `${src.total_images} Bilder`;

            return `
                <div class="import-source-card ${isSelected ? 'selected' : ''}" data-source-id="${src.id}">
                    <div class="import-source-header">
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
                            ${fmtBadge}
                            <span style="font-weight: 700; font-size: 0.84rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${src.name}</span>
                        </div>
                        <span class="import-source-badge">
                            ${imagesBadgeText}
                        </span>
                    </div>
                    <div style="font-size: 0.7rem; color: var(--muted);">${splitText} · ${src.classes ? src.classes.length : 0} ${window.t ? window.t('import.classes_suffix') : 'Klassen'}</div>
                    <div style="font-size: 0.65rem; color: var(--muted); opacity: 0.7; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${src.folder}
                    </div>
                </div>
            `;
        }).join('');

        // Click handler für Quellen-Karten
        sourcesGrid.querySelectorAll('.import-source-card').forEach(card => {
            card.addEventListener('click', () => {
                if (isImporting) return;
                selectedSourceId = card.getAttribute('data-source-id');
                renderSourcesCards();
                renderMappingTable();
            });
        });

        // Update "Alle Bilder" Beschriftung
        const curSrc = availableSources.find(s => s.id === selectedSourceId);
        if (curSrc && scopeAllDesc) {
            scopeAllDesc.textContent = window.t
                ? window.t('import.scope_all_desc', { count: curSrc.total_images })
                : `Gesamter Datensatz (${curSrc.total_images} Bilder)`;
        }

        if (startBtn && !isImporting) startBtn.disabled = false;
    }

    // Mapping-Tabelle rendern
    function renderMappingTable() {
        if (!mappingTbody) return;
        const src = availableSources.find(s => s.id === selectedSourceId);
        if (!src) {
            const notFoundText = window.t ? window.t('import.source_not_found') : 'Quelle nicht gefunden';
            mappingTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--muted); padding: 16px;">${notFoundText}</td></tr>`;
            return;
        }

        const rawClasses = src.classes || [];
        if (mappingStats) {
            mappingStats.textContent = window.t
                ? window.t('import.classes_count', { count: rawClasses.length })
                : `${rawClasses.length} Original-Klassen`;
        }

        const mapping = activeMappings[src.id] || {};

        const partdbOptgroup = window.t ? window.t('import.partdb_optgroup') : 'Part-DB Bauteil-Klassen';
        const specialOptgroup = window.t ? window.t('import.opt_special') : 'Sonderoptionen';
        const ignoreOption = window.t ? window.t('import.opt_ignore') : '[Ignorieren / Überspringen]';

        // Target options bauen
        const targetOptionsHtml = [
            `<optgroup label="${partdbOptgroup}">`,
            ...targetClassesList.map(tc => `<option value="${tc}">${tc}</option>`),
            '</optgroup>',
            `<optgroup label="${specialOptgroup}">`,
            `<option value="_ignore_">${ignoreOption}</option>`,
            '</optgroup>'
        ].join('');

        mappingTbody.innerHTML = rawClasses.map(rc => {
            const mappedTarget = mapping[rc] || 'other';
            return `
                <tr>
                    <td>
                        <span style="font-weight: 600; color: var(--text);">${rc}</span>
                    </td>
                    <td style="text-align: center; color: var(--muted); font-size: 0.72rem;">
                        •
                    </td>
                    <td>
                        <select class="import-mapping-select" data-raw-class="${rc}">
                            ${targetClassesList.map(tc => `<option value="${tc}" ${tc === mappedTarget ? 'selected' : ''}>${tc}</option>`).join('')}
                            <option value="_ignore_" ${mappedTarget === '_ignore_' ? 'selected' : ''}>${ignoreOption}</option>
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        // Change Handlers für Selects
        mappingTbody.querySelectorAll('.import-mapping-select').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const raw = sel.getAttribute('data-raw-class');
                const val = sel.value;
                if (!activeMappings[selectedSourceId]) {
                    activeMappings[selectedSourceId] = {};
                }
                activeMappings[selectedSourceId][raw] = val;
            });
        });
    }

    // Start Import Execution
    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            if (isImporting) return;
            const scopeRadio = document.querySelector('input[name="import-scope-choice"]:checked');
            const scopeVal = scopeRadio ? scopeRadio.value : '50';
            const maxSamples = scopeVal === 'all' ? 0 : parseInt(scopeVal, 10);
            const skipOther = skipOtherCheckbox ? skipOtherCheckbox.checked : false;

            const payload = {
                source_ids: [selectedSourceId],
                custom_mapping: activeMappings[selectedSourceId] || {},
                skip_other: skipOther,
                max_samples: maxSamples,
                generate_thumbnails: true
            };

            try {
                startBtn.disabled = true;
                if (footerHint) footerHint.innerText = window.t ? window.t('import.starting_bg') : 'Starte Import im Hintergrund...';

                const res = await fetch('/api/dataset/import/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.detail || 'Fehler beim Starten');
                }

                setRunningUI(true);
                startPolling();
            } catch (err) {
                const errPrefix = window.t ? window.t('autolabel.error_prefix', { error: '' }) : 'Fehler: ';
                alert(errPrefix + err.message);
                startBtn.disabled = false;
                if (footerHint) footerHint.innerText = window.t ? window.t('import.start_error') : 'Fehler beim Starten des Imports.';
            }
        });
    }

    // Abort Execution
    if (abortBtn) {
        abortBtn.addEventListener('click', async () => {
            if (!confirm(window.t ? window.t('import.confirm_abort') : 'Möchten Sie den laufenden Import wirklich abbrechen? Bereits importierte Bilder bleiben erhalten.')) {
                return;
            }
            abortBtn.disabled = true;
            if (footerHint) footerHint.innerText = window.t ? window.t('import.sending_abort') : 'Sende Abbruch-Signal...';
            try {
                await fetch('/api/dataset/import/abort', { method: 'POST' });
            } catch (e) {
                console.error('Fehler beim Abbrechen:', e);
            }
        });
    }

    // Polling Status
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(pollImportStatus, 600);
        pollImportStatus();
    }

    async function pollImportStatus() {
        try {
            const res = await fetch('/api/dataset/import/status');
            if (!res.ok) return;
            const state = await res.json();
            updateProgressUI(state);

            if (state.status !== 'running') {
                clearInterval(pollInterval);
                pollInterval = null;
                setRunningUI(false);
                onImportFinished(state);
            }
        } catch (e) {
            console.error('Status polling error:', e);
        }
    }

    function updateProgressUI(state) {
        const pct = Math.max(0, Math.min(100, Math.round(state.progress_pct || 0)));
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressCounter) progressCounter.textContent = `${state.current || 0} / ${state.total || 0}`;
        if (statImported) statImported.textContent = state.imported_images || 0;
        if (statBoxes) statBoxes.textContent = state.imported_boxes || 0;
        if (statSkipped) statSkipped.textContent = state.skipped_boxes || 0;

        if (progressStatus) {
            if (state.status === 'running') {
                const file = state.current_file ? ` (${state.current_file})` : '';
                progressStatus.textContent = window.t
                    ? window.t('import.importing_status', { dataset: state.current_dataset || '', file, pct })
                    : `Importiere ${state.current_dataset || ''}${file}... ${pct}%`;
                progressStatus.style.color = 'var(--text)';
            } else if (state.status === 'completed') {
                progressStatus.textContent = window.t
                    ? window.t('import.completed_status', { images: state.imported_images, boxes: state.imported_boxes })
                    : `Import abgeschlossen (${state.imported_images} Bilder, ${state.imported_boxes} Boxen)`;
                progressStatus.style.color = '#10b981';
            } else if (state.status === 'aborted') {
                progressStatus.textContent = window.t
                    ? window.t('import.aborted_status', { images: state.imported_images })
                    : `Import abgebrochen (${state.imported_images} Bilder übernommen)`;
                progressStatus.style.color = '#f59e0b';
            } else if (state.status === 'failed') {
                progressStatus.textContent = window.t
                    ? window.t('import.failed_prefix', { error: state.error || 'Unbekannter Fehler' })
                    : `Import fehlgeschlagen: ${state.error || 'Unbekannter Fehler'}`;
                progressStatus.style.color = '#ef4444';
            }
        }
    }

    function setRunningUI(running) {
        isImporting = running;
        if (progressContainer) {
            progressContainer.style.display = running || (progressBar && progressBar.style.width !== '0%') ? 'flex' : 'none';
        }
        if (startBtn) {
            startBtn.style.display = running ? 'none' : 'inline-block';
            startBtn.disabled = running;
        }
        if (abortBtn) {
            abortBtn.style.display = running ? 'inline-block' : 'none';
            abortBtn.disabled = !running;
        }
        if (cancelBtn) {
            cancelBtn.textContent = running
                ? (window.t ? window.t('import.btn_background') : 'Im Hintergrund')
                : (window.t ? window.t('import.close_btn') : 'Schließen');
        }
        if (footerHint) {
            footerHint.innerText = running
                ? (window.t ? window.t('import.running_hint') : 'Import läuft asynchron. Sie können dieses Fenster schließen.')
                : (window.t ? window.t('import.idle_hint') : 'Konvertiert Bounding-Boxen & bereitet Thumbnails vor.');
        }
    }

    function onImportFinished(state) {
        // Datensatz-Galerie und Studio-Status automatisch aktualisieren
        if (typeof loadDatasetGallery === 'function') {
            loadDatasetGallery(true);
        }
        // Header-Counter aktualisieren
        fetch('/api/dataset/stats')
            .then(r => r.json())
            .then(stats => {
                const badgeText = typeof window.formatDatasetBadge === 'function'
                    ? window.formatDatasetBadge(stats.train_images, stats.val_images, stats.total_annotations)
                    : `Datensatz: ${stats.train_images} Train • ${stats.val_images} Val (${stats.total_annotations} Boxen)`;
                const headerText = document.getElementById('header-dataset-text');
                if (headerText) {
                    headerText.innerText = badgeText;
                } else {
                    const badge = document.getElementById('dataset-counter-badge');
                    if (badge) {
                        badge.innerText = badgeText;
                    }
                }
            })
            .catch(() => {});
    }

    // Sofortige Neu-Übersetzung bei Sprachwechsel
    window.addEventListener('languageChanged', () => {
        if (availableSources && availableSources.length > 0) {
            renderSourcesCards();
            renderMappingTable();
        }
    });
})();

