// =====================================================================
// FOOTPRINT PREVIEW & PICKER CONTROLLER (KiCad 3D & Autonomer CDN Cache)
// =====================================================================
(function initFootprintSystem() {
    const fpModal = document.getElementById('footprint-picker-modal');
    const openFpBtn = document.getElementById('open-footprint-picker-btn');
    const closeFpBtn = document.getElementById('btn-close-fp-modal');
    const cancelFpBtn = document.getElementById('btn-cancel-fp-modal');
    const fpSearchInput = document.getElementById('fp-picker-search');
    const fpGrid = document.getElementById('footprint-picker-grid');
    const fpCounter = document.getElementById('fp-modal-counter');
    const cacheStatusEl = document.getElementById('fp-modal-cache-status');
    const syncBtn = document.getElementById('btn-sync-fp-modal');
    const fpFilterChips = document.querySelectorAll('#fp-filter-chips .btn-filter-pill');
    const commonFootprintsDatalist = document.getElementById('common-footprints-list');

    const card = document.getElementById('footprint-preview-card');
    const img = document.getElementById('footprint-preview-img');
    const nameEl = document.getElementById('footprint-preview-name');
    const subEl = document.getElementById('footprint-preview-sub');

    let footprintIndexByName = new Map();
    let currentFpFilterClass = 'context';
    let fpSearchTimeout = null;

    async function updateFootprintStatus() {
        if (!cacheStatusEl) return;
        try {
            const res = await fetch('/api/footprints/status');
            if (!res.ok) return;
            const data = await res.json();
            cacheStatusEl.innerText = `${data.cached_count} gecacht (${data.cached_size_kb} KB) / ${data.indexed_count} im Katalog`;
        } catch (e) {
            cacheStatusEl.innerText = 'Offline: lokal bereit';
        }
    }


    // Footprint Suche per API
    async function fetchFootprintsCatalog(cls = null, search = '') {
        try {
            let url = '/api/footprints/list?limit=250';
            if (cls && cls !== 'all') {
                url += `&class_name=${encodeURIComponent(cls)}`;
            }
            if (search && search.trim()) {
                url += `&search=${encodeURIComponent(search.trim())}`;
            }
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            return data.footprints || [];
        } catch (err) {
            console.error('Fehler beim Laden des Footprint-Katalogs:', err);
            return [];
        }
    }

    // Datalist beim Start mit populären Footprints vorab befüllen
    fetchFootprintsCatalog('all', '')
        .then(fps => {
            if (fps && commonFootprintsDatalist) {
                fps.forEach(f => {
                    const nameLower = f.name.toLowerCase();
                    const fullLower = f.full_name.toLowerCase();
                    footprintIndexByName.set(nameLower, f);
                    footprintIndexByName.set(fullLower, f);
                    (f.matched_classes || []).forEach(c => {
                        footprintIndexByName.set(`${c}:${nameLower}`, f);
                        footprintIndexByName.set(`${c}:${fullLower}`, f);
                    });
                });
                const popularNames = Array.from(new Set(fps.map(f => f.name))).slice(0, 40);
                commonFootprintsDatalist.innerHTML = popularNames.map(n => `<option value="${n}">`).join('');
            }
        })
        .catch(() => {});

    updateFootprintStatus();

    // Aktualisiert die visuelle Preview-Karte in der Seitenleiste

    window.updateBoxFootprintPreview = async function(fpName, fpPath = null, fpSub = null) {
        if (!card || !img || !nameEl) return;

        if (!fpName || !fpName.trim()) {
            card.style.display = 'none';
            return;
        }

        const cleanName = fpName.trim();
        const b = (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) ? detectedBoxes[selectedBoxIndex] : null;
        const normClass = getNormalizedClass(b ? b.label : (boxClassSelect ? boxClassSelect.value : 'ic'));
        const classKey = `${normClass}:${cleanName.toLowerCase()}`;

        // 1. Direkt gegebener Pfad (z.B. durch Klick auf Kachel im Modal)
        if (fpPath) {
            if (b) {
                b.footprint = cleanName;
                b.footprintPath = fpPath;
                const fpInp = document.getElementById('box-footprint-input');
                if (fpInp) fpInp.value = cleanName;
            }
            img.src = `/api/footprints/image?path=${encodeURIComponent(fpPath)}`;
            img.alt = cleanName;
            nameEl.innerText = cleanName;
            subEl.innerText = fpSub || 'Footprint';
            card.style.display = 'flex';
            const directObj = { name: cleanName, full_name: cleanName, path: fpPath, subcategory: fpSub || '', matched_classes: [normClass] };
            footprintIndexByName.set(classKey, directObj);
            footprintIndexByName.set(cleanName.toLowerCase(), directObj);
            return;
        }

        // 2. Gespeicherter Pfad aus Bounding-Box Objekt
        if (b && b.footprintPath && b.footprint && b.footprint.toLowerCase() === cleanName.toLowerCase()) {
            img.src = `/api/footprints/image?path=${encodeURIComponent(b.footprintPath)}`;
            img.alt = b.footprint;
            nameEl.innerText = b.footprint;
            subEl.innerText = 'Footprint';
            card.style.display = 'flex';
            const fpInp = document.getElementById('box-footprint-input');
            if (fpInp && fpInp.value && fpInp.value.trim().toLowerCase() === b.footprint.toLowerCase()) {
                fpInp.value = b.footprint;
            }
            return;
        }

        // 3. Lokalen Cache prüfen
        let fp = footprintIndexByName.get(classKey);
        if (!fp) {
            const fallbackFp = footprintIndexByName.get(cleanName.toLowerCase());
            if (fallbackFp && fallbackFp.matched_classes && fallbackFp.matched_classes.includes(normClass)) {
                fp = fallbackFp;
            }
        }

        // 4. API-Abfrage mit Klassen-Filterung
        if (!fp) {
            const results = await fetchFootprintsCatalog(normClass, cleanName);
            if (results && results.length > 0) {
                fp = results.find(f => (f.matched_classes && f.matched_classes.includes(normClass)) && (f.name.toLowerCase() === cleanName.toLowerCase() || f.full_name.toLowerCase() === cleanName.toLowerCase()))
                     || results.find(f => f.matched_classes && f.matched_classes.includes(normClass))
                     || results[0];
                if (fp) {
                    footprintIndexByName.set(classKey, fp);
                    footprintIndexByName.set(cleanName.toLowerCase(), fp);
                }
            }
        }

        if (fp && fp.path) {
            if (b) {
                b.footprintPath = fp.path;
                if (fp.name) {
                    b.footprint = fp.name;
                    const fpInp = document.getElementById('box-footprint-input');
                    if (fpInp && fpInp.value && fpInp.value.trim().toLowerCase() === fp.name.toLowerCase()) {
                        fpInp.value = fp.name;
                    }
                }
            }
            img.src = `/api/footprints/image?path=${encodeURIComponent(fp.path)}`;
            img.alt = fp.name;
            nameEl.innerText = fp.name;
            subEl.innerText = fp.subcategory || fp.category || 'Footprint';
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    };

    function getNormalizedClass(raw) {
        if (!raw) return 'ic';
        const c = raw.toLowerCase();
        if (c.includes('ic') || c.includes('chip') || c.includes('dip') || c.includes('mcu')) return 'ic';
        if (c.includes('resistor') || c.includes('widerstand')) return 'resistor';
        if (c.includes('capacit') || c.includes('kondensator') || c.includes('elko')) return 'capacitor';
        if (c.includes('led')) return 'led';
        if (c.includes('diode')) return 'diode';
        if (c.includes('transistor') || c.includes('mosfet') || c.includes('bjt')) return 'transistor';
        if (c.includes('connector') || c.includes('header') || c.includes('pin')) return 'connector';
        if (c.includes('switch') || c.includes('button') || c.includes('taster')) return 'switch_button';
        if (c.includes('relay') || c.includes('relais')) return 'relay';
        if (c.includes('potentiometer') || c.includes('poti') || c.includes('trimmer')) return 'potentiometer';
        if (c.includes('display') || c.includes('oled') || c.includes('lcd')) return 'display';
        return 'ic';
    }

    function getDisplayClassName(norm) {
        const map = {
            ic: 'ICs',
            resistor: 'Widerstände',
            capacitor: 'Kondensatoren',
            diode: 'Dioden',
            led: 'LEDs',
            transistor: 'Transistoren',
            connector: 'Steckverbinder',
            switch_button: 'Schalter',
            relay: 'Relais',
            potentiometer: 'Potis',
            display: 'Displays'
        };
        return map[norm] || norm.toUpperCase();
    }

    // Modal öffnen
    if (openFpBtn) {
        openFpBtn.addEventListener('click', () => {
            const modal = document.getElementById('footprint-picker-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            // Kontext-Klasse der aktuell gewählten Box ermitteln
            const b = (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) ? detectedBoxes[selectedBoxIndex] : null;
            const normClass = getNormalizedClass(b ? b.label : 'ic');

            // Chip "Passend zur Klasse" beschriften
            const contextChip = document.querySelector('#fp-filter-chips [data-class="context"]');
            if (contextChip) {
                contextChip.textContent = `Passend zu ${getDisplayClassName(normClass)}`;
            }

            // Aktiven Chip zurücksetzen
            fpFilterChips.forEach(c => c.classList.remove('active'));
            if (contextChip) contextChip.classList.add('active');
            currentFpFilterClass = 'context';

            if (fpSearchInput) fpSearchInput.value = '';

            updateFootprintStatus();
            loadAndRenderFootprints();
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            const origText = syncBtn.textContent;
            syncBtn.textContent = 'Syncing...';
            if (cacheStatusEl) cacheStatusEl.innerText = 'Lade KiCad-Katalog & Bilder herunter...';
            try {
                const res = await fetch('/api/footprints/sync', { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    if (cacheStatusEl) {
                        cacheStatusEl.innerText = `${data.preloaded} Core-Footprints offline (${data.indexed} gesamt)`;
                    }
                    await loadAndRenderFootprints();
                } else {
                    if (cacheStatusEl) cacheStatusEl.innerText = 'Sync fehlgeschlagen';
                }
            } catch (err) {
                console.error('Fehler beim Footprint-Sync:', err);
                if (cacheStatusEl) cacheStatusEl.innerText = 'Netzwerkfehler';
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = origText;
                await updateFootprintStatus();
            }
        });
    }

    function closeFpModal() {
        const modal = document.getElementById('footprint-picker-modal');
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    if (closeFpBtn) closeFpBtn.addEventListener('click', closeFpModal);
    if (cancelFpBtn) cancelFpBtn.addEventListener('click', closeFpModal);


    // Delegiertes Schließen für Modal, Close-Buttons & Backdrop
    const modalEl = document.getElementById('footprint-picker-modal');
    if (modalEl) {
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl || e.target.closest('#btn-close-fp-modal') || e.target.closest('#btn-cancel-fp-modal')) {
                closeFpModal();
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        const modal = document.getElementById('footprint-picker-modal');
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeFpModal();
        }
    });

    // Filter Chips Event-Handler
    fpFilterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            fpFilterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFpFilterClass = chip.getAttribute('data-class');
            loadAndRenderFootprints();
        });
    });

    // Live-Suche mit Debounce
    if (fpSearchInput) {
        fpSearchInput.addEventListener('input', () => {
            clearTimeout(fpSearchTimeout);
            fpSearchTimeout = setTimeout(() => {
                loadAndRenderFootprints();
            }, 250);
        });
    }

    // Footprints laden und Grid befüllen
    async function loadAndRenderFootprints() {
        if (!fpGrid) return;
        fpGrid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 36px 16px; text-align: center; color: var(--muted); font-size: 0.85rem;">
                <div style="margin-bottom: 8px;">
                    <svg class="spin-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
                </div>
                Lade Footprints aus Part-DB / KiCad...
            </div>
        `;

        const b = (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) ? detectedBoxes[selectedBoxIndex] : null;
        const normClass = getNormalizedClass(b ? b.label : 'ic');

        let queryClass = currentFpFilterClass;
        if (queryClass === 'context') {
            queryClass = normClass;
        }

        const searchVal = fpSearchInput ? fpSearchInput.value.trim() : '';
        const footprints = await fetchFootprintsCatalog(queryClass, searchVal);

        if (fpCounter) {
            fpCounter.innerText = `${footprints.length} Footprints gefunden`;
        }

        if (footprints.length === 0) {
            fpGrid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 36px 16px; text-align: center; color: var(--muted); font-size: 0.85rem;">
                    Keine passenden Footprints für diese Auswahl gefunden.
                </div>
            `;
            return;
        }

        const currentBoxFp = (b && b.footprint) ? b.footprint.toLowerCase() : '';
        const currentBoxPath = (b && b.footprintPath) ? b.footprintPath : '';

        fpGrid.innerHTML = footprints.map(f => {
            const isSelected = currentBoxPath
                ? (currentBoxPath === f.path)
                : (currentBoxFp && (currentBoxFp === f.name.toLowerCase() || currentBoxFp === f.full_name.toLowerCase()));
            const imgUrl = `/api/footprints/image?path=${encodeURIComponent(f.path)}`;
            return `
                <div class="footprint-card ${isSelected ? 'selected' : ''}" data-name="${f.name}" data-path="${f.path}" data-sub="${f.subcategory || f.category || ''}">
                    <div class="footprint-card-thumb">
                        <img src="${imgUrl}" alt="${f.name}" loading="lazy" onerror="this.style.opacity='0.25'; this.title='Vorschau nicht verfügbar';" />
                    </div>

                    <div class="footprint-card-name" title="${f.name}">${f.name}</div>
                    <div class="footprint-card-sub" title="${f.subcategory || f.category}">${f.subcategory || f.category}</div>
                </div>
            `;
        }).join('');

        // Click-Handler auf Kacheln
        fpGrid.querySelectorAll('.footprint-card').forEach(cardEl => {
            cardEl.addEventListener('click', () => {
                const fpName = cardEl.getAttribute('data-name');
                const fpPath = cardEl.getAttribute('data-path');
                const fpSub = cardEl.getAttribute('data-sub') || '';

                if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
                    detectedBoxes[selectedBoxIndex].footprint = fpName;
                    detectedBoxes[selectedBoxIndex].footprintPath = fpPath;
                }

                const boxFpInp = document.getElementById('box-footprint-input');
                if (boxFpInp) {
                    boxFpInp.value = fpName;
                }

                window.updateBoxFootprintPreview(fpName, fpPath, fpSub);
                closeFpModal();
            });
        });
    }
})();

