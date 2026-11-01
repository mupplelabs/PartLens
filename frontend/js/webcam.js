// =====================================================================
// WEBCAM & LIVE UI EVENTS
// =====================================================================

// =====================================================================
// WEBCAM & UI-EVENTS (INKL. LIVE STUFE 0 + STUFE 1 + AUTO/SNAPSHOT OCR)
// =====================================================================

let lastWebcamStage0At = 0;

async function classifyWebcamLoop() {
    if (currentMode !== 'webcam' || !webcamRunning) return;

    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const now = performance.now();

        // 1. Live Stufe-0 Smart-Hybrid-Detektion (~3.5 fps für ruhige Boxen & flüssige UI)
        if (now - lastWebcamStage0At > 280) {
            lastWebcamStage0At = now;
            const t0 = performance.now();
            const boxes = detectSmartHybridBoxes(video, video.videoWidth, video.videoHeight);
            const dtMs = Math.round(performance.now() - t0);
            detectedBoxes = boxes;

            if (detectedBoxes.length === 0) {
                if (selectedBoxIndex !== -2) {
                    selectedBoxIndex = -1;
                }
                stage0Summary.innerText = window.t
                    ? window.t('canvas.webcam_live_no_component', { ms: dtMs })
                    : `Live: Kein Bauteil erkannt (${dtMs} ms) – halte ein Bauteil vor die Kamera`;
                drawBboxOverlay();
                renderStage0Chips();
                updateStage0CropPreview();
                if (selectedBoxIndex !== -2) {
                    classifyCurrentImage();
                }
            } else {
                if (selectedBoxIndex >= detectedBoxes.length || selectedBoxIndex < 0) {
                    let bestIdx = 0;
                    let bestScore = -Infinity;
                    detectedBoxes.forEach((b, i) => {
                        if ((b.score ?? 0) > bestScore) {
                            bestScore = b.score ?? 0;
                            bestIdx = i;
                        }
                    });
                    selectedBoxIndex = bestIdx;
                }

                const focusLabel = selectedBoxIndex >= 0
                    ? (window.t ? window.t('canvas.focus_component', { idx: selectedBoxIndex + 1 }) : `Bauteil #${selectedBoxIndex + 1} fokussiert`)
                    : (window.t ? window.t('canvas.full_image_active') : 'Gesamtbild aktiv');
                stage0Summary.innerText = window.t
                    ? window.t('canvas.webcam_live_detected', { count: detectedBoxes.length, ms: dtMs, focus: focusLabel })
                    : `Live: ${detectedBoxes.length} Bauteil${detectedBoxes.length === 1 ? '' : 'e'} (${dtMs} ms) – ${focusLabel}`;

                drawBboxOverlay();
                renderStage0Chips();
                updateStage0CropPreview();

                if (!isOcrRunning) {
                    prepareOcrImageDataUrl();
                }

                const selBox = getSelectedComponentBox();
                if (selBox && selBox.kind === 'resistor') {
                    scanResistorBandsFromImage();
                }
            }
        }

        // 2. Live Stufe-1 CLIP Zero-Shot Klassifizierung (nur wenn ein Bauteil erkannt wurde oder Gesamtbild erzwungen ist)
        if (activeClassifier && !isInferencing && (detectedBoxes.length > 0 || selectedBoxIndex === -2)) {
            await classifyCurrentImage();
        }

        // 3. Optionales Live Auto-OCR (nur wenn ein Bauteil erkannt wurde)
        if (webcamAutoOcrCb && webcamAutoOcrCb.checked && !isOcrRunning && detectedBoxes.length > 0 && (now - lastWebcamAutoOcrAt > 3500)) {
            lastWebcamAutoOcrAt = now;
            executeOcrRecognition();
        }
    }

    if (currentMode === 'webcam' && webcamRunning) {
        requestAnimationFrame(classifyWebcamLoop);
    }
}

async function startWebcam(deviceId = null) {
    const fallbackCard = document.getElementById('webcam-fallback-card');
    const videoWrap = document.querySelector('#webcam-panel .image-stage-wrap');
    const hasMediaDevices = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

    // Fallback für iOS Safari auf HTTP (wo WebRTC getUserMedia von Apple gesperrt ist)
    if (!hasMediaDevices) {
        console.warn('navigator.mediaDevices.getUserMedia nicht verfügbar (iOS Safari erfordert HTTPS für Live-Streams).');
        if (videoWrap) videoWrap.style.display = 'none';
        if (fallbackCard) fallbackCard.style.display = 'block';
        if (cameraSelect) {
            const optLabel = window.t ? window.t('webcam.native_camera_opt') : 'iPhone-Kamera (Direktaufnahme)';
            cameraSelect.innerHTML = `<option value="native">${optLabel}</option>`;
        }
        if (toggleWebcamBtn) toggleWebcamBtn.style.display = 'none';
        if (captureWebcamBtn) {
            const btnLabel = window.t ? window.t('webcam.capture_btn') : 'Foto aufnehmen';
            captureWebcamBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>${btnLabel}</span>`;
        }
        if (statusDiv) {
            statusDiv.innerText = window.t ? window.t('webcam.ios_notice') : 'iOS Safari HTTP-Modus: Bitte Snapshot mit iPhone-Kamera aufnehmen.';
        }
        return;
    }

    if (videoWrap) videoWrap.style.display = 'inline-block';
    if (fallbackCard) fallbackCard.style.display = 'none';
    if (toggleWebcamBtn) toggleWebcamBtn.style.display = 'inline-flex';
    if (captureWebcamBtn) {
        captureWebcamBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Snapshot</span>';
    }

    try {
        if (currentStream) {
            currentStream.getTracks().forEach(t => t.stop());
        }

        // Kaskadierende Constraints für maximale Kompatibilität mit iOS Safari, Android & Desktop
        let stream = null;
        const attempts = [];
        if (deviceId && deviceId !== 'native') {
            attempts.push({ video: { deviceId: { ideal: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } });
            attempts.push({ video: { deviceId: { ideal: deviceId } } });
        }
        attempts.push({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        attempts.push({ video: { facingMode: { ideal: 'environment' } } });
        attempts.push({ video: true });

        for (const c of attempts) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(c);
                if (stream) break;
            } catch (e) {
                console.warn('getUserMedia Constraint fehlgeschlagen:', c, e);
            }
        }

        if (!stream) {
            throw new Error('Kein kompatibler Videostream gefunden');
        }

        currentStream = stream;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.srcObject = currentStream;

        // Warten bis Video-Metadaten geladen sind
        await new Promise((resolve) => {
            if (video.readyState >= 1) return resolve();
            video.onloadedmetadata = () => resolve();
            setTimeout(resolve, 1200);
        });

        await video.play().catch(e => console.warn('video.play() abgewiesen:', e));
        webcamRunning = true;
        toggleWebcamBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>';

        // Kamera-Auswahl Dropdown befüllen
        const activeTrack = currentStream?.getVideoTracks()?.[0];
        const activeDeviceId = activeTrack?.getSettings()?.deviceId || deviceId;
        let videoDevices = [];
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            videoDevices = devices.filter(d => d.kind === 'videoinput');
        } catch (_) {}

        cameraSelect.innerHTML = '';
        if (videoDevices.length > 0) {
            videoDevices.forEach((d, idx) => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                let label = d.label;
                if (!label) {
                    label = idx === 0 ? 'Hauptkamera (Rückseite)' : (idx === 1 ? 'Frontkamera' : `Kamera ${idx + 1}`);
                }
                opt.textContent = label;
                if (activeDeviceId && d.deviceId === activeDeviceId) opt.selected = true;
                cameraSelect.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Standard-Kamera';
            cameraSelect.appendChild(opt);
        }

        statusDiv.innerText = window.t ? window.t('webcam.live_active') : 'Live-Webcam aktiv – Stufe 0 & Stufe 1 laufen in Echtzeit.';
        requestAnimationFrame(classifyWebcamLoop);
    } catch (err) {
        console.error('Kamera-Fehler:', err);
        if (videoWrap) videoWrap.style.display = 'none';
        if (fallbackCard) fallbackCard.style.display = 'block';
        if (cameraSelect) {
            const optLabel = window.t ? window.t('webcam.native_camera_opt') : 'iPhone-Kamera (Direktaufnahme)';
            cameraSelect.innerHTML = `<option value="native">${optLabel}</option>`;
        }
        if (statusDiv) {
            statusDiv.innerText = window.t ? window.t('webcam.start_failed') : 'Kamera konnte nicht gestartet werden – bitte Direktaufnahme nutzen.';
        }
    }
}

function stopWebcam() {
    webcamRunning = false;
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
    }
    if (video) {
        video.pause();
        video.srcObject = null;
    }
}

tabUpload.addEventListener('click', () => {
    currentMode = 'upload';
    tabUpload.classList.add('active');
    tabWebcam.classList.remove('active');
    uploadPanel.style.display = 'flex';
    webcamPanel.style.display = 'none';
    stopWebcam();
    if (typeof fitImageToWorkspace === 'function') fitImageToWorkspace();
    else resetStageZoomPan();
    runStage0Detection();
});

tabWebcam.addEventListener('click', async () => {
    currentMode = 'webcam';
    tabWebcam.classList.add('active');
    tabUpload.classList.remove('active');
    uploadPanel.style.display = 'none';
    webcamPanel.style.display = 'flex';
    if (typeof fitImageToWorkspace === 'function') fitImageToWorkspace();
    else resetStageZoomPan();
    await startWebcam(cameraSelect.value || null);
});

cameraSelect.addEventListener('change', () => {
    if (cameraSelect.value && cameraSelect.value !== 'native') {
        startWebcam(cameraSelect.value);
    } else if (cameraSelect.value === 'native') {
        if (cameraFileInput) cameraFileInput.click();
    }
});

toggleWebcamBtn.addEventListener('click', () => {
    webcamRunning = !webcamRunning;
    toggleWebcamBtn.innerHTML = webcamRunning 
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Live</span>';
    if (webcamRunning) {
        video.play().catch(() => {});
        requestAnimationFrame(classifyWebcamLoop);
    } else {
        video.pause();
        statusDiv.innerText = 'Standbild pausiert – klicke auf eine Box oder starte OCR.';
    }
});

let isSnapshotPendingOcr = false;

if (captureWebcamBtn) {
    captureWebcamBtn.addEventListener('click', async () => {
        if (currentMode !== 'webcam') return;

        // Fallback für iPhone / wenn kein aktiver Stream vorhanden ist
        if (!currentStream || !webcamRunning || !video.videoWidth) {
            if (cameraFileInput) {
                cameraFileInput.click();
            }
            return;
        }

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) {
            statusDiv.innerText = window.t ? window.t('webcam.loading_image') : 'Kamerabild wird geladen... Bitte einen Moment gedulden.';
            return;
        }

        statusDiv.innerText = window.t ? window.t('webcam.snapshot_captured') : 'Snapshot erfasst – Übertrage Foto ins Studio und beende Kamera...';

        // 1. Snapshot in voller Video-Auflösung auf Offscreen-Canvas erfassen
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = vw;
        snapCanvas.height = vh;
        const snapCtx = snapCanvas.getContext('2d');
        snapCtx.drawImage(video, 0, 0, vw, vh);
        const snapshotDataUrl = snapCanvas.toDataURL('image/jpeg', 0.95);

        // 2. Kamera sauber stoppen & Hardware-Stream freigeben (Kamera-LED erlischt)
        stopWebcam();

        // 3. UI in den Foto-/Upload-Modus umschalten
        currentMode = 'upload';
        tabUpload.classList.add('active');
        tabWebcam.classList.remove('active');
        uploadPanel.style.display = 'block';
        webcamPanel.style.display = 'none';

        // 4. Foto als Hauptbild im Studio setzen (triggert onload -> Detektion & OCR)
        isSnapshotPendingOcr = true;
        previewImage.src = snapshotDataUrl;
    });
}

const btnTriggerCameraSnap = document.getElementById('btn-trigger-camera-snap');
if (btnTriggerCameraSnap) {
    btnTriggerCameraSnap.addEventListener('click', () => {
        if (cameraFileInput) cameraFileInput.click();
    });
}

reclassifyBtn.addEventListener('click', async () => {
    if (!activeClassifier) {
        await initClipClassifier();
    } else {
        classifyCurrentImage();
    }
});

customClassesInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        if (!activeClassifier) {
            await initClipClassifier();
        } else {
            classifyCurrentImage();
        }
    }
});

document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (currentMode !== 'upload') {
            tabUpload.click();
        }
        const targetSrc = btn.dataset.src;
        if (previewImage.getAttribute('src') === targetSrc && previewImage.complete && previewImage.naturalWidth) {
            resetStageZoomPan();
            runStage0Detection();
        } else {
            previewImage.src = targetSrc;
        }
    });
});

previewImage.addEventListener('load', async () => {
    if (typeof fitImageToWorkspace === 'function') fitImageToWorkspace();
    else resetStageZoomPan();
    if (typeof suppressAutoStage0 !== 'undefined' && suppressAutoStage0) {
        if (typeof setStudioToolsState === 'function') {
            setStudioToolsState(true);
        }
        return;
    }
    if (currentMode === 'upload') {
        await runStage0Detection();
        if (isSnapshotPendingOcr) {
            isSnapshotPendingOcr = false;
            statusDiv.innerText = window.t ? window.t('webcam.snapshot_loaded_ocr') : 'Snapshot als Foto im Studio geladen – führe OCR aus...';
            await executeOcrRecognition();
        }
    }
    if (typeof setStudioToolsState === 'function') {
        setStudioToolsState(true);
    }
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
    fileInput.value = '';
});

function handleFile(file) {
    if (currentMode !== 'upload') {
        tabUpload.click();
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        if (previewImage.src === e.target.result && previewImage.complete && previewImage.naturalWidth) {
            resetStageZoomPan();
            runStage0Detection();
        } else {
            previewImage.src = e.target.result;
        }
    };
    reader.readAsDataURL(file);
}

