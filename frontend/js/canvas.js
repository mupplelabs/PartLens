// =====================================================================
// STAGE ZOOM & PAN SYSTEM + HUD CONTROLLER
// =====================================================================

// =====================================================================
// STAGE ZOOM & PAN SYSTEM (Figma / CAD Style, Space+Drag, Wheel, Touch)
// =====================================================================
let stageZoom = 1.0;
let stagePanX = 0;
let stagePanY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let isSpacePressed = false;
let isPanModeActive = false;
const activeTouchPointers = new Map();
let lastTouchDist = 0;

function applyStageTransform() {
    const wraps = document.querySelectorAll('.image-stage-wrap');
    wraps.forEach(wrap => {
        if (isPanning) {
            wrap.classList.add('is-panning');
        } else {
            wrap.classList.remove('is-panning');
        }
        wrap.style.transform = `translate(${stagePanX}px, ${stagePanY}px) scale(${stageZoom})`;
    });

    const levelBtn = document.getElementById('stage-zoom-reset-btn');
    if (levelBtn) {
        levelBtn.innerText = `${Math.round(stageZoom * 100)}%`;
        levelBtn.title = `Aktueller Zoom: ${Math.round(stageZoom * 100)}% (Klick für 100% Reset)`;
    }
    const compactVal = document.getElementById('stage-hud-compact-val');
    if (compactVal) {
        compactVal.innerText = `${Math.round(stageZoom * 100)}%`;
    }
}

function resetStageZoomPan() {
    stageZoom = 1.0;
    stagePanX = 0;
    stagePanY = 0;
    isPanning = false;
    applyStageTransform();
}

function zoomAtPoint(deltaFactor, clientX, clientY) {
    const viewport = document.querySelector('.stage-viewport');
    if (!viewport) return;
    const vRect = viewport.getBoundingClientRect();
    
    const mouseX = clientX !== undefined ? (clientX - (vRect.left + vRect.width / 2)) : 0;
    const mouseY = clientY !== undefined ? (clientY - (vRect.top + vRect.height / 2)) : 0;

    const oldZoom = stageZoom;
    const newZoom = Math.max(0.4, Math.min(10.0, oldZoom * deltaFactor));
    if (Math.abs(newZoom - oldZoom) < 0.001) return;

    // Zoom zentriert um den Mauszeiger / Touchpunkt ankern
    stagePanX = mouseX - (mouseX - stagePanX) * (newZoom / oldZoom);
    stagePanY = mouseY - (mouseY - stagePanY) * (newZoom / oldZoom);
    stageZoom = newZoom;

    applyStageTransform();
}

function bindOverlayCanvasInteractions(canvasEl) {
    if (!canvasEl) return;

    canvasEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') {
            activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (activeTouchPointers.size === 2) {
                isPanning = true;
                const pts = Array.from(activeTouchPointers.values());
                lastTouchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                panStartX = (pts[0].x + pts[1].x) / 2 - stagePanX;
                panStartY = (pts[0].y + pts[1].y) / 2 - stagePanY;
                applyStageTransform();
                e.preventDefault();
                return;
            }
        }

        if (e.button === 1 || isSpacePressed || isPanModeActive) {
            isPanning = true;
            panStartX = e.clientX - stagePanX;
            panStartY = e.clientY - stagePanY;
            canvasEl.style.cursor = 'grabbing';
            try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
            applyStageTransform();
            e.preventDefault();
            return;
        }

        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const { w: srcW, h: srcH, ready } = getActiveMediaSource();
        if (!ready) return;

        const rect = canvasEl.getBoundingClientRect();
        const imgX = Math.max(0, Math.min(srcW, ((e.clientX - rect.left) / Math.max(1, rect.width)) * srcW));
        const imgY = Math.max(0, Math.min(srcH, ((e.clientY - rect.top) / Math.max(1, rect.height)) * srcH));
        isTouchActive = e.pointerType === 'touch' || e.pointerType === 'pen';

        // Modus 1: Manuelle neue Box zeichnen
        if (isDrawingManualBox) {
            dragMode = 'drawing';
            manualDrawStart = { x: imgX, y: imgY };
            manualDrawCurrent = { x: imgX, y: imgY };
            try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
            drawBboxOverlay();
            e.preventDefault();
            return;
        }

        // Modus 2: Ausgewählte Box an Anfasser resizen
        const selBox = getSelectedComponentBox();
        if (selBox) {
            const hitH = getHitHandle(selBox, e.clientX, e.clientY, canvasEl, srcW, srcH);
            if (hitH) {
                dragMode = 'resizing';
                activeHandle = hitH;
                dragStartPos = { x: imgX, y: imgY, clientX: e.clientX, clientY: e.clientY };
                initialBoxState = { ...selBox };
                try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
                e.preventDefault();
                return;
            }

            // Modus 3: Ausgewählte Box verschieben
            if (isPointInsideBox(selBox, imgX, imgY)) {
                dragMode = 'moving';
                dragStartPos = { x: imgX, y: imgY, clientX: e.clientX, clientY: e.clientY };
                initialBoxState = { ...selBox };
                try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
                e.preventDefault();
                return;
            }
        }

        // Modus 4: Andere Box anklicken/auswählen
        let clickedIdx = -1;
        if (!isolateSelectedBox) {
            for (let i = detectedBoxes.length - 1; i >= 0; i--) {
                if (isPointInsideBox(detectedBoxes[i], imgX, imgY)) {
                    clickedIdx = i;
                    break;
                }
            }
        }

        if (clickedIdx >= 0) {
            selectComponentBox(clickedIdx, true);
            dragMode = 'moving';
            dragStartPos = { x: imgX, y: imgY, clientX: e.clientX, clientY: e.clientY };
            initialBoxState = { ...detectedBoxes[clickedIdx] };
            try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
            return;
        }

        // Modus 5: Klick ins Leere -> Auswahl aufheben
        if (selectedBoxIndex !== -1) {
            selectedBoxIndex = -1;
            if (typeof updateBoxEditBar === 'function') updateBoxEditBar();
            drawBboxOverlay();
            renderStage0Chips();
            updateStage0CropPreview();
        }
    });

    canvasEl.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') {
            activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (activeTouchPointers.size === 2) {
                const pts = Array.from(activeTouchPointers.values());
                const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                const centerX = (pts[0].x + pts[1].x) / 2;
                const centerY = (pts[0].y + pts[1].y) / 2;

                if (lastTouchDist > 0 && Math.abs(currentDist - lastTouchDist) > 2) {
                    const factor = currentDist / lastTouchDist;
                    zoomAtPoint(factor, centerX, centerY);
                }
                lastTouchDist = currentDist;

                stagePanX = centerX - panStartX;
                stagePanY = centerY - panStartY;
                applyStageTransform();
                e.preventDefault();
                return;
            }
        }

        if (isPanning) {
            stagePanX = e.clientX - panStartX;
            stagePanY = e.clientY - panStartY;
            applyStageTransform();
            e.preventDefault();
            return;
        }

        if (isSpacePressed || isPanModeActive) {
            canvasEl.style.cursor = 'grab';
            return;
        }

        const { w: srcW, h: srcH, ready } = getActiveMediaSource();
        if (!ready) return;

        const rect = canvasEl.getBoundingClientRect();
        const imgX = Math.max(0, Math.min(srcW, ((e.clientX - rect.left) / Math.max(1, rect.width)) * srcW));
        const imgY = Math.max(0, Math.min(srcH, ((e.clientY - rect.top) / Math.max(1, rect.height)) * srcH));

        if (dragMode === 'drawing') {
            manualDrawCurrent = { x: imgX, y: imgY };
            drawBboxOverlay();
            e.preventDefault();
            return;
        }

        if (dragMode === 'moving' && selectedBoxIndex >= 0 && initialBoxState && dragStartPos) {
            const dx = imgX - dragStartPos.x;
            const dy = imgY - dragStartPos.y;
            const bw = initialBoxState.x2 - initialBoxState.x1;
            const bh = initialBoxState.y2 - initialBoxState.y1;

            let nx1 = Math.max(0, Math.min(srcW - bw, initialBoxState.x1 + dx));
            let ny1 = Math.max(0, Math.min(srcH - bh, initialBoxState.y1 + dy));
            let nx2 = nx1 + bw;
            let ny2 = ny1 + bh;

            detectedBoxes[selectedBoxIndex].x1 = Math.round(nx1);
            detectedBoxes[selectedBoxIndex].y1 = Math.round(ny1);
            detectedBoxes[selectedBoxIndex].x2 = Math.round(nx2);
            detectedBoxes[selectedBoxIndex].y2 = Math.round(ny2);
            detectedBoxes[selectedBoxIndex].ocrX1 = Math.round(nx1);
            detectedBoxes[selectedBoxIndex].ocrY1 = Math.round(ny1);
            detectedBoxes[selectedBoxIndex].ocrX2 = Math.round(nx2);
            detectedBoxes[selectedBoxIndex].ocrY2 = Math.round(ny2);

            drawBboxOverlay();
            updateStage0CropPreview();
            e.preventDefault();
            return;
        }

        if (dragMode === 'resizing' && selectedBoxIndex >= 0 && initialBoxState && dragStartPos && activeHandle) {
            const dx = imgX - dragStartPos.x;
            const dy = imgY - dragStartPos.y;
            const minSize = 12;

            let { x1, y1, x2, y2 } = initialBoxState;

            if (activeHandle.includes('w')) x1 = Math.min(initialBoxState.x2 - minSize, initialBoxState.x1 + dx);
            if (activeHandle.includes('e')) x2 = Math.max(initialBoxState.x1 + minSize, initialBoxState.x2 + dx);
            if (activeHandle.includes('n')) y1 = Math.min(initialBoxState.y2 - minSize, initialBoxState.y1 + dy);
            if (activeHandle.includes('s')) y2 = Math.max(initialBoxState.y1 + minSize, initialBoxState.y2 + dy);

            x1 = Math.max(0, Math.min(srcW - minSize, x1));
            y1 = Math.max(0, Math.min(srcH - minSize, y1));
            x2 = Math.min(srcW, Math.max(minSize, x2));
            y2 = Math.min(srcH, Math.max(minSize, y2));

            detectedBoxes[selectedBoxIndex].x1 = Math.round(x1);
            detectedBoxes[selectedBoxIndex].y1 = Math.round(y1);
            detectedBoxes[selectedBoxIndex].x2 = Math.round(x2);
            detectedBoxes[selectedBoxIndex].y2 = Math.round(y2);
            detectedBoxes[selectedBoxIndex].ocrX1 = Math.round(x1);
            detectedBoxes[selectedBoxIndex].ocrY1 = Math.round(y1);
            detectedBoxes[selectedBoxIndex].ocrX2 = Math.round(x2);
            detectedBoxes[selectedBoxIndex].ocrY2 = Math.round(y2);

            drawBboxOverlay();
            updateStage0CropPreview();
            e.preventDefault();
            return;
        }

        // Wenn nicht im Drag-Modus: Cursor, Fadenkreuz & Hover anpassen
        mouseImgPos = { x: imgX, y: imgY };

        if (isDrawingManualBox) {
            canvasEl.style.cursor = 'crosshair';
            drawBboxOverlay();
            return;
        }

        const selBox = getSelectedComponentBox();
        if (selBox) {
            const hitH = getHitHandle(selBox, e.clientX, e.clientY, canvasEl, srcW, srcH);
            if (hitH) {
                canvasEl.style.cursor = HANDLE_CURSORS[hitH] || 'pointer';
                drawBboxOverlay();
                return;
            }
            if (isPointInsideBox(selBox, imgX, imgY)) {
                canvasEl.style.cursor = 'move';
                drawBboxOverlay();
                return;
            }
        }

        let hoveredIdx = -1;
        if (!isolateSelectedBox) {
            for (let i = detectedBoxes.length - 1; i >= 0; i--) {
                if (isPointInsideBox(detectedBoxes[i], imgX, imgY)) {
                    hoveredIdx = i;
                    break;
                }
            }
        }

        if (hoveredIdx !== hoveredBoxIndex) {
            hoveredBoxIndex = hoveredIdx;
        }
        drawBboxOverlay();
        canvasEl.style.cursor = hoveredIdx >= 0 ? 'pointer' : 'default';
    });

    const handlePointerEnd = (e) => {
        if (e.pointerType === 'touch') {
            activeTouchPointers.delete(e.pointerId);
            if (activeTouchPointers.size < 2) {
                lastTouchDist = 0;
            }
        }

        if (isPanning) {
            isPanning = false;
            applyStageTransform();
            canvasEl.style.cursor = (isSpacePressed || isPanModeActive) ? 'grab' : 'default';
            try {
                if (canvasEl.hasPointerCapture(e.pointerId)) {
                    canvasEl.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}
            return;
        }

        try {
            if (canvasEl.hasPointerCapture(e.pointerId)) {
                canvasEl.releasePointerCapture(e.pointerId);
            }
        } catch (_) {}

        const { w: srcW, h: srcH } = getActiveMediaSource();

        if (dragMode === 'drawing' && manualDrawStart && manualDrawCurrent) {
            const x1 = Math.max(0, Math.min(manualDrawStart.x, manualDrawCurrent.x));
            const y1 = Math.max(0, Math.min(manualDrawStart.y, manualDrawCurrent.y));
            const x2 = Math.min(srcW, Math.max(manualDrawStart.x, manualDrawCurrent.x));
            const y2 = Math.min(srcH, Math.max(manualDrawStart.y, manualDrawCurrent.y));

            manualDrawStart = null;
            manualDrawCurrent = null;
            dragMode = 'idle';
            if ((x2 - x1) >= 8 && (y2 - y1) >= 8) {
                const classSelect = document.getElementById('box-class-select');
                const defaultClass = classSelect?.value || 'ic';
                detectedBoxes.push({
                    x1: Math.round(x1), y1: Math.round(y1),
                    x2: Math.round(x2), y2: Math.round(y2),
                    ocrX1: Math.round(x1), ocrY1: Math.round(y1),
                    ocrX2: Math.round(x2), ocrY2: Math.round(y2),
                    label: defaultClass,
                    confidence: 1.0,
                    score: 99,
                    kind: (defaultClass === 'ic' || defaultClass === 'transistor' || defaultClass === 'diode' || defaultClass === 'led') ? 'semiconductor' : (defaultClass === 'resistor' ? 'resistor' : 'other')
                });
                const newIdx = detectedBoxes.length - 1;
                if (typeof setCanvasToolMode === 'function') {
                    setCanvasToolMode('select');
                } else {
                    isDrawingManualBox = false;
                }
                selectComponentBox(newIdx, true);
                if (typeof openQuickTagPopoverAt === 'function') {
                    openQuickTagPopoverAt(e.clientX, e.clientY, newIdx);
                }
                const statusEl = document.getElementById('autolabel-status');
                if (statusEl) {
                    statusEl.innerText = `Neue Box #${detectedBoxes.length} (${defaultClass}) gezeichnet: ${Math.round(x2 - x1)}×${Math.round(y2 - y1)} px.`;
                }
            } else {
                if (typeof setCanvasToolMode === 'function') {
                    setCanvasToolMode('select');
                } else {
                    isDrawingManualBox = false;
                }
            }
            drawBboxOverlay();
            if (typeof renderObjectsList === 'function') renderObjectsList();
            return;
        }

        if (dragMode === 'resizing' || dragMode === 'moving') {
            const hadMove = dragStartPos && (Math.abs(e.clientX - dragStartPos.clientX) > 4 || Math.abs(e.clientY - dragStartPos.clientY) > 4);
            dragMode = 'idle';
            activeHandle = null;
            initialBoxState = null;
            dragStartPos = null;

            if (hadMove && selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
                const b = detectedBoxes[selectedBoxIndex];
                const statusEl = document.getElementById('autolabel-status');
                if (statusEl) {
                    statusEl.innerText = `Box #${selectedBoxIndex + 1} (${b.label}) angepasst: ${b.x2 - b.x1}×${b.y2 - b.y1} px.`;
                }
                updateStage0CropPreview();
                renderStage0Chips();
                if (typeof renderObjectsList === 'function') renderObjectsList();
                drawBboxOverlay();
            }
            return;
        }

        dragMode = 'idle';
        activeHandle = null;
        initialBoxState = null;
        dragStartPos = null;
    };

    canvasEl.addEventListener('pointerup', handlePointerEnd);
    canvasEl.addEventListener('pointercancel', handlePointerEnd);

    // Doppelklick auf Box: Öffnet das Floating Quick-Tag Popover direkt an der Box
    canvasEl.addEventListener('dblclick', (e) => {
        const { w: srcW, h: srcH, ready } = getActiveMediaSource();
        if (!ready) return;
        const rect = canvasEl.getBoundingClientRect();
        const imgX = Math.max(0, Math.min(srcW, ((e.clientX - rect.left) / Math.max(1, rect.width)) * srcW));
        const imgY = Math.max(0, Math.min(srcH, ((e.clientY - rect.top) / Math.max(1, rect.height)) * srcH));
        for (let i = detectedBoxes.length - 1; i >= 0; i--) {
            if (isPointInsideBox(detectedBoxes[i], imgX, imgY)) {
                e.preventDefault();
                selectComponentBox(i, true);
                if (typeof openQuickTagPopoverAt === 'function') {
                    openQuickTagPopoverAt(e.clientX, e.clientY, i);
                }
                return;
            }
        }
    });

    // Rechtsklick (Context Menu) auf Box: Direktes Quick-Tag Popover / Klassenwechsel
    canvasEl.addEventListener('contextmenu', (e) => {
        const { w: srcW, h: srcH, ready } = getActiveMediaSource();
        if (!ready) return;
        const rect = canvasEl.getBoundingClientRect();
        const imgX = Math.max(0, Math.min(srcW, ((e.clientX - rect.left) / Math.max(1, rect.width)) * srcW));
        const imgY = Math.max(0, Math.min(srcH, ((e.clientY - rect.top) / Math.max(1, rect.height)) * srcH));
        for (let i = detectedBoxes.length - 1; i >= 0; i--) {
            if (isPointInsideBox(detectedBoxes[i], imgX, imgY)) {
                e.preventDefault();
                selectComponentBox(i, true);
                if (typeof openQuickTagPopoverAt === 'function') {
                    openQuickTagPopoverAt(e.clientX, e.clientY, i);
                }
                return;
            }
        }
    });

    canvasEl.addEventListener('mouseleave', () => {
        mouseImgPos = null;
        if (dragMode === 'idle' && hoveredBoxIndex !== -1) {
            hoveredBoxIndex = -1;
        }
        drawBboxOverlay();
    });
}

bindOverlayCanvasInteractions(bboxOverlayCanvas);
bindOverlayCanvasInteractions(webcamBboxCanvas);

// Stage Viewport Mouse Wheel Zoom & Background Panning
const stageViewportEl = document.querySelector('.stage-viewport');
if (stageViewportEl) {
    stageViewportEl.addEventListener('wheel', (e) => {
        if (e.target && e.target.closest('#stage-zoom-bar, #autolabel-loading-overlay')) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        zoomAtPoint(factor, e.clientX, e.clientY);
    }, { passive: false });

    stageViewportEl.addEventListener('pointerdown', (e) => {
        // Interaktive Steuerelemente (Buttons, Selects, Inputs, Toolbars) dürfen NICHT durch Pan abgefangen werden
        if (e.target && e.target.closest('button, select, input, label, a, #stage-zoom-bar, #autolabel-loading-overlay, #webcam-controls-bar, .webcam-controls-bar')) return;
        if (e.target && (e.target.tagName === 'CANVAS' || e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO')) return;
        if (e.button === 1 || isSpacePressed || isPanModeActive || (e.button === 0 && (e.target === stageViewportEl || e.target.id === 'upload-panel' || e.target.id === 'webcam-panel'))) {
            isPanning = true;
            panStartX = e.clientX - stagePanX;
            panStartY = e.clientY - stagePanY;
            stageViewportEl.style.cursor = 'grabbing';
            try { stageViewportEl.setPointerCapture(e.pointerId); } catch (_) {}
            applyStageTransform();
            e.preventDefault();
        }
    });
    stageViewportEl.addEventListener('pointermove', (e) => {
        if (isPanning && stageViewportEl.hasPointerCapture(e.pointerId)) {
            stagePanX = e.clientX - panStartX;
            stagePanY = e.clientY - panStartY;
            applyStageTransform();
        }
    });
    const handleViewportPointerEnd = (e) => {
        if (isPanning && stageViewportEl.hasPointerCapture(e.pointerId)) {
            try { stageViewportEl.releasePointerCapture(e.pointerId); } catch (_) {}
            isPanning = false;
            stageViewportEl.style.cursor = '';
            applyStageTransform();
        }
    };
    stageViewportEl.addEventListener('pointerup', handleViewportPointerEnd);
    stageViewportEl.addEventListener('pointercancel', handleViewportPointerEnd);

    const webcamControlsBar = document.getElementById('webcam-controls-bar');
    if (webcamControlsBar) {
        webcamControlsBar.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
}

// Space Key for Pan Gesture (Photoshop / Figma Style), 'O' for Box Opacity Toggle & 'H' for Stage HUD Toggle
window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.code === 'Space' && !e.repeat) {
        isSpacePressed = true;
        const overlay = currentMode === 'webcam' ? webcamBboxCanvas : bboxOverlayCanvas;
        if (overlay) overlay.style.cursor = 'grab';
        e.preventDefault();
    }
    if (e.code === 'KeyO' && !e.repeat) {
        if (toggleOpacityMuteBtn) {
            toggleOpacityMuteBtn.click();
            e.preventDefault();
        }
    }
    if (e.code === 'KeyH' && !e.repeat) {
        if (typeof toggleHudCollapse === 'function') {
            toggleHudCollapse();
            e.preventDefault();
        }
    }
    if (e.code === 'KeyF' && !e.repeat) {
        if (typeof toggleIsolateSelectedBox === 'function') {
            toggleIsolateSelectedBox();
            e.preventDefault();
        }
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isSpacePressed = false;
        const overlay = currentMode === 'webcam' ? webcamBboxCanvas : bboxOverlayCanvas;
        if (overlay && !isPanModeActive) overlay.style.cursor = 'default';
    }
});

// Stage Zoom & Pan Toolbar Controls
const stagePanToolBtn = document.getElementById('stage-pan-tool-btn');
const stageZoomOutBtn = document.getElementById('stage-zoom-out-btn');
const stageZoomResetBtn = document.getElementById('stage-zoom-reset-btn');
const stageZoomInBtn = document.getElementById('stage-zoom-in-btn');
const stageZoomFitBtn = document.getElementById('stage-zoom-fit-btn');

if (stagePanToolBtn) {
    stagePanToolBtn.addEventListener('click', () => {
        isPanModeActive = !isPanModeActive;
        stagePanToolBtn.classList.toggle('active', isPanModeActive);
        const overlay = currentMode === 'webcam' ? webcamBboxCanvas : bboxOverlayCanvas;
        if (overlay) overlay.style.cursor = isPanModeActive ? 'grab' : 'default';
    });
}

if (stageZoomInBtn) {
    stageZoomInBtn.addEventListener('click', () => {
        const viewport = document.querySelector('.stage-viewport');
        const rect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 400 };
        zoomAtPoint(1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
}

if (stageZoomOutBtn) {
    stageZoomOutBtn.addEventListener('click', () => {
        const viewport = document.querySelector('.stage-viewport');
        const rect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 400 };
        zoomAtPoint(0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
}

if (stageZoomResetBtn) {
    stageZoomResetBtn.addEventListener('click', () => resetStageZoomPan());
}

if (stageZoomFitBtn) {
    stageZoomFitBtn.addEventListener('click', () => resetStageZoomPan());
}

// Box Opacity Slider & Quick Mute Toggle (CVAT / Dataloop Style)
const boxOpacitySlider = document.getElementById('box-opacity-slider');
const boxOpacityVal = document.getElementById('box-opacity-val');
const toggleOpacityMuteBtn = document.getElementById('toggle-opacity-mute-btn');

function updateOpacityUI(val) {
    boxFillOpacity = Math.max(0, Math.min(0.6, val));
    if (boxOpacitySlider) boxOpacitySlider.value = Math.round(boxFillOpacity * 100);
    if (boxOpacityVal) boxOpacityVal.textContent = Math.round(boxFillOpacity * 100) + '%';
    if (toggleOpacityMuteBtn) {
        toggleOpacityMuteBtn.classList.toggle('active', boxFillOpacity === 0);
        toggleOpacityMuteBtn.title = boxFillOpacity === 0 ? 'Transparenz wiederherstellen (Taste O)' : 'Boxen-Füllung ausblenden für Leiterbahnen (Taste O)';
        toggleOpacityMuteBtn.innerHTML = boxFillOpacity === 0 
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path></svg>`;
    }
    try { localStorage.setItem('box_opacity', boxFillOpacity.toString()); } catch (_) {}
    drawBboxOverlay();
}

updateOpacityUI(boxFillOpacity);

if (boxOpacitySlider) {
    boxOpacitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) / 100;
        if (val > 0) prevBoxFillOpacity = val;
        updateOpacityUI(val);
    });
}

if (toggleOpacityMuteBtn) {
    toggleOpacityMuteBtn.addEventListener('click', () => {
        if (boxFillOpacity > 0) {
            prevBoxFillOpacity = boxFillOpacity;
            updateOpacityUI(0);
        } else {
            updateOpacityUI(prevBoxFillOpacity > 0 ? prevBoxFillOpacity : 0.14);
        }
    });
}

// =====================================================================
// STAGE HUD DOCKING & COLLAPSE CONTROLLER (Option 3: Rechts / Mitte / Einklappen)
// =====================================================================
const stageZoomBar = document.getElementById('stage-zoom-bar');
const stageHudDockBtn = document.getElementById('stage-hud-dock-btn');
const stageHudCollapseBtn = document.getElementById('stage-hud-collapse-btn');
const stageHudExpandHint = document.getElementById('stage-hud-expand-hint');

let hudDockPosition = localStorage.getItem('stage_hud_dock') || 'bottom-right';
const isMobileScreenInit = window.innerWidth <= 768;
let hudIsCollapsed = isMobileScreenInit ? true : (localStorage.getItem('stage_hud_collapsed') === 'true');

function applyHudState() {
    if (!stageZoomBar) return;

    // Docking Klasse setzen
    stageZoomBar.classList.remove('dock-bottom-right', 'dock-bottom-center');
    if (hudDockPosition === 'bottom-center') {
        stageZoomBar.classList.add('dock-bottom-center');
        if (stageHudDockBtn) {
            stageHudDockBtn.title = 'Position wechseln: Zu Unten-Rechts andocken';
            stageHudDockBtn.innerHTML = '<svg class="tool-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M13 15h6v4h-6z"/></svg>';
        }
    } else {
        stageZoomBar.classList.add('dock-bottom-right');
        if (stageHudDockBtn) {
            stageHudDockBtn.title = 'Position wechseln: Zu Unten-Mitte andocken';
            stageHudDockBtn.innerHTML = '<svg class="tool-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 15h6v4h-6z"/></svg>';
        }
    }

    // Collapsed Zustand setzen
    stageZoomBar.classList.toggle('collapsed', hudIsCollapsed);
    try {
        localStorage.setItem('stage_hud_dock', hudDockPosition);
        localStorage.setItem('stage_hud_collapsed', hudIsCollapsed ? 'true' : 'false');
    } catch (_) {}
}

function toggleHudDock() {
    hudDockPosition = (hudDockPosition === 'bottom-right') ? 'bottom-center' : 'bottom-right';
    applyHudState();
}

function toggleHudCollapse() {
    hudIsCollapsed = !hudIsCollapsed;
    applyHudState();
}
window.toggleHudCollapse = toggleHudCollapse;
window.toggleHudDock = toggleHudDock;

if (stageHudDockBtn) {
    stageHudDockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHudDock();
    });
}

if (stageHudCollapseBtn) {
    stageHudCollapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHudCollapse();
    });
}

if (stageHudExpandHint) {
    stageHudExpandHint.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hudIsCollapsed) {
            hudIsCollapsed = false;
            applyHudState();
        }
    });
}

if (stageZoomBar) {
    stageZoomBar.addEventListener('click', () => {
        if (hudIsCollapsed) {
            hudIsCollapsed = false;
            applyHudState();
        }
    });
}

applyHudState();

if (runDetectBtn) {
    runDetectBtn.addEventListener('click', () => runStage0Detection());
}

// Subtiles Stage-Hinweis-Banner Schließen & Preference Persistierung
const stageHintBanner = document.getElementById('stage-hint-banner');
const btnCloseStageHint = document.getElementById('btn-close-stage-hint');
if (btnCloseStageHint && stageHintBanner) {
    try {
        if (localStorage.getItem('partlens_hide_stage_hint') === '1') {
            stageHintBanner.style.display = 'none';
        }
    } catch (_) {}
    btnCloseStageHint.addEventListener('click', () => {
        stageHintBanner.style.display = 'none';
        try {
            localStorage.setItem('partlens_hide_stage_hint', '1');
        } catch (_) {}
    });
}

