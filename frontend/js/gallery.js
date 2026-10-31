// =====================================================================
// DATASET GALLERY & CURATION ANALYTICS (ClearML & Labellerr Style)
// =====================================================================

// =====================================================================
// DATENSATZ-GALERIE (Labellerr & Dataloop Style)
// =====================================================================
let currentGallerySplit = 'all';
let currentGalleryClass = 'all';
let currentGallerySearch = '';
let showGalleryBoxes = true;
let cachedGallerySamples = [];
let currentGalleryViewMode = localStorage.getItem('partlens_dataset_view_mode') || 'tiles';

// Adaptive Pagination / Infinite-Scroll State (fuer Datensaetze mit 1000 - 3000+ Bildern)
const GALLERY_CHUNK_SIZE = 24;
let galleryRenderedCount = 0;
let galleryFilteredSamples = [];
let galleryIntersectionObserver = null;
let galleryPageSize = localStorage.getItem('partlens_gallery_page_size') === 'all'
    ? 'all'
    : (parseInt(localStorage.getItem('partlens_gallery_page_size'), 10) || 48);
let galleryCurrentPage = 1;

// Auswahlmodus State & Funktionen (Batch Multi-Select & Delete)
let isSelectModeActive = false;
let selectedSampleKeys = new Set(); // Speichert "split:id"

function toggleSelectMode(force) {
    if (typeof force === 'boolean') {
        isSelectModeActive = force;
    } else {
        isSelectModeActive = !isSelectModeActive;
    }
    document.body.classList.toggle('dataset-select-mode-active', isSelectModeActive);
    const toggleBtn = document.getElementById('toggle-select-mode-btn');
    const toggleText = document.getElementById('select-mode-btn-text');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', isSelectModeActive);
    }
    if (toggleText) {
        toggleText.textContent = isSelectModeActive ? 'Fertig' : 'Auswählen';
    }
    if (!isSelectModeActive) {
        clearSampleSelection();
    } else {
        updateBatchBar();
    }
    if (currentlySwipedElement && currentlySwipedElement._resetSwipe) {
        currentlySwipedElement._resetSwipe(true);
    }
}

function clearSampleSelection() {
    selectedSampleKeys.clear();
    document.querySelectorAll('.sample-card.is-selected, .sample-card-small.is-selected, .gallery-compact-row.is-selected, .gallery-table-row.is-selected').forEach(el => {
        el.classList.remove('is-selected');
    });
    updateBatchBar();
}

function toggleSampleSelection(split, id) {
    if (!split || !id) return;
    const key = `${split}:${id}`;
    const willBeSelected = !selectedSampleKeys.has(key);
    if (willBeSelected) {
        selectedSampleKeys.add(key);
    } else {
        selectedSampleKeys.delete(key);
    }
    const selector = `[data-id="${id}"][data-split="${split}"]`;
    document.querySelectorAll(selector).forEach(el => {
        const card = el.closest('.sample-card, .sample-card-small, .gallery-compact-row, .gallery-table-row') || el;
        card.classList.toggle('is-selected', willBeSelected);
    });
    updateBatchBar();
}

function selectAllFilteredSamples() {
    if (!galleryFilteredSamples || galleryFilteredSamples.length === 0) return;
    const allSelected = galleryFilteredSamples.every(s => selectedSampleKeys.has(`${s.split}:${s.id}`));
    if (allSelected) {
        galleryFilteredSamples.forEach(s => {
            selectedSampleKeys.delete(`${s.split}:${s.id}`);
        });
    } else {
        galleryFilteredSamples.forEach(s => {
            selectedSampleKeys.add(`${s.split}:${s.id}`);
        });
    }
    document.querySelectorAll('.sample-card, .sample-card-small, .gallery-compact-row, .gallery-table-row').forEach(card => {
        const sid = card.getAttribute('data-id');
        const ssplit = card.getAttribute('data-split');
        if (sid && ssplit) {
            card.classList.toggle('is-selected', selectedSampleKeys.has(`${ssplit}:${sid}`));
        }
    });
    updateBatchBar();
}

function updateBatchBar() {
    const countEl = document.getElementById('batch-selected-count');
    const labelEl = document.getElementById('batch-selection-label');
    const delBtn = document.getElementById('batch-delete-btn');
    const selectAllBtn = document.getElementById('batch-select-all-btn');
    const count = selectedSampleKeys.size;
    if (countEl) countEl.textContent = count;

    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (labelEl) {
        labelEl.textContent = isMobile ? 'gewählt' : 'ausgewählt';
    }
    if (delBtn) {
        delBtn.disabled = count === 0;
    }
    if (selectAllBtn && galleryFilteredSamples) {
        const allSelected = galleryFilteredSamples.length > 0 && galleryFilteredSamples.every(s => selectedSampleKeys.has(`${s.split}:${s.id}`));
        if (isMobile) {
            selectAllBtn.textContent = allSelected ? 'Keine' : 'Alle';
        } else {
            selectAllBtn.textContent = allSelected ? 'Auswahl aufheben' : 'Alle auswählen';
        }
    }
}

async function batchDeleteSelectedSamples() {
    const count = selectedSampleKeys.size;
    if (count === 0) return;
    const confirmed = confirm(`Möchtest du wirklich ${count} ausgewählte${count === 1 ? 's Sample' : ' Samples'} unwiderruflich löschen?`);
    if (!confirmed) return;

    const samplesToDelete = Array.from(selectedSampleKeys).map(k => {
        const parts = k.split(':');
        return { split: parts[0], id: parts[1] };
    });

    const delBtn = document.getElementById('batch-delete-btn');
    if (delBtn) {
        delBtn.disabled = true;
        delBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
            <span>Lösche...</span>
        `;
    }

    try {
        let res = await fetch('/api/dataset/samples/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ samples: samplesToDelete })
        });

        if (res.status === 405 || res.status === 404) {
            // Automatischer Fallback, falls der Python-Server noch nicht neu gestartet wurde
            const deletePromises = samplesToDelete.map(s =>
                fetch(`/api/dataset/samples/${s.split}/${s.id}`, { method: 'DELETE' })
            );
            const deleteResponses = await Promise.all(deletePromises);
            const anyFailed = deleteResponses.some(r => !r.ok);
            if (anyFailed && !deleteResponses.some(r => r.ok)) {
                alert('Löschen der ausgewählten Samples fehlgeschlagen.');
                return;
            }
        } else if (!res.ok) {
            alert(`Fehler beim Stapellöschen (HTTP ${res.status})`);
            return;
        }

        document.querySelectorAll('.sample-card.is-selected, .sample-card-small.is-selected, .gallery-compact-row.is-selected, .gallery-table-row.is-selected').forEach(el => {
            el.style.transition = 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
            el.style.opacity = '0';
            el.style.transform = 'scale(0.85)';
        });

        selectedSampleKeys.clear();
        setTimeout(() => {
            loadDatasetGallery(true);
            fetchDatasetStatus();
        }, 240);
    } catch (err) {
        alert(`Fehler beim Stapellöschen: ${err.message}`);
    } finally {
        if (delBtn) {
            delBtn.disabled = selectedSampleKeys.size === 0;
            delBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Löschen</span>
            `;
        }
        updateBatchBar();
    }
}

function getEffectiveGalleryViewMode() {
    const isMobilePortrait = window.matchMedia('(max-width: 768px) and (orientation: portrait)').matches;
    if (isMobilePortrait && currentGalleryViewMode === 'detailed-list') {
        return 'list'; // Automatischer Fallback auf die kompakte Liste im Hochformat
    }
    return currentGalleryViewMode;
}

function updateViewControls() {
    const effectiveMode = getEffectiveGalleryViewMode();
    const toggleBoxesBtn = document.getElementById('toggle-gallery-boxes-btn');
    if (toggleBoxesBtn) {
        toggleBoxesBtn.style.display = effectiveMode === 'list' ? 'none' : 'inline-flex';
    }
    const switcher = document.getElementById('gallery-view-switcher');
    if (switcher) {
        const buttons = switcher.querySelectorAll('.btn-view-mode');
        buttons.forEach(b => b.classList.toggle('active', b.dataset.view === effectiveMode));
    }
}

function initGalleryViewSwitcher() {
    const switcher = document.getElementById('gallery-view-switcher');
    if (!switcher) return;
    const buttons = switcher.querySelectorAll('.btn-view-mode');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.view;
            if (mode === currentGalleryViewMode) return;
            currentGalleryViewMode = mode;
            localStorage.setItem('partlens_dataset_view_mode', mode);
            updateViewControls();
            renderFilteredGallery();
        });
    });
    updateViewControls();

    // Automatische Umschaltung bei Rotation des Smartphones (Portrait <-> Landscape)
    const portraitMedia = window.matchMedia('(max-width: 768px) and (orientation: portrait)');
    const handleOrientationChange = () => {
        updateViewControls();
        renderFilteredGallery();
    };
    if (portraitMedia.addEventListener) {
        portraitMedia.addEventListener('change', handleOrientationChange);
    } else if (portraitMedia.addListener) {
        portraitMedia.addListener(handleOrientationChange);
    }
    window.addEventListener('orientationchange', handleOrientationChange);
}

initGalleryViewSwitcher();

const gallerySplitBtns = document.querySelectorAll('.gallery-split-btn');
gallerySplitBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        gallerySplitBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentGallerySplit = btn.getAttribute('data-split');
        galleryCurrentPage = 1;
        renderFilteredGallery();
    });
});

const gallerySearchInput = document.getElementById('gallery-search-input');
if (gallerySearchInput) {
    gallerySearchInput.addEventListener('input', () => {
        currentGallerySearch = gallerySearchInput.value.trim().toLowerCase();
        galleryCurrentPage = 1;
        renderFilteredGallery();
    });
}

const toggleGalleryBoxesBtn = document.getElementById('toggle-gallery-boxes-btn');
if (toggleGalleryBoxesBtn) {
    toggleGalleryBoxesBtn.addEventListener('click', () => {
        showGalleryBoxes = !showGalleryBoxes;
        toggleGalleryBoxesBtn.classList.toggle('active', showGalleryBoxes);
        toggleGalleryBoxesBtn.innerHTML = showGalleryBoxes
            ? '<svg class="tool-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg><span>Boxen</span>'
            : '<svg class="tool-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg><span>Versteckt</span>';
        document.querySelectorAll('.sample-boxes-overlay').forEach(el => {
            el.classList.toggle('hidden', !showGalleryBoxes);
        });
    });
}

const refreshGalleryBtn = document.getElementById('refresh-gallery-btn');
if (refreshGalleryBtn) {
    refreshGalleryBtn.addEventListener('click', () => loadDatasetGallery(true));
}

const toggleSelectModeBtn = document.getElementById('toggle-select-mode-btn');
if (toggleSelectModeBtn) {
    toggleSelectModeBtn.addEventListener('click', () => {
        toggleSelectMode();
    });
}

const batchSelectAllBtn = document.getElementById('batch-select-all-btn');
if (batchSelectAllBtn) {
    batchSelectAllBtn.addEventListener('click', () => {
        selectAllFilteredSamples();
    });
}

const batchDeleteBtn = document.getElementById('batch-delete-btn');
if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', () => {
        batchDeleteSelectedSamples();
    });
}

const batchCancelBtn = document.getElementById('batch-cancel-btn');
if (batchCancelBtn) {
    batchCancelBtn.addEventListener('click', () => {
        toggleSelectMode(false);
    });
}

function renderSkeletonPlaceholders(grid, count = 8) {
    grid.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const skel = document.createElement('div');
        skel.className = 'gallery-skeleton-card';
        skel.innerHTML = `
            <div class="skeleton-thumb"></div>
            <div style="padding: 12px;">
                <div class="skeleton-line" style="width: 70%;"></div>
                <div class="skeleton-line" style="width: 45%; height: 10px;"></div>
                <div class="skeleton-line" style="width: 90%; height: 20px; margin-top: 12px; border-radius: 6px;"></div>
            </div>
        `;
        grid.appendChild(skel);
    }
}

function renderGalleryClassFilters(samples) {
    const container = document.getElementById('gallery-classes-scroll');
    if (!container) return;

    // Zähle Vorkommen jeder Klasse
    const classCounts = {};
    samples.forEach(s => {
        (s.classes || []).forEach(c => {
            const countInSample = (s.boxes || []).filter(b => b.label === c).length || 1;
            classCounts[c] = (classCounts[c] || 0) + countInSample;
        });
    });

    const classes = Object.keys(classCounts).sort();
    if (classes.length === 0) {
        container.innerHTML = '<span style="font-size: 0.72rem; color: var(--muted);">Keine Klassen-Labels vorhanden</span>';
        return;
    }

    container.innerHTML = '';
    
    // "Alle" Pill
    const allPill = document.createElement('button');
    allPill.type = 'button';
    allPill.className = `class-filter-pill ${currentGalleryClass === 'all' ? 'active' : ''}`;
    allPill.textContent = `Alle (${samples.length})`;
    allPill.addEventListener('click', () => {
        currentGalleryClass = 'all';
        galleryCurrentPage = 1;
        renderGalleryClassFilters(cachedGallerySamples);
        renderFilteredGallery();
    });
    container.appendChild(allPill);

    classes.forEach(c => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `class-filter-pill ${currentGalleryClass === c ? 'active' : ''}`;
        const color = getClassColor(c);
        pill.style.borderColor = color;
        pill.style.color = currentGalleryClass === c ? '#38bdf8' : color;
        pill.textContent = `${c} (${classCounts[c]})`;
        pill.addEventListener('click', () => {
            currentGalleryClass = currentGalleryClass === c ? 'all' : c;
            galleryCurrentPage = 1;
            renderGalleryClassFilters(cachedGallerySamples);
            renderFilteredGallery();
        });
        container.appendChild(pill);
    });
}

let currentlySwipedElement = null;

// Globaler Listener: Schließt geöffnete Swipe-Karten sofort, sobald irgendwo anders hingetippt wird
document.addEventListener('touchstart', (e) => {
    if (currentlySwipedElement && !currentlySwipedElement.contains(e.target)) {
        try {
            if (currentlySwipedElement._resetSwipe) {
                currentlySwipedElement._resetSwipe(true);
            }
        } catch (err) {}
    }
}, { passive: true });

document.addEventListener('click', (e) => {
    if (currentlySwipedElement && !currentlySwipedElement.contains(e.target)) {
        try {
            if (currentlySwipedElement._resetSwipe) {
                currentlySwipedElement._resetSwipe(true);
            }
        } catch (err) {}
    }
});

async function deleteSampleItem(split, id, cardEl) {
    const confirmed = confirm(`Möchtest du Sample ${id} (${split}) wirklich löschen?`);
    if (!confirmed) {
        // Bei Abbruch sofort und zuverlässig wieder zurückschnappen
        if (cardEl && cardEl._resetSwipe) {
            setTimeout(() => {
                cardEl._resetSwipe(true);
            }, 30);
        }
        return false;
    }
    try {
        const dres = await fetch(`/api/dataset/samples/${split}/${id}`, { method: 'DELETE' });
        if (dres.ok) {
            if (cardEl) {
                cardEl.style.transition = 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.28s ease, margin 0.28s ease';
                cardEl.style.opacity = '0';
                cardEl.style.transform = 'translateX(-100%)';
            }
            setTimeout(() => {
                loadDatasetGallery(true);
                fetchDatasetStatus();
            }, 240);
            return true;
        } else {
            alert(`Löschen fehlgeschlagen (HTTP ${dres.status})`);
            if (cardEl && cardEl._resetSwipe) {
                cardEl._resetSwipe(true);
            }
        }
    } catch (err) {
        alert(`Löschen fehlgeschlagen: ${err.message}`);
        if (cardEl && cardEl._resetSwipe) {
            cardEl._resetSwipe(true);
        }
    }
    return false;
}

function attachSwipeToDelete(card, swipeInner, onDelete, onOpen) {
    if (!card || !swipeInner) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let currentX = 0;
    let startXOffset = 0;
    let isSwiping = false;
    let isVerticalScroll = false;
    let isOpen = false;

    function resetSwipe(smooth = true) {
        if (smooth) {
            swipeInner.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        } else {
            swipeInner.style.transition = 'none';
        }
        swipeInner.style.transform = 'translateX(0)';
        currentX = 0;
        startXOffset = 0;
        isOpen = false;
        if (currentlySwipedElement === card) {
            currentlySwipedElement = null;
        }
    }

    function openSwipe() {
        swipeInner.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        swipeInner.style.transform = 'translateX(-76px)';
        currentX = -76;
        startXOffset = -76;
        isOpen = true;
        if (currentlySwipedElement && currentlySwipedElement !== card && currentlySwipedElement._resetSwipe) {
            try { currentlySwipedElement._resetSwipe(true); } catch (e) {}
        }
        currentlySwipedElement = card;
    }

    card._resetSwipe = resetSwipe;
    card._isOpen = () => isOpen;

    swipeInner.addEventListener('touchstart', (e) => {
        if (isSelectModeActive) return;
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startTime = Date.now();
        isSwiping = false;
        isVerticalScroll = false;
        startXOffset = 0;
        currentX = 0;

        if (currentlySwipedElement && currentlySwipedElement !== card && currentlySwipedElement._resetSwipe) {
            try { currentlySwipedElement._resetSwipe(true); } catch (e) {}
        }
    }, { passive: true });

    swipeInner.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1 || isVerticalScroll) return;
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        if (!isSwiping) {
            if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
                isVerticalScroll = true;
                return;
            }
            if (Math.abs(dx) > 8) {
                isSwiping = true;
            }
        }

        if (isSwiping) {
            if (e.cancelable) e.preventDefault();
            let newX = dx;
            if (newX > 0) {
                newX = newX * 0.2;
            }
            currentX = newX;
            swipeInner.style.transition = 'none';
            swipeInner.style.transform = `translateX(${currentX}px)`;
        }
    }, { passive: false });

    swipeInner.addEventListener('touchend', (e) => {
        const duration = Date.now() - startTime;
        const moveDist = currentX;

        if (!isSwiping && !isVerticalScroll) {
            if (duration < 350 && Math.abs(moveDist) < 10) {
                if (isSelectModeActive) {
                    toggleSampleSelection(card.getAttribute('data-split'), card.getAttribute('data-id'));
                    return;
                }
                if (typeof onOpen === 'function') {
                    onOpen();
                    return;
                }
            }
        }

        if (isSwiping) {
            const cardWidth = card.offsetWidth || 300;
            const triggerThreshold = Math.min(140, Math.max(90, cardWidth * 0.38));

            // Wenn weit genug nach links gezogen (< -triggerThreshold): Lösch-Dialog auslösen
            if (currentX < -triggerThreshold) {
                swipeInner.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
                swipeInner.style.transform = 'translateX(-100%)';
                setTimeout(() => {
                    if (typeof onDelete === 'function') onDelete();
                }, 160);
                return;
            }

            // Vor der Auslöseschwelle losgelassen: IMMER sofort und flüssig zurückspringen
            resetSwipe(true);
        }
    }, { passive: true });

    const revealBtn = card.querySelector('.swipe-delete-reveal');
    if (revealBtn) {
        revealBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof onDelete === 'function') onDelete();
        });
    }

    swipeInner.addEventListener('click', (e) => {
        if (isSelectModeActive) {
            e.stopPropagation();
            toggleSampleSelection(card.getAttribute('data-split'), card.getAttribute('data-id'));
            return;
        }
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) {
            return;
        }
        if (isOpen) {
            resetSwipe(true);
            return;
        }
        if (window.matchMedia('(pointer: coarse)').matches) {
            return;
        }
        if (typeof onOpen === 'function') {
            onOpen();
        }
    });
}

function createSampleCardElement(s) {
    const card = document.createElement('div');
    card.className = 'sample-card';
    card.setAttribute('data-id', s.id);
    card.setAttribute('data-split', s.split);
    if (selectedSampleKeys.has(`${s.split}:${s.id}`)) {
        card.classList.add('is-selected');
    }

    const classesHtml = (s.classes || []).map(c => `
        <span class="sample-class-pill" style="border-color: ${getClassColor(c)}; color: ${getClassColor(c)};">
            ${c}
        </span>
    `).join('');

    const tagsList = s.tags || [];
    const tagsHtml = tagsList.slice(0, 4).map(t => `
        <span class="sample-tag-pill" style="font-size: 0.68rem; background: var(--surface-hover); color: var(--text-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px; display: inline-block;">
            ${t}
        </span>
    `).join('') + (tagsList.length > 4 ? `<span style="font-size: 0.65rem; color: var(--muted); align-self: center;">+${tagsList.length - 4}</span>` : '');

    const boxesSvgHtml = (s.boxes || []).map(b => {
        const color = getClassColor(b.label);
        const x = b.xmin * 1000;
        const y = b.ymin * 1000;
        const w = Math.max(1, (b.xmax - b.xmin) * 1000);
        const h = Math.max(1, (b.ymax - b.ymin) * 1000);
        const displayLabel = b.footprint ? `${b.label} (${b.footprint})` : b.label;
        const tagW = Math.min(w, Math.max(110, displayLabel.length * 20));
        return `
            <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}24" stroke="${color}" stroke-width="12" rx="6" />
            <rect x="${x}" y="${Math.max(0, y - 44)}" width="${tagW}" height="42" fill="${color}" rx="4" />
            <text x="${x + 8}" y="${Math.max(30, y - 12)}" fill="#ffffff" font-size="26" font-family="-apple-system, system-ui, sans-serif" font-weight="800">${displayLabel}</text>
        `;
    }).join('');

    card.innerHTML = `
        <div class="swipe-delete-reveal" data-id="${s.id}" data-split="${s.split}" title="Sample löschen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span class="swipe-delete-label">Löschen</span>
        </div>
        <div class="sample-card-swipe-inner">
            <div class="sample-thumb-wrap" data-id="${s.id}" data-split="${s.split}" title="Klicken / Antippen zum Öffnen im Studio">
                <div class="sample-select-checkbox" data-split="${s.split}" data-id="${s.id}" title="Sample auswählen">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <img src="${s.thumb_url || s.image_url}" alt="${s.id}" loading="lazy" />
                <svg class="sample-boxes-overlay ${showGalleryBoxes ? '' : 'hidden'}" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                    ${boxesSvgHtml}
                </svg>
                <span class="sample-split-tag ${s.split}">${s.split}</span>
                <span class="sample-thumb-hover-hint">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    <span>Studio</span>
                </span>
                <span class="sample-count-tag">${s.box_count} Boxen</span>
            </div>
            <div class="sample-status-bar ${s.box_count > 0 ? '' : 'empty'}" title="${s.box_count > 0 ? 'Annotiert & Kuratiert' : 'Ohne Boxen'}"></div>
            <div class="sample-card-body">
                <div class="sample-card-header-row">
                    <div class="sample-card-title" title="${s.id}">${s.id}</div>
                    <button class="btn-delete-title-sm" type="button" title="Sample löschen" data-id="${s.id}" data-split="${s.split}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
                <div class="sample-classes-wrap" style="display: flex; flex-wrap: wrap; gap: 4px;">
                    ${classesHtml || '<span style="color: var(--muted); font-size: 0.7rem;">Keine Labels</span>'}
                </div>
                ${tagsList.length > 0 ? `
                <div class="sample-tags-wrap" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px;">
                    ${tagsHtml}
                </div>` : ''}
            </div>
        </div>
    `;

    const img = card.querySelector('img');
    const thumbWrap = card.querySelector('.sample-thumb-wrap');
    if (img && thumbWrap) {
        if (img.complete && img.naturalWidth > 0) {
            img.classList.add('loaded');
            thumbWrap.classList.add('loaded');
        } else {
            img.addEventListener('load', () => {
                img.classList.add('loaded');
                thumbWrap.classList.add('loaded');
            });
            img.addEventListener('error', () => {
                thumbWrap.classList.add('loaded');
            });
        }
    }

    const triggerOpen = async () => {
        await openSampleInStudio(s.split, s.id);
    };

    const swipeInner = card.querySelector('.sample-card-swipe-inner');
    attachSwipeToDelete(card, swipeInner, () => {
        deleteSampleItem(s.split, s.id, card);
    }, triggerOpen);

    const chk = card.querySelector('.sample-select-checkbox');
    if (chk) {
        chk.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSampleSelection(s.split, s.id);
        });
    }

    const smDelBtn = card.querySelector('.btn-delete-title-sm');
    if (smDelBtn) {
        smDelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSampleItem(s.split, s.id, card);
        });
    }

    // Direktes Öffnen bei Klick auf Thumbnail oder Titel
    if (thumbWrap) {
        thumbWrap.addEventListener('click', (e) => {
            if (e.target.closest('.sample-select-checkbox')) return;
            e.stopPropagation();
            if (isSelectModeActive) {
                toggleSampleSelection(s.split, s.id);
                return;
            }
            if (card._isOpen && card._isOpen()) {
                card._resetSwipe(true);
                return;
            }
            triggerOpen();
        });
    }

    const titleEl = card.querySelector('.sample-card-title');
    if (titleEl) {
        titleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isSelectModeActive) {
                toggleSampleSelection(s.split, s.id);
                return;
            }
            if (card._isOpen && card._isOpen()) {
                card._resetSwipe(true);
                return;
            }
            triggerOpen();
        });
    }

    return card;
}

function createSampleSmallTileElement(s) {
    const card = document.createElement('div');
    card.className = 'sample-card-small';
    card.setAttribute('data-id', s.id);
    card.setAttribute('data-split', s.split);
    card.title = `${s.id} (${s.split}, ${s.box_count} Boxen)`;
    if (selectedSampleKeys.has(`${s.split}:${s.id}`)) {
        card.classList.add('is-selected');
    }

    const boxesSvgHtml = (s.boxes || []).map(b => {
        const color = getClassColor(b.label);
        const x = b.xmin * 1000;
        const y = b.ymin * 1000;
        const w = Math.max(1, (b.xmax - b.xmin) * 1000);
        const h = Math.max(1, (b.ymax - b.ymin) * 1000);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}35" stroke="${color}" stroke-width="16" rx="4" />`;
    }).join('');

    card.innerHTML = `
        <div class="sample-small-thumb-wrap" data-id="${s.id}" data-split="${s.split}">
            <div class="sample-select-checkbox" data-split="${s.split}" data-id="${s.id}" title="Sample auswählen">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <img src="${s.thumb_url || s.image_url}" alt="${s.id}" loading="lazy" />
            <svg class="sample-boxes-overlay ${showGalleryBoxes ? '' : 'hidden'}" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                ${boxesSvgHtml}
            </svg>
            <span class="sample-small-dot ${s.split}" title="Split: ${s.split}"></span>
            <span class="sample-small-badge">${s.box_count}</span>
        </div>
        <div class="sample-small-footer">
            <span class="sample-small-title" title="${s.id}">${s.id}</span>
        </div>
    `;

    const img = card.querySelector('img');
    const thumbWrap = card.querySelector('.sample-small-thumb-wrap');
    if (img && thumbWrap) {
        if (img.complete && img.naturalWidth > 0) {
            img.classList.add('loaded');
            thumbWrap.classList.add('loaded');
        } else {
            img.addEventListener('load', () => {
                img.classList.add('loaded');
                thumbWrap.classList.add('loaded');
            });
            img.addEventListener('error', () => {
                thumbWrap.classList.add('loaded');
            });
        }
    }

    const chk = card.querySelector('.sample-select-checkbox');
    if (chk) {
        chk.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSampleSelection(s.split, s.id);
        });
    }

    card.addEventListener('click', async (e) => {
        if (isSelectModeActive) {
            e.stopPropagation();
            toggleSampleSelection(s.split, s.id);
            return;
        }
        await openSampleInStudio(s.split, s.id);
    });

    return card;
}

function createSampleDetailedRowElement(s) {
    const tr = document.createElement('tr');
    tr.className = 'gallery-table-row';
    tr.setAttribute('data-id', s.id);
    tr.setAttribute('data-split', s.split);
    if (selectedSampleKeys.has(`${s.split}:${s.id}`)) {
        tr.classList.add('is-selected');
    }

    const classesHtml = (s.classes || []).map(c => `
        <span class="sample-class-pill" style="border-color: ${getClassColor(c)}; color: ${getClassColor(c)};">
            ${c}
        </span>
    `).join('');

    const tagsList = s.tags || [];
    const tagsHtml = tagsList.slice(0, 3).map(t => `
        <span class="sample-tag-pill" style="font-size: 0.68rem; background: var(--surface-hover); color: var(--text-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px; display: inline-block;">
            ${t}
        </span>
    `).join('') + (tagsList.length > 3 ? `<span style="font-size: 0.65rem; color: var(--muted); align-self: center;">+${tagsList.length - 3}</span>` : '');

    const boxesSvgHtml = (s.boxes || []).map(b => {
        const color = getClassColor(b.label);
        const x = b.xmin * 1000;
        const y = b.ymin * 1000;
        const w = Math.max(1, (b.xmax - b.xmin) * 1000);
        const h = Math.max(1, (b.ymax - b.ymin) * 1000);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}35" stroke="${color}" stroke-width="24" />`;
    }).join('');

    tr.innerHTML = `
        <td style="width: 72px; padding: 6px 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div class="sample-select-checkbox" data-split="${s.split}" data-id="${s.id}" title="Sample auswählen">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="table-thumb-box" title="Klicken zum Öffnen" data-id="${s.id}" data-split="${s.split}">
                    <img src="${s.thumb_url || s.image_url}" alt="${s.id}" loading="lazy" />
                    <svg class="sample-boxes-overlay ${showGalleryBoxes ? '' : 'hidden'}" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                        ${boxesSvgHtml}
                    </svg>
                </div>
            </div>
        </td>
        <td style="font-weight: 600; font-family: ui-monospace, monospace; color: var(--text-bright);">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span class="table-sample-name" title="${s.id}">${s.id}</span>
                <button class="btn-delete-title-sm" type="button" title="Sample löschen" data-id="${s.id}" data-split="${s.split}">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                </button>
            </div>
        </td>
        <td>
            <span class="sample-split-tag-inline ${s.split}">${s.split}</span>
        </td>
        <td style="font-weight: 700; color: #38bdf8;">
            ${s.box_count} Box${s.box_count === 1 ? '' : 'en'}
        </td>
        <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                ${classesHtml || '<span style="color: var(--muted); font-size: 0.72rem;">-</span>'}
            </div>
        </td>
        <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                ${tagsHtml || '<span style="color: var(--muted); font-size: 0.72rem;">-</span>'}
            </div>
        </td>
        <td style="text-align: right; white-space: nowrap;">
            <div style="display: inline-flex; align-items: center; gap: 6px;">
                <button class="btn btn-tool btn-open-sample" type="button" style="padding: 4px 8px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 4px;" data-id="${s.id}" data-split="${s.split}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    <span>Prüfen</span>
                </button>
                <button class="btn btn-danger btn-delete-sample" type="button" style="padding: 4px 8px; font-size: 0.75rem; display: inline-flex; align-items: center;" data-id="${s.id}" data-split="${s.split}" title="Sample löschen">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </td>
    `;

    const triggerOpen = async () => {
        if (isSelectModeActive) {
            toggleSampleSelection(s.split, s.id);
            return;
        }
        await openSampleInStudio(s.split, s.id);
    };

    const chk = tr.querySelector('.sample-select-checkbox');
    if (chk) {
        chk.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSampleSelection(s.split, s.id);
        });
    }

    const openBtn = tr.querySelector('.btn-open-sample');
    const thumbBox = tr.querySelector('.table-thumb-box');
    const nameEl = tr.querySelector('.table-sample-name');

    if (openBtn) openBtn.addEventListener('click', triggerOpen);
    if (thumbBox) thumbBox.addEventListener('click', triggerOpen);
    if (nameEl) nameEl.addEventListener('click', triggerOpen);

    tr.addEventListener('click', (e) => {
        if (isSelectModeActive && !e.target.closest('button')) {
            toggleSampleSelection(s.split, s.id);
        }
    });

    const smDelBtn = tr.querySelector('.btn-delete-title-sm');
    if (smDelBtn) {
        smDelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSampleItem(s.split, s.id, tr);
        });
    }

    const delBtn = tr.querySelector('.btn-delete-sample');
    if (delBtn) {
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSampleItem(s.split, s.id, tr);
        });
    }

    return tr;
}

function createSampleCompactRowElement(s) {
    const row = document.createElement('div');
    row.className = 'gallery-compact-row';
    row.setAttribute('data-id', s.id);
    row.setAttribute('data-split', s.split);
    if (selectedSampleKeys.has(`${s.split}:${s.id}`)) {
        row.classList.add('is-selected');
    }

    const classesHtml = (s.classes || []).map(c => `
        <span class="sample-class-pill" style="font-size: 0.68rem; padding: 1px 5px; border-color: ${getClassColor(c)}; color: ${getClassColor(c)};">
            ${c}
        </span>
    `).join('');

    row.innerHTML = `
        <div class="swipe-delete-reveal" data-id="${s.id}" data-split="${s.split}" title="Sample löschen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span class="swipe-delete-label">Löschen</span>
        </div>
        <div class="compact-row-swipe-inner">
            <div class="sample-select-checkbox" data-split="${s.split}" data-id="${s.id}" title="Sample auswählen" style="margin-right: 4px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="compact-thumb-box" data-id="${s.id}" data-split="${s.split}">
                <img src="${s.thumb_url || s.image_url}" alt="${s.id}" loading="lazy" />
            </div>
            <span class="compact-split-dot ${s.split}" title="${s.split}"></span>
            <div class="compact-id-wrap" style="display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;">
                <div class="compact-id" title="${s.id}">${s.id}</div>
                <button class="btn-delete-title-sm" type="button" title="Sample löschen" data-id="${s.id}" data-split="${s.split}">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                </button>
            </div>
            <div class="compact-classes" style="display: flex; gap: 4px;">
                ${classesHtml || '<span style="color: var(--muted); font-size: 0.68rem;">-</span>'}
            </div>
            <div class="compact-boxes" style="color: #38bdf8; font-weight: 700; font-size: 0.75rem;">
                ${s.box_count} Box${s.box_count === 1 ? '' : 'en'}
            </div>
            <div class="compact-actions">
                <button class="btn btn-tool btn-open-sample" type="button" style="padding: 2px 7px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px;" data-id="${s.id}" data-split="${s.split}">
                    <span>Öffnen</span>
                </button>
                <button class="btn btn-danger btn-delete-sample" type="button" style="padding: 2px 6px; font-size: 0.72rem; display: inline-flex; align-items: center;" data-id="${s.id}" data-split="${s.split}" title="Sample löschen">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                </button>
            </div>
        </div>
    `;

    const triggerOpen = async () => await openSampleInStudio(s.split, s.id);

    const swipeInner = row.querySelector('.compact-row-swipe-inner');
    attachSwipeToDelete(row, swipeInner, () => {
        deleteSampleItem(s.split, s.id, row);
    }, triggerOpen);

    const chk = row.querySelector('.sample-select-checkbox');
    if (chk) {
        chk.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSampleSelection(s.split, s.id);
        });
    }

    const openBtn = row.querySelector('.btn-open-sample');
    const thumbBox = row.querySelector('.compact-thumb-box');
    const idEl = row.querySelector('.compact-id');

    const handleRowChildClick = (e) => {
        e.stopPropagation();
        if (isSelectModeActive) {
            toggleSampleSelection(s.split, s.id);
            return;
        }
        if (row._isOpen && row._isOpen()) {
            row._resetSwipe(true);
            return;
        }
        triggerOpen();
    };

    if (openBtn) openBtn.addEventListener('click', handleRowChildClick);
    if (thumbBox) thumbBox.addEventListener('click', handleRowChildClick);
    if (idEl) idEl.addEventListener('click', handleRowChildClick);

    const smDelBtn = row.querySelector('.btn-delete-title-sm');
    if (smDelBtn) {
        smDelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSampleItem(s.split, s.id, row);
        });
    }

    const delBtn = row.querySelector('.btn-delete-sample');
    if (delBtn) {
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSampleItem(s.split, s.id, row);
        });
    }

    return row;
}

function renderNextGalleryChunk() {
    const grid = document.getElementById('dataset-gallery-grid');
    const sentinel = document.getElementById('gallery-sentinel');
    if (!grid) return;

    const nextChunk = galleryFilteredSamples.slice(galleryRenderedCount, galleryRenderedCount + GALLERY_CHUNK_SIZE);
    if (nextChunk.length === 0) {
        if (galleryIntersectionObserver && sentinel) {
            galleryIntersectionObserver.unobserve(sentinel);
        }
        if (sentinel) {
            sentinel.innerHTML = `<span style="opacity: 0.6; display: inline-flex; align-items: center; gap: 6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Alle ${galleryFilteredSamples.length} Samples geladen</span>`;
        }
        return;
    }

    const effectiveMode = getEffectiveGalleryViewMode();
    const fragment = document.createDocumentFragment();
    nextChunk.forEach(s => {
        let el;
        if (effectiveMode === 'small-tiles') {
            el = createSampleSmallTileElement(s);
        } else if (effectiveMode === 'detailed-list') {
            el = createSampleDetailedRowElement(s);
        } else if (effectiveMode === 'list') {
            el = createSampleCompactRowElement(s);
        } else {
            el = createSampleCardElement(s);
        }
        fragment.appendChild(el);
    });

    // Target insertion container depending on view
    let targetContainer = grid;
    if (effectiveMode === 'detailed-list') {
        targetContainer = document.getElementById('gallery-table-tbody') || grid;
    } else if (effectiveMode === 'list') {
        targetContainer = document.getElementById('gallery-compact-list') || grid;
    }

    if (effectiveMode === 'detailed-list' || effectiveMode === 'list') {
        targetContainer.appendChild(fragment);
    } else {
        if (sentinel) {
            targetContainer.insertBefore(fragment, sentinel);
        } else {
            targetContainer.appendChild(fragment);
        }
    }

    galleryRenderedCount += nextChunk.length;
    updatePaginationBar(true);

    if (galleryRenderedCount >= galleryFilteredSamples.length) {
        if (galleryIntersectionObserver && sentinel) {
            galleryIntersectionObserver.unobserve(sentinel);
        }
        if (sentinel) {
            sentinel.innerHTML = `<span style="opacity: 0.6; display: inline-flex; align-items: center; gap: 6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Alle ${galleryFilteredSamples.length} Samples geladen</span>`;
        }
    }
}

function updatePaginationBar(isInfinite, startIndex = 0, endIndex = 0, totalPages = 1) {
    const bar = document.getElementById('gallery-pagination-bar');
    if (!bar) return;
    const rangeText = document.getElementById('pagination-range-text');
    const firstBtn = document.getElementById('pagination-first-btn');
    const prevBtn = document.getElementById('pagination-prev-btn');
    const nextBtn = document.getElementById('pagination-next-btn');
    const lastBtn = document.getElementById('pagination-last-btn');
    const pageInput = document.getElementById('pagination-page-input');
    const totalPagesEl = document.getElementById('pagination-total-pages');
    const sizeSelect = document.getElementById('pagination-size-select-input');
    const controls = bar.querySelector('.pagination-controls');

    if (sizeSelect) {
        sizeSelect.value = isInfinite ? 'all' : String(galleryPageSize);
    }

    if (isInfinite) {
        if (rangeText) {
            rangeText.innerText = `Endlos-Modus: ${galleryRenderedCount} von ${galleryFilteredSamples.length} Samples geladen`;
        }
        if (controls) controls.style.opacity = '0.35';
        if (firstBtn) firstBtn.disabled = true;
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (lastBtn) lastBtn.disabled = true;
        if (pageInput) {
            pageInput.disabled = true;
            pageInput.value = 1;
        }
        if (totalPagesEl) totalPagesEl.innerText = '1';
        return;
    }

    if (controls) controls.style.opacity = '1';
    const total = galleryFilteredSamples.length;
    if (rangeText) {
        rangeText.innerText = `Zeige ${total > 0 ? (startIndex + 1) : 0}–${endIndex} von ${total.toLocaleString('de-DE')} Samples`;
    }

    if (pageInput) {
        pageInput.disabled = false;
        pageInput.value = galleryCurrentPage;
        pageInput.max = totalPages;
    }
    if (totalPagesEl) {
        totalPagesEl.innerText = totalPages.toLocaleString('de-DE');
    }

    if (firstBtn) firstBtn.disabled = galleryCurrentPage <= 1;
    if (prevBtn) prevBtn.disabled = galleryCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = galleryCurrentPage >= totalPages;
    if (lastBtn) lastBtn.disabled = galleryCurrentPage >= totalPages;
}

let _paginationInitialized = false;
function initGalleryPagination() {
    if (_paginationInitialized) return;
    _paginationInitialized = true;

    const firstBtn = document.getElementById('pagination-first-btn');
    const prevBtn = document.getElementById('pagination-prev-btn');
    const nextBtn = document.getElementById('pagination-next-btn');
    const lastBtn = document.getElementById('pagination-last-btn');
    const pageInput = document.getElementById('pagination-page-input');
    const sizeSelect = document.getElementById('pagination-size-select-input');

    const goToPage = (page) => {
        if (galleryPageSize === 'all') return;
        const totalPages = Math.max(1, Math.ceil(galleryFilteredSamples.length / galleryPageSize));
        const target = Math.max(1, Math.min(totalPages, page));
        if (target === galleryCurrentPage) return;
        galleryCurrentPage = target;
        renderFilteredGallery();
        const view = document.getElementById('view-dataset');
        if (view) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (firstBtn) firstBtn.addEventListener('click', () => goToPage(1));
    if (prevBtn) prevBtn.addEventListener('click', () => goToPage(galleryCurrentPage - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToPage(galleryCurrentPage + 1));
    if (lastBtn) {
        lastBtn.addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(galleryFilteredSamples.length / galleryPageSize));
            goToPage(totalPages);
        });
    }

    if (pageInput) {
        pageInput.addEventListener('change', () => {
            const val = parseInt(pageInput.value, 10);
            if (!isNaN(val)) goToPage(val);
        });
        pageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = parseInt(pageInput.value, 10);
                if (!isNaN(val)) goToPage(val);
            }
        });
    }

    if (sizeSelect) {
        sizeSelect.addEventListener('change', () => {
            const val = sizeSelect.value;
            if (val === 'all') {
                galleryPageSize = 'all';
            } else {
                galleryPageSize = parseInt(val, 10) || 48;
            }
            localStorage.setItem('partlens_gallery_page_size', String(galleryPageSize));
            galleryCurrentPage = 1;
            renderFilteredGallery();
        });
    }
}

function renderFilteredGallery() {
    const grid = document.getElementById('dataset-gallery-grid');
    if (!grid) return;

    initGalleryPagination();

    // Bestehenden Observer trennen
    if (galleryIntersectionObserver) {
        galleryIntersectionObserver.disconnect();
        galleryIntersectionObserver = null;
    }

    let filtered = cachedGallerySamples.slice();

    // 1. Split-Filter
    if (currentGallerySplit !== 'all') {
        filtered = filtered.filter(s => s.split === currentGallerySplit);
    }

    // 2. Klassenfilter
    if (currentGalleryClass !== 'all') {
        filtered = filtered.filter(s => s.classes && s.classes.includes(currentGalleryClass));
    }

    // 3. Suche nach ID, Klassenlabel, Tags oder Bounding-Box Details (Footprint, Part-Marking, IC-Subgroup)
    if (currentGallerySearch) {
        filtered = filtered.filter(s => {
            const idMatch = (s.id || '').toLowerCase().includes(currentGallerySearch);
            const classMatch = (s.classes || []).some(c => c.toLowerCase().includes(currentGallerySearch));
            const tagMatch = (s.tags || []).some(t => t.toLowerCase().includes(currentGallerySearch));
            const boxDetailMatch = (s.boxes || []).some(b => 
                (b.part_marking && String(b.part_marking).toLowerCase().includes(currentGallerySearch)) ||
                (b.footprint && String(b.footprint).toLowerCase().includes(currentGallerySearch)) ||
                (b.ic_subgroup && String(b.ic_subgroup).toLowerCase().includes(currentGallerySearch))
            );
            return idMatch || classMatch || tagMatch || boxDetailMatch;
        });
    }

    galleryFilteredSamples = filtered;
    galleryRenderedCount = 0;
    updateBatchBar();

    // Badges im Top-Header aktualisieren
    const totalBadge = document.getElementById('gallery-total-badge');
    const boxesBadge = document.getElementById('gallery-boxes-badge');
    if (totalBadge) totalBadge.innerText = filtered.length;
    if (boxesBadge) {
        const totalBoxes = filtered.reduce((acc, s) => acc + (s.box_count || 0), 0);
        boxesBadge.innerText = `${totalBoxes} Boxen`;
    }

    const paginationBar = document.getElementById('gallery-pagination-bar');

    if (filtered.length === 0) {
        grid.className = 'gallery-grid';
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--muted); background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-lg);">
                <div style="display: flex; justify-content: center; margin-bottom: 12px; color: var(--muted);"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
                <strong style="color: var(--text); font-size: 1rem; display: block; margin-bottom: 4px;">Keine Datensätze gefunden</strong>
                <span>Keine Samples für die aktuelle Filterauswahl vorhanden.</span>
            </div>
        `;
        if (paginationBar) paginationBar.style.display = 'none';
        return;
    }

    if (paginationBar) paginationBar.style.display = 'flex';
    grid.innerHTML = '';

    const effectiveMode = getEffectiveGalleryViewMode();

    // Layout Container für verschiedene Ansichten aufbauen
    if (effectiveMode === 'tiles') {
        grid.className = 'gallery-grid view-tiles';
    } else if (effectiveMode === 'small-tiles') {
        grid.className = 'gallery-grid view-small-tiles';
    } else if (effectiveMode === 'detailed-list') {
        grid.className = 'gallery-table-wrap view-detailed-list';
        const table = document.createElement('table');
        table.className = 'gallery-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="width: 58px;">Vorschau</th>
                    <th>Sample ID</th>
                    <th style="width: 78px;">Split</th>
                    <th style="width: 85px;">Boxen</th>
                    <th>Klassen</th>
                    <th>Tags</th>
                    <th style="width: 140px; text-align: right;">Aktionen</th>
                </tr>
            </thead>
            <tbody id="gallery-table-tbody"></tbody>
        `;
        grid.appendChild(table);
    } else if (effectiveMode === 'list') {
        grid.className = 'gallery-list-container view-list';
        const listWrap = document.createElement('div');
        listWrap.className = 'gallery-compact-list';
        listWrap.id = 'gallery-compact-list';
        grid.appendChild(listWrap);
    }

    const isInfinite = galleryPageSize === 'all' || galleryPageSize === 0;

    if (isInfinite) {
        galleryRenderedCount = 0;
        // Sentinel Element für IntersectionObserver erstellen
        const sentinel = document.createElement('div');
        sentinel.id = 'gallery-sentinel';
        sentinel.className = 'gallery-sentinel';
        sentinel.innerHTML = `
            <div class="gallery-sentinel-spinner"></div>
            <span>Lade weitere Samples...</span>
        `;
        grid.appendChild(sentinel);

        galleryIntersectionObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    renderNextGalleryChunk();
                }
            }
        }, { rootMargin: '300px 0px' });

        galleryIntersectionObserver.observe(sentinel);
        renderNextGalleryChunk();
        updatePaginationBar(true);
    } else {
        // Paged Mode (z.B. 24, 48, 96 Samples pro Seite)
        const totalPages = Math.max(1, Math.ceil(filtered.length / galleryPageSize));
        if (galleryCurrentPage > totalPages) galleryCurrentPage = totalPages;
        if (galleryCurrentPage < 1) galleryCurrentPage = 1;

        const startIndex = (galleryCurrentPage - 1) * galleryPageSize;
        const endIndex = Math.min(filtered.length, startIndex + galleryPageSize);
        const pageChunk = filtered.slice(startIndex, endIndex);

        const fragment = document.createDocumentFragment();
        pageChunk.forEach(s => {
            let el;
            if (effectiveMode === 'small-tiles') {
                el = createSampleSmallTileElement(s);
            } else if (effectiveMode === 'detailed-list') {
                el = createSampleDetailedRowElement(s);
            } else if (effectiveMode === 'list') {
                el = createSampleCompactRowElement(s);
            } else {
                el = createSampleCardElement(s);
            }
            fragment.appendChild(el);
        });

        let targetContainer = grid;
        if (effectiveMode === 'detailed-list') {
            targetContainer = document.getElementById('gallery-table-tbody') || grid;
        } else if (effectiveMode === 'list') {
            targetContainer = document.getElementById('gallery-compact-list') || grid;
        }
        targetContainer.appendChild(fragment);

        updatePaginationBar(false, startIndex, endIndex, totalPages);
    }
}

async function loadDatasetGallery(forceRefresh = false) {
    const grid = document.getElementById('dataset-gallery-grid');
    if (!grid) return;

    // Sofort aus dem Arbeitsspeicher rendern falls bereits vorhanden (kein unnötiger Netzwerk-Roundtrip)
    if (!forceRefresh && cachedGallerySamples && cachedGallerySamples.length > 0) {
        renderGalleryClassFilters(cachedGallerySamples);
        renderFilteredGallery();
        return;
    }

    // Sofortiges visuelles Feedback via Skeleton-Cards
    renderSkeletonPlaceholders(grid, 8);

    try {
        const url = forceRefresh ? '/api/dataset/samples?force_refresh=true' : '/api/dataset/samples';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        cachedGallerySamples = data.samples || [];

        // Klassen-Chips rendern
        renderGalleryClassFilters(cachedGallerySamples);

        // Gefilterte Ansicht adaptiv rendern
        renderFilteredGallery();

        // Header Update
        const headerText = document.getElementById('header-dataset-text');
        if (headerText && data.stats) {
            headerText.innerText = `Datensatz: ${data.stats.train_images} Train • ${data.stats.val_images} Val (${data.stats.total_annotations} Boxen)`;
        }
    } catch (err) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; color: #fca5a5; padding: 24px; text-align: center;">Fehler beim Laden: ${err.message}</div>`;
    }
}

// Öffnet ein Sample aus dem Datensatz direkt im Studio zur QA / Überarbeitung
async function openSampleInStudio(split, sampleId) {
    try {
        statusDiv.innerText = `Lade Sample ${sampleId}...`;
        const res = await fetch(`/api/dataset/samples/${split}/${sampleId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        suppressAutoStage0 = true;
        // Bild in Preview setzen (direkt via optimierter URL)
        previewImage.src = data.image_url || data.image_base64;
        previewImage.onload = () => {
            suppressAutoStage0 = false;
            resetStageZoomPan();
            const srcW = previewImage.naturalWidth || 640;
            const srcH = previewImage.naturalHeight || 480;

            // Boxen übernehmen (inkl. Footprint, Part-Marking & IC-Subgroup)
            detectedBoxes = (data.boxes || []).map(b => {
                const x1 = Math.round(b.xmin * srcW);
                const y1 = Math.round(b.ymin * srcH);
                const x2 = Math.round(b.xmax * srcW);
                const y2 = Math.round(b.ymax * srcH);
                return {
                    x1, y1, x2, y2,
                    label: b.label || 'other',
                    kind: b.label.includes('ic') ? 'semiconductor' : (b.label.includes('transistor') ? 'semiconductor' : (b.label.includes('resistor') ? 'resistor' : 'other')),
                    confidence: b.confidence !== undefined ? b.confidence : 1.0,
                    score: 95,
                    partMarking: b.part_marking || '',
                    footprint: b.footprint || '',
                    icSubgroup: b.ic_subgroup || ''
                };
            });

            // Split Dropdown aktualisieren
            if (datasetSplit) datasetSplit.value = split;
            splitPillBtns.forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-split') === split);
            });

            // Wechsle in den Studio View
            switchAppView(navStudioBtn);
            if (stage0Summary) stage0Summary.innerText = `Geladen aus Datensatz: ${sampleId} (${detectedBoxes.length} Boxen)`;
            if (statusDiv) statusDiv.innerText = `Sample ${sampleId} im Studio geladen (${detectedBoxes.length} Boxen).`;
            selectComponentBox(0, true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
    } catch (err) {
        alert(`Fehler beim Öffnen: ${err.message}`);
    }
}

// =====================================================================
// CURATION ANALYTICS (ClearML Style)
// =====================================================================
async function loadAnalyticsView() {
    try {
        const res = await fetch('/api/dataset/stats');
        if (!res.ok) return;
        const stats = await res.json();

        const trainImgs = stats.train_images || 0;
        const valImgs = stats.val_images || 0;
        const totalBoxes = stats.total_annotations || 0;
        const counts = stats.class_counts || {};

        document.getElementById('kpi-train-imgs').innerText = trainImgs;
        document.getElementById('kpi-val-imgs').innerText = valImgs;
        document.getElementById('kpi-total-boxes').innerText = totalBoxes;

        // Balance Score berechnen
        const scoreEl = document.getElementById('kpi-balance-score');
        const subEl = document.getElementById('kpi-balance-sub');
        const totalImgs = trainImgs + valImgs;

        if (totalImgs === 0) {
            scoreEl.innerText = '-';
            subEl.innerText = 'Noch keine Trainingsbilder vorhanden';
        } else {
            const valRatio = valImgs / totalImgs;
            if (valRatio >= 0.15 && valRatio <= 0.25) {
                scoreEl.innerText = 'Optimal';
                scoreEl.style.color = '#10b981';
                subEl.innerText = `Train/Val Split: ${(100-valRatio*100).toFixed(0)}% / ${(valRatio*100).toFixed(0)}%`;
            } else if (valImgs === 0) {
                scoreEl.innerText = 'Nur Train';
                scoreEl.style.color = '#f59e0b';
                subEl.innerText = 'Erstelle auch Validation-Samples!';
            } else {
                scoreEl.innerText = 'Ungleich';
                scoreEl.style.color = '#f59e0b';
                subEl.innerText = `Train/Val Split: ${(100-valRatio*100).toFixed(0)}% / ${(valRatio*100).toFixed(0)}%`;
            }
        }

        // Klassenverteilungs-Liste rendern
        const listEl = document.getElementById('analytics-distribution-list');
        if (!listEl) return;

        const maxCount = Math.max(1, ...Object.values(counts));
        listEl.innerHTML = '';

        Object.keys(counts).forEach(cls => {
            const count = counts[cls] || 0;
            const pctOfMax = ((count / maxCount) * 100).toFixed(1);
            const color = getClassColor(cls);

            let healthClass = 'low';
            let healthText = 'Zu wenige (<5)';
            if (count >= 20) {
                healthClass = 'good';
                healthText = 'Gute Basis';
            } else if (count >= 5) {
                healthClass = 'fair';
                healthText = 'Ausbaufähig';
            }

            const row = document.createElement('div');
            row.className = 'dist-row';
            row.innerHTML = `
                <div style="font-weight: 700; display: flex; align-items: center; gap: 6px;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>
                    ${cls}
                </div>
                <div class="dist-bar-track">
                    <div class="dist-bar-fill" style="width: ${pctOfMax}%; background: ${color};"></div>
                </div>
                <div style="font-family: ui-monospace, monospace; font-weight: 700; text-align: right;">${count}</div>
                <div><span class="health-tag ${healthClass}">${healthText}</span></div>
            `;
            listEl.appendChild(row);
        });

    } catch (err) {
        console.error('Analytics Fehler:', err);
    }
}

