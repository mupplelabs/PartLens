// =====================================================================
// BOUNDING BOXES INTERACTION, OBJECTS LIST, UNIFIED PALETTE & SHORTCUTS
// =====================================================================

// =====================================================================
// UNDO-HISTORIE & TOAST NOTIFICATION (Constraints & Recovery)
// =====================================================================
const boxHistoryStack = [];
const MAX_BOX_HISTORY = 20;

function pushBoxHistorySnapshot(actionDesc = '') {
    try {
        const snapshot = JSON.stringify(detectedBoxes);
        boxHistoryStack.push({
            boxes: snapshot,
            selectedIndex: selectedBoxIndex,
            desc: actionDesc,
            timestamp: Date.now()
        });
        if (boxHistoryStack.length > MAX_BOX_HISTORY) {
            boxHistoryStack.shift();
        }
        if (typeof resetSampleSavedState === 'function') {
            resetSampleSavedState(false);
        }
    } catch (e) {
        console.error('Snapshot error:', e);
    }
}
window.pushBoxHistorySnapshot = pushBoxHistorySnapshot;

function undoLastBoxAction() {
    if (boxHistoryStack.length === 0) {
        if (typeof updateStudioStatus === 'function') {
            const msg = window.t ? window.t('canvas.no_undo') : 'Keine Aktion zum Rückgängigmachen vorhanden.';
            updateStudioStatus(msg, 'ready');
        }
        return false;
    }
    const previous = boxHistoryStack.pop();
    try {
        detectedBoxes = JSON.parse(previous.boxes);
        selectedBoxIndex = previous.selectedIndex;
        if (selectedBoxIndex >= detectedBoxes.length) {
            selectedBoxIndex = detectedBoxes.length - 1;
        }
        drawBboxOverlay();
        renderStage0Chips();
        if (typeof renderObjectsList === 'function') renderObjectsList();
        updateStage0CropPreview();
        if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
        if (typeof closeQuickTagPopover === 'function') closeQuickTagPopover();

        removeUndoToast();
        if (typeof resetSampleSavedState === 'function') {
            resetSampleSavedState(false);
        }
        if (typeof updateStudioStatus === 'function') {
            const desc = previous.desc || 'Box-Aktion';
            const msg = window.t ? window.t('canvas.undo_done', { desc }) : `Rückgängig gemacht: ${desc}.`;
            updateStudioStatus(msg, 'ready');
        }
        return true;
    } catch (e) {
        console.error('Undo restore error:', e);
        return false;
    }
}
window.undoLastBoxAction = undoLastBoxAction;

let activeToastTimeout = null;
function showUndoToast(msg = null) {
    const text = msg || (window.t ? window.t('canvas.box_deleted') : 'Bauteil gelöscht');
    const undoText = window.t ? window.t('canvas.undo_btn') : 'Rückgängig (Cmd+Z)';
    let container = document.getElementById('app-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'app-toast-container';
        container.className = 'app-toast-container';
        document.body.appendChild(container);
    }
    container.innerHTML = `
        <div class="app-toast">
            <span>${text}</span>
            <button type="button" class="app-toast-action" id="btn-toast-undo">${undoText}</button>
        </div>
    `;
    const undoBtn = document.getElementById('btn-toast-undo');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            undoLastBoxAction();
        });
    }
    if (activeToastTimeout) clearTimeout(activeToastTimeout);
    activeToastTimeout = setTimeout(() => {
        removeUndoToast();
    }, 6000);
}
window.showUndoToast = showUndoToast;

function removeUndoToast() {
    const container = document.getElementById('app-toast-container');
    if (container) container.innerHTML = '';
}
window.removeUndoToast = removeUndoToast;

window.addEventListener('keydown', (e) => {
    const isTyping = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (isTyping) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undoLastBoxAction();
    }
});

// =====================================================================
// UNIFIED CLASS CONFIGURATION & HOTKEYS (1–0)
// =====================================================================
let currentPaletteClass = 'ic';
window.currentPaletteClass = currentPaletteClass;

const TOP_HOTKEY_CLASSES = [
    { key: '1', classId: 'ic', labelKey: 'classes.ic_chip', defaultLabel: 'IC', color: '#3b82f6' },
    { key: '2', classId: 'resistor', labelKey: 'classes.resistor_chip', defaultLabel: 'Widerstand', color: '#f59e0b' },
    { key: '3', classId: 'capacitor', labelKey: 'classes.capacitor_chip', defaultLabel: 'Kondensator', color: '#8b5cf6' },
    { key: '4', classId: 'transistor', labelKey: 'classes.transistor_chip', defaultLabel: 'Transistor', color: '#10b981' },
    { key: '5', classId: 'diode', labelKey: 'classes.diode_chip', defaultLabel: 'Diode', color: '#ec4899' },
    { key: '6', classId: 'led', labelKey: 'classes.led_chip', defaultLabel: 'LED', color: '#ef4444' },
    { key: '7', classId: 'inductor', labelKey: 'classes.inductor_chip', defaultLabel: 'Induktor', color: '#06b6d4' },
    { key: '8', classId: 'potentiometer', labelKey: 'classes.potentiometer_chip', defaultLabel: 'Poti', color: '#d97706' },
    { key: '9', classId: 'switch_button', labelKey: 'classes.switch_button_chip', defaultLabel: 'Schalter', color: '#a855f7' },
    { key: '0', classId: 'relay', labelKey: 'classes.relay_chip', defaultLabel: 'Relais', color: '#e11d48' }
];

const SECONDARY_CLASSES = [
    { classId: 'connector', labelKey: 'classes.connector_chip', defaultLabel: 'Stecker', color: '#14b8a6' },
    { classId: 'display', labelKey: 'classes.display_chip', defaultLabel: 'Display', color: '#0ea5e9' },
    { classId: 'board_mcu_stick', labelKey: 'classes.board_mcu_stick_chip', defaultLabel: 'MCU-Stick', color: '#6366f1' },
    { classId: 'board_mini_stamp', labelKey: 'classes.board_mini_stamp_chip', defaultLabel: 'Stamp', color: '#818cf8' },
    { classId: 'board_standard', labelKey: 'classes.board_standard_chip', defaultLabel: 'Dev-Board', color: '#4f46e5' },
    { classId: 'board_module', labelKey: 'classes.board_module_chip', defaultLabel: 'Modul', color: '#0284c7' },
    { classId: 'oscillator', labelKey: 'classes.oscillator_chip', defaultLabel: 'Quarz', color: '#eab308' },
    { classId: 'motor_actuator', labelKey: 'classes.motor_actuator_chip', defaultLabel: 'Motor', color: '#f97316' },
    { classId: 'speaker_buzzer', labelKey: 'classes.speaker_buzzer_chip', defaultLabel: 'Buzzer', color: '#84cc16' },
    { classId: 'other', labelKey: 'classes.other_chip', defaultLabel: 'Sonstiges', color: '#94a3b8' }
];

function updateActiveClassPill() {
    const pillDot = document.getElementById('active-class-dot');
    const pillName = document.getElementById('active-class-name');
    const pillShortcut = document.getElementById('active-class-shortcut');
    if (!pillDot || !pillName) return;

    const activeCls = (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length)
        ? (detectedBoxes[selectedBoxIndex].label || currentPaletteClass)
        : currentPaletteClass;

    const topItem = TOP_HOTKEY_CLASSES.find(item => item.classId === activeCls);
    const secItem = SECONDARY_CLASSES.find(item => item.classId === activeCls);
    const item = topItem || secItem;

    const color = (typeof getClassColor === 'function') ? getClassColor(activeCls) : (item?.color || '#3b82f6');
    const label = item
        ? (window.t ? window.t(item.labelKey) : item.defaultLabel)
        : activeCls;

    pillDot.style.background = color;
    pillName.textContent = label;
    if (pillShortcut) {
        pillShortcut.textContent = topItem ? `(${topItem.key})` : '';
        pillShortcut.style.display = topItem ? 'inline' : 'none';
    }

    if (typeof boxClassSelect !== 'undefined' && boxClassSelect) {
        boxClassSelect.value = activeCls;
    }
}
window.updateActiveClassPill = updateActiveClassPill;

// Tastatur-Kürzel 1-0 zum sofortigen Ändern der Klasse der gewählten Box bzw. Vorbelegung
window.addEventListener('keydown', (e) => {
    const isTyping = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (isTyping) return;
    if (e.key >= '0' && e.key <= '9') {
        const topItem = TOP_HOTKEY_CLASSES.find(item => item.key === e.key);
        if (topItem) {
            e.preventDefault();
            if (typeof selectPaletteClass === 'function') {
                selectPaletteClass(topItem.classId);
            }
        }
    }
});

function updateQuickPaletteActiveState() {
    updateActiveClassPill();
}
window.updateQuickPaletteActiveState = updateQuickPaletteActiveState;

function renderClassQuickBar() {
    updateActiveClassPill();
}
window.renderClassQuickBar = renderClassQuickBar;

// Initiale Pill-Aktualisierung
document.addEventListener('DOMContentLoaded', () => {
    updateActiveClassPill();
});

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
                pushBoxHistorySnapshot('Bauteil #' + (idx + 1) + ' gelöscht');
                detectedBoxes.splice(idx, 1);
                selectedBoxIndex = detectedBoxes.length > 0 ? Math.min(idx, detectedBoxes.length - 1) : -1;
                drawBboxOverlay();
                renderStage0Chips();
                renderObjectsList();
                updateStage0CropPreview();
                updateBoxEditBar();
                showUndoToast('Bauteil #' + (idx + 1) + ' gelöscht');
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
// UNIFIED CLASS PALETTE & QUICK-TAG POPOVER (DESKTOP & MOBILE BOTTOM-SHEET)
// =====================================================================
const quickTagPopover = document.getElementById('canvas-quick-tag-popover');
const popoverTag = document.getElementById('popover-box-tag');
const popoverCloseBtn = document.getElementById('btn-popover-close');
const popoverClassSelect = document.getElementById('popover-class-select');
const popoverDelBtn = document.getElementById('popover-del-btn');
const paletteSearchInput = document.getElementById('palette-search-input');
const activeClassPillBtn = document.getElementById('active-class-pill-btn');

function populatePopoverClassSelect() {
    if (!popoverClassSelect) return;
    const currentVal = popoverClassSelect.value;
    popoverClassSelect.innerHTML = '';
    const classList = (typeof knownDatasetClasses !== 'undefined' && Array.isArray(knownDatasetClasses)) ? knownDatasetClasses : [
        'ic', 'resistor', 'capacitor', 'transistor', 'diode',
        'led', 'inductor', 'potentiometer', 'switch_button', 'relay',
        'connector', 'display', 'board_mcu_stick', 'board_mini_stamp',
        'board_standard', 'board_module', 'oscillator', 'motor_actuator',
        'speaker_buzzer', 'other'
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
        const chosen = popoverClassSelect.value;
        selectPaletteClass(chosen);
    });
}

function renderUnifiedPalette() {
    const topContainer = document.getElementById('palette-top-classes');
    const secContainer = document.getElementById('palette-secondary-classes');
    if (!topContainer || !secContainer) return;

    const selBox = (typeof getSelectedComponentBox === 'function') ? getSelectedComponentBox() : null;
    const targetClass = selBox ? selBox.label : currentPaletteClass;

    // 1. Top 10 Buttons (Hotkeys 1–0)
    topContainer.innerHTML = TOP_HOTKEY_CLASSES.map(item => {
        const isActive = (item.classId === targetClass);
        const color = (typeof getClassColor === 'function') ? getClassColor(item.classId) : item.color;
        const label = window.t ? window.t(item.labelKey) : item.defaultLabel;
        return `
            <button type="button" class="popover-class-btn ${isActive ? 'active' : ''}" data-class="${item.classId}">
                <span class="class-dot" style="background: ${color};"></span>
                <span class="class-btn-name">${label}</span>
                <span class="shortcut-badge">${item.key}</span>
            </button>
        `;
    }).join('');

    // 2. Weitere 10 Klassen
    secContainer.innerHTML = SECONDARY_CLASSES.map(item => {
        const isActive = (item.classId === targetClass);
        const color = (typeof getClassColor === 'function') ? getClassColor(item.classId) : item.color;
        const label = window.t ? window.t(item.labelKey) : item.defaultLabel;
        return `
            <button type="button" class="popover-class-btn ${isActive ? 'active' : ''}" data-class="${item.classId}">
                <span class="class-dot" style="background: ${color};"></span>
                <span class="class-btn-name">${label}</span>
            </button>
        `;
    }).join('');

    // Click Events
    const allBtns = quickTagPopover.querySelectorAll('.popover-class-btn');
    allBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const cls = btn.getAttribute('data-class');
            selectPaletteClass(cls);
        });
    });
}

function selectPaletteClass(cls) {
    if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
        applyClassToBox(selectedBoxIndex, cls);
    }
    currentPaletteClass = cls;
    window.currentPaletteClass = cls;
    updateActiveClassPill();
    closeQuickTagPopover();

    if (typeof updateStudioStatus === 'function') {
        updateStudioStatus(`Zeichen-Klasse auf '${cls}' gesetzt.`, 'ready');
    }
}
window.selectPaletteClass = selectPaletteClass;

// Live Search Filter
if (paletteSearchInput) {
    paletteSearchInput.addEventListener('input', () => {
        const q = paletteSearchInput.value.trim().toLowerCase();
        const allBtns = quickTagPopover.querySelectorAll('.popover-class-btn');
        allBtns.forEach(btn => {
            const cls = btn.getAttribute('data-class') || '';
            const txt = btn.textContent.toLowerCase();
            const match = !q || cls.includes(q) || txt.includes(q);
            btn.style.display = match ? 'inline-flex' : 'none';
        });
    });
}

function positionPopover(targetRect, mode) {
    if (!quickTagPopover) return;
    const isMobile = window.innerWidth <= 768;
    quickTagPopover.classList.toggle('mobile-bottom-sheet', isMobile);

    if (isMobile) {
        quickTagPopover.style.left = '0';
        quickTagPopover.style.top = 'auto';
        quickTagPopover.style.bottom = '0';
        quickTagPopover.style.right = '0';
        quickTagPopover.style.width = '100%';
        quickTagPopover.style.display = 'block';
        return;
    }

    quickTagPopover.style.bottom = 'auto';
    quickTagPopover.style.right = 'auto';
    const pw = 340;
    const ph = 420;

    let left = targetRect.left;
    let top = targetRect.top + targetRect.height + 6;

    if (mode === 'box') {
        left = targetRect.left + 15;
        top = targetRect.top - 20;
    }

    if (left + pw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - pw - 12);
    if (top + ph > window.innerHeight - 12) top = Math.max(60, window.innerHeight - ph - 12);
    if (left < 12) left = 12;
    if (top < 60) top = 60;

    quickTagPopover.style.left = `${left}px`;
    quickTagPopover.style.top = `${top}px`;
    quickTagPopover.style.width = `${pw}px`;
    quickTagPopover.style.display = 'block';
}

function openPaletteForToolbar() {
    if (!quickTagPopover) return;
    const pillBtn = document.getElementById('active-class-pill-btn');
    if (!pillBtn) return;

    if (quickTagPopover.style.display === 'block' && quickTagPopover.getAttribute('data-origin') === 'toolbar') {
        closeQuickTagPopover();
        return;
    }

    quickTagPopover.setAttribute('data-origin', 'toolbar');
    pillBtn.classList.add('open');
    renderUnifiedPalette();

    if (popoverTag) {
        const color = (typeof getClassColor === 'function') ? getClassColor(currentPaletteClass) : '#3b82f6';
        popoverTag.innerHTML = `<span class="class-dot" style="background:${color};"></span> Standard-Klasse für neue Boxen`;
    }

    if (popoverDelBtn) popoverDelBtn.style.display = 'none';
    if (popoverClassSelect) popoverClassSelect.value = currentPaletteClass;
    if (paletteSearchInput) {
        paletteSearchInput.value = '';
        paletteSearchInput.dispatchEvent(new Event('input'));
        setTimeout(() => paletteSearchInput.focus(), 50);
    }

    positionPopover(pillBtn.getBoundingClientRect(), 'toolbar');
}
window.openPaletteForToolbar = openPaletteForToolbar;

if (activeClassPillBtn) {
    activeClassPillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openPaletteForToolbar();
    });
}

function openQuickTagPopoverAt(clientX, clientY, boxIdx) {
    if (!quickTagPopover) return;
    if (boxIdx < 0 || boxIdx >= detectedBoxes.length) return;
    selectedBoxIndex = boxIdx;
    const box = detectedBoxes[boxIdx];

    quickTagPopover.setAttribute('data-origin', 'box');
    renderUnifiedPalette();

    if (popoverTag) {
        const color = (typeof getClassColor === 'function') ? getClassColor(box.label) : '#3b82f6';
        popoverTag.innerHTML = `<span class="class-dot" style="background:${color};"></span> #${boxIdx + 1} ${box.label || 'Box'}`;
    }

    if (popoverDelBtn) popoverDelBtn.style.display = 'inline-flex';
    if (popoverClassSelect) popoverClassSelect.value = box.label || 'ic';
    if (paletteSearchInput) {
        paletteSearchInput.value = '';
        paletteSearchInput.dispatchEvent(new Event('input'));
    }

    positionPopover({ left: clientX, top: clientY, width: 0, height: 0 }, 'box');
}
window.openQuickTagPopoverAt = openQuickTagPopoverAt;

function closeQuickTagPopover() {
    if (quickTagPopover) {
        quickTagPopover.style.display = 'none';
        quickTagPopover.removeAttribute('data-origin');
    }
    const pillBtn = document.getElementById('active-class-pill-btn');
    if (pillBtn) pillBtn.classList.remove('open');
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
            pushBoxHistorySnapshot('Box #' + (selectedBoxIndex + 1) + ' gelöscht');
            detectedBoxes.splice(selectedBoxIndex, 1);
            selectedBoxIndex = detectedBoxes.length > 0 ? Math.min(selectedBoxIndex, detectedBoxes.length - 1) : -1;
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            updateStage0CropPreview();
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
            closeQuickTagPopover();
            showUndoToast('Box gelöscht');
        }
    });
}

// Global click outside to close popover
window.addEventListener('click', (e) => {
    if (!quickTagPopover || quickTagPopover.style.display !== 'block') return;
    if (e.target.closest('#canvas-quick-tag-popover') || e.target.closest('#active-class-pill-btn')) {
        return;
    }
    closeQuickTagPopover();
});

window.addEventListener('languageChanged', () => {
    populatePopoverClassSelect();
    updateActiveClassPill();
    if (typeof renderObjectsList === 'function') {
        renderObjectsList();
    }
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
            pushBoxHistorySnapshot('Alle ' + detectedBoxes.length + ' Boxen entfernt');
            detectedBoxes = [];
            selectedBoxIndex = -1;
            drawBboxOverlay();
            renderStage0Chips();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            if (typeof closeQuickTagPopover === 'function') closeQuickTagPopover();
            updateStage0CropPreview();
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
            showUndoToast('Alle Boxen entfernt');
            if (typeof updateStudioStatus === 'function') {
                updateStudioStatus('Alle Bounding Boxes entfernt. Rückgängig mit Cmd+Z.', 'ready');
            }
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
                if (typeof syncCanvasEmptyState === 'function') syncCanvasEmptyState();
                if (typeof fitImageToWorkspace === 'function') fitImageToWorkspace();
                else resetStageZoomPan();
                runStage0Detection();
            } else {
                previewImage.src = val;
                if (typeof syncCanvasEmptyState === 'function') syncCanvasEmptyState();
                if (previewImage.complete && previewImage.naturalWidth) {
                    resetStageZoomPan();
                }
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

// Vorherige / Nächste Box Stepper
const prevBoxBtn = document.getElementById('prev-box-btn');
if (prevBoxBtn) {
    prevBoxBtn.addEventListener('click', () => {
        if (detectedBoxes.length === 0) return;
        const prevIdx = (selectedBoxIndex - 1 + detectedBoxes.length) % detectedBoxes.length;
        selectComponentBox(prevIdx, true);
    });
}
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

