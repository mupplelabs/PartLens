// =====================================================================
// BOUNDING BOXES INTERACTION, OBJECTS LIST, QUICK TAGS & SHORTCUTS
// =====================================================================

// =====================================================================
// KLASSEN-SCHNELLAUSWAHL BAR (1-Click & Keyboard 1-9)
// =====================================================================
function renderClassQuickBar() {
    const bar = document.getElementById('class-quick-bar');
    if (!bar) return;
    const headerText = window.t ? window.t('studio.class_header') : 'Klasse:';
    const classes = (typeof knownDatasetClasses !== 'undefined' && Array.isArray(knownDatasetClasses)) ? knownDatasetClasses : [];

    const selBox = (typeof getSelectedComponentBox === 'function') ? getSelectedComponentBox() : null;
    const activeClass = selBox ? selBox.label : (typeof boxClassSelect !== 'undefined' && boxClassSelect && boxClassSelect.value ? boxClassSelect.value : 'ic');

    let html = `<span style="font-size: 0.7rem; font-weight: 700; color: var(--muted); text-transform: uppercase; margin-right: 4px;" data-i18n="studio.class_header">${headerText}</span>`;

    classes.forEach((c, idx) => {
        const isActive = (c === activeClass);
        const color = (typeof getClassColor === 'function') ? getClassColor(c) : '#3b82f6';
        const shortcut = (idx < 9) ? `<span style="opacity: 0.6; font-size: 0.68rem;">(${idx + 1})</span>` : '';
        const i18nKey = `classes.${c}_chip`;
        const labelText = window.t ? window.t(i18nKey) : c;
        html += `
            <button class="class-quick-chip ${isActive ? 'active' : ''}" data-class="${c}" style="color: ${color};">
                <span class="class-dot"></span> <span data-i18n="${i18nKey}">${labelText}</span> ${shortcut}
            </button>
        `;
    });
    bar.innerHTML = html;
    bindClassQuickBarEvents();
}
window.renderClassQuickBar = renderClassQuickBar;

function bindClassQuickBarEvents() {
    const chips = document.querySelectorAll('.class-quick-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const chosenClass = chip.getAttribute('data-class');
            if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
                applyClassToBox(selectedBoxIndex, chosenClass);
            } else {
                if (typeof boxClassSelect !== 'undefined' && boxClassSelect) boxClassSelect.value = chosenClass;
                chips.forEach(c => c.classList.toggle('active', c === chip));
                const statusEl = document.getElementById('autolabel-status');
                if (statusEl) statusEl.innerText = `Standard-Klasse für neue Boxen auf '${chosenClass}' gesetzt.`;
            }
        });
    });
}

// Tastatur-Kürzel 1-9 zum sofortigen Ändern der Klasse der gewählten Box bzw. Vorbelegung
window.addEventListener('keydown', (e) => {
    const isTyping = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (isTyping) return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
        const chips = Array.from(document.querySelectorAll('.class-quick-chip'));
        if (chips[num - 1]) {
            e.preventDefault();
            chips[num - 1].click();
        }
    }
});

function updateQuickPaletteActiveState() {
    const selBox = (typeof getSelectedComponentBox === 'function') ? getSelectedComponentBox() : null;
    const chips = document.querySelectorAll('.class-quick-chip');
    chips.forEach(chip => {
        const c = chip.getAttribute('data-class');
        if (selBox && selBox.label === c) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });
}

renderClassQuickBar();

// =====================================================================
// CVAT / V7 STYLE OBJEKTE-LISTE (Inspector Tab 0)
// =====================================================================
function renderObjectsList() {
    const countBadge = document.getElementById('objects-count-badge');
    const emptyEl = document.getElementById('objects-list-empty');
    const listEl = document.getElementById('objects-items-list');
    if (countBadge) countBadge.innerText = detectedBoxes.length;

    const mobileInfoBadge = document.getElementById('mobile-info-count-badge');
    if (mobileInfoBadge) {
        mobileInfoBadge.textContent = detectedBoxes.length;
        mobileInfoBadge.style.display = detectedBoxes.length > 0 ? 'inline-flex' : 'none';
    }

    if (!listEl || !emptyEl) return;

    if (detectedBoxes.length === 0) {
        emptyEl.style.display = 'block';
        listEl.style.display = 'none';
        listEl.innerHTML = '';
        return;
    }

    emptyEl.style.display = 'none';
    listEl.style.display = 'flex';
    listEl.innerHTML = '';

    detectedBoxes.forEach((b, idx) => {
        const row = document.createElement('div');
        row.className = `object-item-row ${idx === selectedBoxIndex ? 'active' : ''}`;
        row.dataset.idx = idx;

        const color = (typeof getClassColor === 'function') ? getClassColor(b.label) : '#3b82f6';
        const metaParts = [];
        if (b.footprint) metaParts.push(b.footprint);
        if (b.partMarking) metaParts.push(b.partMarking);
        const bw = Math.abs(b.x2 - b.x1);
        const bh = Math.abs(b.y2 - b.y1);
        if (metaParts.length === 0 && bw > 0) metaParts.push(`${bw}×${bh}px`);
        const metaStr = metaParts.join(' · ');

        const rawLabel = b.label || 'other';
        let displayLabel = rawLabel;
        if (window.t) {
            const loc = window.t('classes.' + rawLabel);
            if (loc && loc !== rawLabel && !loc.startsWith('classes.')) {
                displayLabel = loc;
            }
        }
        const noMarkingText = window.t ? window.t('studio.no_marking') : 'Keine Markierung';
        const detailsText = window.t ? window.t('studio.tab_details') : 'Details';

        const confStr = b.confidence !== undefined ? `${Math.round(b.confidence * 100)}%` : '';

        row.innerHTML = `
            <div class="object-item-left">
                <span class="object-item-badge" style="background: ${color};">#${idx + 1}</span>
                <div class="object-item-info">
                    <span class="object-item-label">${displayLabel}</span>
                    <span class="object-item-meta">${metaStr || noMarkingText}</span>
                </div>
            </div>
            <div class="object-item-actions">
                ${confStr ? `<span style="font-size: 0.68rem; color: var(--muted); margin-right: 2px;">${confStr}</span>` : ''}
                <button type="button" class="object-item-btn btn-inspect-jump" title="Details &amp; OCR aufrufen" style="display: inline-flex; align-items: center; gap: 3px;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <span>${detailsText}</span>
                </button>
                <button type="button" class="object-item-btn btn-delete-item" title="${window.t ? window.t('boxes.delete_title') : 'Bauteil löschen'}">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        `;

        // Hover-Highlight auf dem Canvas
        row.addEventListener('mouseenter', () => {
            hoveredBoxIndex = idx;
            drawBboxOverlay();
        });
        row.addEventListener('mouseleave', () => {
            hoveredBoxIndex = -1;
            drawBboxOverlay();
        });

        // Klick selektiert Box
        row.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-item') || e.target.closest('.btn-inspect-jump')) return;
            selectComponentBox(idx, true);
        });

        // Doppelklick oder Klick auf "Details" wechselt zum Inspector Tab
        const jumpBtn = row.querySelector('.btn-inspect-jump');
        if (jumpBtn) {
            jumpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectComponentBox(idx, true);
                const inspectTabBtn = document.querySelector('.inspector-tab-btn[data-tab="tab-inspect"]');
                if (inspectTabBtn) inspectTabBtn.click();
            });
        }
        row.addEventListener('dblclick', () => {
            selectComponentBox(idx, true);
            const inspectTabBtn = document.querySelector('.inspector-tab-btn[data-tab="tab-inspect"]');
            if (inspectTabBtn) inspectTabBtn.click();
        });

        // Löschen Button
        const delBtn = row.querySelector('.btn-delete-item');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                detectedBoxes.splice(idx, 1);
                selectedBoxIndex = detectedBoxes.length > 0 ? Math.min(idx, detectedBoxes.length - 1) : -1;
                drawBboxOverlay();
                renderStage0Chips();
                renderObjectsList();
                updateStage0CropPreview();
                updateBoxEditBar();
            });
        }

        listEl.appendChild(row);
    });
}
window.renderObjectsList = renderObjectsList;

const btnSelectAllObj = document.getElementById('btn-select-all-objects');
if (btnSelectAllObj) {
    btnSelectAllObj.addEventListener('click', () => {
        selectComponentBox(-1, true);
    });
}

const btnBackToObjects = document.getElementById('btn-back-to-objects');
if (btnBackToObjects) {
    btnBackToObjects.addEventListener('click', () => {
        const objTabBtn = document.querySelector('.inspector-tab-btn[data-tab="tab-objects"]');
        if (objTabBtn) objTabBtn.click();
    });
}

// =====================================================================
// ROBOFLOW STYLE FLOATING CANVAS QUICK-TAG POPOVER
// =====================================================================
const quickTagPopover = document.getElementById('canvas-quick-tag-popover');
const popoverTag = document.getElementById('popover-box-tag');
const popoverCloseBtn = document.getElementById('btn-popover-close');
const popoverClassSelect = document.getElementById('popover-class-select');
const popoverDelBtn = document.getElementById('popover-del-btn');
const popoverClassBtns = document.querySelectorAll('.popover-class-btn');

function populatePopoverClassSelect() {
    if (!popoverClassSelect) return;
    const currentVal = popoverClassSelect.value;
    popoverClassSelect.innerHTML = '';
    const classList = (typeof knownDatasetClasses !== 'undefined' && Array.isArray(knownDatasetClasses)) ? knownDatasetClasses : [
        'resistor', 'capacitor', 'inductor', 'diode', 'led',
        'transistor', 'ic', 'potentiometer', 'switch_button',
        'relay', 'connector', 'display', 'board', 'other'
    ];
    classList.forEach(c => {
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
        popoverClassSelect.appendChild(opt);
    });
    if (currentVal) popoverClassSelect.value = currentVal;
}

if (popoverClassSelect) {
    populatePopoverClassSelect();
    popoverClassSelect.addEventListener('change', () => {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            applyClassToBox(selectedBoxIndex, popoverClassSelect.value);
            closeQuickTagPopover();
        }
    });
}

window.addEventListener('languageChanged', () => {
    populatePopoverClassSelect();
    if (typeof renderClassQuickBar === 'function') {
        renderClassQuickBar();
    }
    if (typeof renderObjectsList === 'function') {
        renderObjectsList();
    }
});

function openQuickTagPopoverAt(clientX, clientY, boxIdx) {
    if (!quickTagPopover) return;
    if (boxIdx < 0 || boxIdx >= detectedBoxes.length) return;
    selectedBoxIndex = boxIdx;
    const box = detectedBoxes[boxIdx];
    
    if (popoverTag) {
        const color = (typeof getClassColor === 'function') ? getClassColor(box.label) : '#3b82f6';
        popoverTag.innerHTML = `<span class="class-dot" style="background:${color};"></span> #${boxIdx + 1} ${box.label || 'Box'}`;
    }
    if (popoverClassSelect) {
        popoverClassSelect.value = box.label || 'ic';
    }

    popoverClassBtns.forEach(btn => {
        const c = btn.getAttribute('data-class');
        btn.classList.toggle('active', c === box.label);
    });

    const pw = 250;
    const ph = 190;
    let left = clientX + 10;
    let top = clientY - 30;
    if (left + pw > window.innerWidth - 10) left = Math.max(10, clientX - pw - 10);
    if (top + ph > window.innerHeight - 10) top = Math.max(60, window.innerHeight - ph - 10);
    if (top < 60) top = 60;
    if (left < 10) left = 10;

    quickTagPopover.style.left = `${left}px`;
    quickTagPopover.style.top = `${top}px`;
    quickTagPopover.style.display = 'block';
}
window.openQuickTagPopoverAt = openQuickTagPopoverAt;

function closeQuickTagPopover() {
    if (quickTagPopover) quickTagPopover.style.display = 'none';
}
window.closeQuickTagPopover = closeQuickTagPopover;

if (popoverCloseBtn) {
    popoverCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        closeQuickTagPopover();
    });
}

if (popoverDelBtn) {
    popoverDelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            detectedBoxes.splice(selectedBoxIndex, 1);
            selectedBoxIndex = detectedBoxes.length > 0 ? Math.min(selectedBoxIndex, detectedBoxes.length - 1) : -1;
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            updateStage0CropPreview();
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
            closeQuickTagPopover();
        }
    });
}

popoverClassBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cls = btn.getAttribute('data-class');
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            applyClassToBox(selectedBoxIndex, cls);
            closeQuickTagPopover();
        }
    });
});

function applyClassToBox(idx, cls) {
    if (idx < 0 || idx >= detectedBoxes.length) return;
    detectedBoxes[idx].label = cls;
    detectedBoxes[idx].kind = (cls === 'ic' || cls === 'transistor' || cls === 'diode' || cls === 'led') ? 'semiconductor' : (cls === 'resistor' ? 'resistor' : 'other');
    if (typeof boxClassSelect !== 'undefined' && boxClassSelect) {
        boxClassSelect.value = cls;
    }
    
    // Kontext-sensitive Rechner für Widerstände
    const isResistor = (cls === 'resistor');
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
    updateStage0CropPreview();
    if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
    if (typeof updateQuickPaletteActiveState === 'function') updateQuickPaletteActiveState();
}
window.applyClassToBox = applyClassToBox;

// Schließen des Popovers bei Klick außerhalb oder Escape
window.addEventListener('pointerdown', (e) => {
    if (quickTagPopover && quickTagPopover.style.display === 'block') {
        if (!e.target.closest('#canvas-quick-tag-popover')) {
            closeQuickTagPopover();
        }
    }
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeQuickTagPopover();
    }
});

// =====================================================================
// DATENSATZ-SPLIT TOGGLE (Train / Val)
// =====================================================================
const splitPillBtns = document.querySelectorAll('.split-pill-btn');
splitPillBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const s = btn.getAttribute('data-split');
        splitPillBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (typeof datasetSplit !== 'undefined' && datasetSplit) datasetSplit.value = s;
    });
});

// =====================================================================
// BILD UM 90° DREHEN
// =====================================================================
const rotateImageBtn = document.getElementById('rotate-image-btn');
if (rotateImageBtn) {
    rotateImageBtn.addEventListener('click', () => {
        const { el: sourceEl, w: srcW, h: srcH, ready } = getActiveMediaSource();
        if (!ready) return;
        const c = document.createElement('canvas');
        c.width = srcH;
        c.height = srcW;
        const cx = c.getContext('2d');
        cx.translate(srcH / 2, srcW / 2);
        cx.rotate(90 * Math.PI / 180);
        cx.drawImage(sourceEl, -srcW / 2, -srcH / 2);
        
        suppressAutoStage0 = true;
        // Aktualisiere das Preview-Image
        previewImage.src = c.toDataURL('image/jpeg', 0.95);
        previewImage.onload = () => {
            suppressAutoStage0 = false;
            // Boxen rotieren (x' = h - y, y' = x)
            detectedBoxes = detectedBoxes.map(b => {
                const newX1 = srcH - b.y2;
                const newY1 = b.x1;
                const newX2 = srcH - b.y1;
                const newY2 = b.x2;
                return {
                    ...b,
                    x1: newX1, y1: newY1, x2: newX2, y2: newY2,
                    ocrX1: newX1, ocrY1: newY1, ocrX2: newX2, ocrY2: newY2
                };
            });
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            updateStage0CropPreview();
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
        };
    });
}

// Alle Boxen leeren
const clearBoxesBtn = document.getElementById('clear-boxes-btn');
if (clearBoxesBtn) {
    clearBoxesBtn.addEventListener('click', () => {
        if (detectedBoxes.length === 0) return;
        if (confirm('Möchtest du alle ' + detectedBoxes.length + ' Bounding Boxes im aktuellen Bild entfernen?')) {
            detectedBoxes = [];
            selectedBoxIndex = -1;
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            if (typeof closeQuickTagPopover === 'function') closeQuickTagPopover();
            updateStage0CropPreview();
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
            const statusEl = document.getElementById('autolabel-status');
            if (statusEl) statusEl.innerText = 'Alle Bounding Boxes entfernt.';
        }
    });
}

// Schnelltest Dropdown
const quickSampleSelect = document.getElementById('quick-sample-select');
if (quickSampleSelect) {
    quickSampleSelect.addEventListener('change', () => {
        let val = quickSampleSelect.value;
        if (!val) return;
        if (val.startsWith('../')) {
            val = '/studies/' + val.replace(/^\.\.\//, '');
        }
        if (val.includes('4xDIP14_zuviel_Licht')) {
            val = '/studies/4xDIP14_zuviel_Licht.jpeg';
        } else if (val.includes('4xDIP14_teils')) {
            val = '/studies/4xDIP14_teils_im_schatten.jpeg';
        }
        val = encodeURI(val);
        if (currentMode !== 'upload' && tabUpload) {
            tabUpload.click();
        }
        const sampleBtn = document.querySelector(`.sample-btn[data-src="${val}"]`);
        if (sampleBtn) {
            sampleBtn.click();
        } else {
            if (previewImage.getAttribute('src') === val && previewImage.complete && previewImage.naturalWidth) {
                resetStageZoomPan();
                runStage0Detection();
            } else {
                previewImage.src = val;
            }
        }
    });
}

// Part Marking Input Sync
const partMarkingInput = document.getElementById('part-marking-input');
if (partMarkingInput) {
    partMarkingInput.addEventListener('input', () => {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            detectedBoxes[selectedBoxIndex].partMarking = partMarkingInput.value.trim();
        }
    });
}

// Nächste Box Button
const nextBoxBtn = document.getElementById('next-box-btn');
if (nextBoxBtn) {
    nextBoxBtn.addEventListener('click', () => {
        if (detectedBoxes.length === 0) return;
        const nextIdx = (selectedBoxIndex + 1) % detectedBoxes.length;
        selectComponentBox(nextIdx, true);
    });
}

// =====================================================================
// FOKUS / ISOLIEREN MODUS (Nicht ausgewählte Boxen ausblenden)
// =====================================================================
function toggleIsolateSelectedBox() {
    isolateSelectedBox = !isolateSelectedBox;
    updateIsolateButtonUI();
    drawBboxOverlay();
}
window.toggleIsolateSelectedBox = toggleIsolateSelectedBox;

function updateIsolateButtonUI() {
    const btnTool = document.getElementById('toggle-isolate-box-btn');
    const btnObj = document.getElementById('btn-toggle-isolate-objects');
    const btnHud = document.getElementById('stage-isolate-box-btn');
    const labelObj = document.getElementById('isolate-btn-label');

    const titleText = isolateSelectedBox
        ? (window.t ? window.t('boxes.focus_active') : 'Fokus aktiv: Nicht ausgewählte Boxen sind ausgeblendet (Taste: F)')
        : (window.t ? window.t('boxes.focus_inactive') : 'Fokus: Nicht ausgewählte Boxen ausblenden (Taste: F)');

    [btnTool, btnObj, btnHud].forEach(btn => {
        if (btn) {
            btn.classList.toggle('active', isolateSelectedBox);
            btn.setAttribute('aria-pressed', isolateSelectedBox ? 'true' : 'false');
            btn.title = titleText;
        }
    });

    if (labelObj) {
        labelObj.textContent = isolateSelectedBox
            ? (window.t ? window.t('boxes.focus_on') : 'Fokus an')
            : (window.t ? window.t('boxes.focus') : 'Fokus');
    }
}
window.updateIsolateButtonUI = updateIsolateButtonUI;

const btnToggleIsolateTool = document.getElementById('toggle-isolate-box-btn');
if (btnToggleIsolateTool) {
    btnToggleIsolateTool.addEventListener('click', toggleIsolateSelectedBox);
}

const btnToggleIsolateObj = document.getElementById('btn-toggle-isolate-objects');
if (btnToggleIsolateObj) {
    btnToggleIsolateObj.addEventListener('click', toggleIsolateSelectedBox);
}

const btnToggleIsolateHud = document.getElementById('stage-isolate-box-btn');
if (btnToggleIsolateHud) {
    btnToggleIsolateHud.addEventListener('click', toggleIsolateSelectedBox);
}

