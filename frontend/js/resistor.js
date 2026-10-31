// =====================================================================
// STUFE 3: WIDERSTANDS-FARBCODE-SCANNER & SMD-RECHNER
// =====================================================================

// =====================================================================
// STUFE 3: WIDERSTANDS-FARBCODE-SCANNER & SMD-RECHNER
// =====================================================================

let resistorBandMode = 4; // 4 oder 5
let activeBandIndex = 0;   // 0..3 (4-Ring) oder 0..4 (5-Ring)
let resistorBodyType = 'carbon'; // 'carbon' (Beige) oder 'metal' (Blau)
let currentResistorBands = ['yellow', 'violet', 'red', 'gold', 'brown'];

function formatOhms(ohms) {
    if (ohms >= 1e9) return `${(ohms / 1e9).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} GΩ`;
    if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} MΩ`;
    if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} kΩ`;
    if (ohms < 10) return `${ohms.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} Ω`;
    return `${Math.round(ohms)} Ω`;
}

function formatMultiplier(mult) {
    if (mult >= 1e9) return '×1G';
    if (mult >= 1e6) return `×${mult / 1e6}M`;
    if (mult >= 1e3) return `×${mult / 1e3}k`;
    if (mult === 100) return '×100';
    if (mult === 10) return '×10';
    if (mult === 1) return '×1';
    if (mult === 0.1) return '×0,1';
    if (mult === 0.01) return '×0,01';
    return `×${mult}`;
}

function getSlotType(index) {
    if (resistorBandMode === 5) {
        if (index <= 2) return 'digit';
        if (index === 3) return 'mult';
        return 'tol';
    }
    if (index <= 1) return 'digit';
    if (index === 2) return 'mult';
    return 'tol';
}

function getSlotLabel(index) {
    if (window.t) {
        if (resistorBandMode === 5) {
            const keys = ['studio.resistor.band_digit_1', 'studio.resistor.band_digit_2', 'studio.resistor.band_digit_3', 'studio.resistor.band_multiplier', 'studio.resistor.band_tolerance'];
            return window.t(keys[index]) || '';
        }
        const keys = ['studio.resistor.band_digit_1', 'studio.resistor.band_digit_2', 'studio.resistor.band_multiplier', 'studio.resistor.band_tolerance'];
        return window.t(keys[index]) || '';
    }
    if (resistorBandMode === 5) {
        return ['1. Ziffer', '2. Ziffer', '3. Ziffer', 'Multiplikator', 'Toleranz'][index] || '';
    }
    return ['1. Ziffer', '2. Ziffer', 'Multiplikator', 'Toleranz'][index] || '';
}

function setResistorBandMode(mode, keepBody = false) {
    resistorBandMode = mode;
    if (resistorMode4Btn && resistorMode5Btn) {
        resistorMode4Btn.classList.toggle('active', mode === 4);
        resistorMode5Btn.classList.toggle('active', mode === 5);
    }
    if (!keepBody) {
        setResistorBodyType(mode === 5 ? 'metal' : 'carbon');
    }
    if (activeBandIndex >= mode) {
        activeBandIndex = mode - 1;
    }
    updateResistorCalculation();
    renderBandCards();
    renderSwatchGrid();
}

function setResistorBodyType(type) {
    resistorBodyType = type;
    if (resistorBodyGraphic) {
        resistorBodyGraphic.className = `resistor-body resistor-body-${type}`;
    }
    if (resistorBodyTypeBtn) {
        if (window.t) {
            resistorBodyTypeBtn.innerText = type === 'metal' ? window.t('studio.resistor.body_metal') : window.t('studio.resistor.body_carbon');
        } else {
            resistorBodyTypeBtn.innerText = type === 'metal' ? 'Metall (Blau)' : 'Kohle (Beige)';
        }
    }
}

window.addEventListener('languageChanged', () => {
    setResistorBodyType(resistorBodyType);
    renderBandCards();
    renderSwatchGrid();
});

function setActiveBandIndex(index) {
    activeBandIndex = Math.max(0, Math.min(resistorBandMode - 1, index));
    updateGraphicBandSelection();
    renderBandCards();
    renderSwatchGrid();
}

function updateGraphicBandSelection() {
    visBands.forEach((bandEl, idx) => {
        if (!bandEl) return;
        bandEl.classList.toggle('active', idx === activeBandIndex);
    });
}

function renderBandCards() {
    if (!resistorBandCards) return;
    resistorBandCards.className = `resistor-band-cards mode-${resistorBandMode}`;
    resistorBandCards.innerHTML = '';

    for (let i = 0; i < resistorBandMode; i++) {
        const colorKey = currentResistorBands[i] || 'brown';
        const c = COLOR_BY_KEY[colorKey] || COLOR_BY_KEY.brown;
        const slotType = getSlotType(i);

        let valText = '';
        if (slotType === 'digit') valText = `${c.digit ?? 0}`;
        else if (slotType === 'mult') valText = formatMultiplier(c.mult ?? 1);
        else valText = c.tol || '±5%';

        const card = document.createElement('div');
        card.className = `resistor-band-card${i === activeBandIndex ? ' active' : ''}`;
        card.setAttribute('data-index', String(i));
        card.title = `Ring ${i + 1}: ${getSlotLabel(i)} (${c.name}) - Klicken zum Ändern`;
        card.innerHTML = `
            <span class="band-card-label">${getSlotLabel(i)}</span>
            <div class="band-card-dot" style="background: ${c.hex};"></div>
            <span class="band-card-val">${valText}</span>
        `;
        card.addEventListener('click', () => {
            setActiveBandIndex(i);
        });
        resistorBandCards.appendChild(card);
    }
}

function renderSwatchGrid() {
    if (!resistorSwatchGrid) return;
    const slotType = getSlotType(activeBandIndex);

    if (activeBandLabel) {
        activeBandLabel.innerText = `Ausgewählt: Ring ${activeBandIndex + 1} (${getSlotLabel(activeBandIndex)})`;
    }
    if (paletteHint) {
        paletteHint.innerText = 'Farbe zum Zuweisen wählen:';
    }

    resistorSwatchGrid.innerHTML = '';
    for (const c of RESISTOR_COLORS) {
        let isValid = false;
        let displayVal = '';

        if (slotType === 'digit') {
            isValid = (c.digit !== null);
            displayVal = isValid ? `${c.digit}` : '-';
        } else if (slotType === 'mult') {
            isValid = (c.mult !== null);
            displayVal = isValid ? formatMultiplier(c.mult) : '-';
        } else if (slotType === 'tol') {
            isValid = (c.tol !== null);
            displayVal = isValid ? c.tol : '-';
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch-btn';
        if (!isValid) btn.disabled = true;

        const shortName = c.name.split(' ')[0];
        btn.title = isValid ? `${shortName}: ${displayVal}` : `${shortName} (nicht für ${getSlotLabel(activeBandIndex)})`;
        btn.innerHTML = `
            <div class="swatch-color-pill" style="background: ${c.hex};"></div>
            <span class="swatch-name">${shortName}</span>
            <span class="swatch-val">${displayVal}</span>
        `;

        if (isValid) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentResistorBands[activeBandIndex] = c.key;
                updateResistorCalculation();
                // Auto-advance to next band
                setActiveBandIndex((activeBandIndex + 1) % resistorBandMode);
            });
        }
        resistorSwatchGrid.appendChild(btn);
    }
}

function updateResistorCalculation() {
    let ohms = 0;
    let tol = '±5%';

    if (resistorBandMode === 5) {
        const c0 = COLOR_BY_KEY[currentResistorBands[0]] || COLOR_BY_KEY.yellow;
        const c1 = COLOR_BY_KEY[currentResistorBands[1]] || COLOR_BY_KEY.violet;
        const c2 = COLOR_BY_KEY[currentResistorBands[2]] || COLOR_BY_KEY.black;
        const c3 = COLOR_BY_KEY[currentResistorBands[3]] || COLOR_BY_KEY.brown;
        const c4 = COLOR_BY_KEY[currentResistorBands[4]] || COLOR_BY_KEY.brown;

        if (visBands[0]) visBands[0].style.background = c0.hex;
        if (visBands[1]) visBands[1].style.background = c1.hex;
        if (visBands[2]) visBands[2].style.background = c2.hex;
        if (visBands[3]) {
            visBands[3].style.background = c3.hex;
            visBands[3].classList.remove('tol');
        }
        if (visBands[4]) {
            visBands[4].style.background = c4.hex;
            visBands[4].style.display = 'block';
            visBands[4].classList.add('tol');
        }

        const baseVal = (c0.digit ?? 0) * 100 + (c1.digit ?? 0) * 10 + (c2.digit ?? 0);
        ohms = baseVal * (c3.mult ?? 1);
        tol = c4.tol || '±1%';

        if (band1Select) band1Select.value = c0.key;
        if (band2Select) band2Select.value = c1.key;
        if (band3Select) band3Select.value = c2.key;
        if (band4Select) band4Select.value = c3.key;
        if (band5Select) band5Select.value = c4.key;
    } else {
        const c0 = COLOR_BY_KEY[currentResistorBands[0]] || COLOR_BY_KEY.yellow;
        const c1 = COLOR_BY_KEY[currentResistorBands[1]] || COLOR_BY_KEY.violet;
        const c2 = COLOR_BY_KEY[currentResistorBands[2]] || COLOR_BY_KEY.red;
        const c3 = COLOR_BY_KEY[currentResistorBands[3]] || COLOR_BY_KEY.gold;

        if (visBands[0]) visBands[0].style.background = c0.hex;
        if (visBands[1]) visBands[1].style.background = c1.hex;
        if (visBands[2]) visBands[2].style.background = c2.hex;
        if (visBands[3]) {
            visBands[3].style.background = c3.hex;
            visBands[3].classList.add('tol');
        }
        if (visBands[4]) {
            visBands[4].style.display = 'none';
            visBands[4].classList.remove('tol');
        }

        const baseVal = (c0.digit ?? 0) * 10 + (c1.digit ?? 0);
        ohms = baseVal * (c2.mult ?? 1);
        tol = c3.tol || '±5%';

        if (band1Select) band1Select.value = c0.key;
        if (band2Select) band2Select.value = c1.key;
        if (band3Select) band3Select.value = c2.key;
        if (band4Select) band4Select.value = c3.key;
    }

    if (ohmDisplay) {
        ohmDisplay.innerText = `${formatOhms(ohms)} ${tol}`;
    }
    updateGraphicBandSelection();
}

function initResistorSelectors() {
    const digitColors = RESISTOR_COLORS.filter(c => c.digit !== null);
    const multColors = RESISTOR_COLORS;
    const tolColors = RESISTOR_COLORS.filter(c => c.tol !== null);

    function fillSelect(sel, list, defaultKey) {
        if (!sel) return;
        sel.innerHTML = '';
        for (const c of list) {
            const opt = document.createElement('option');
            opt.value = c.key;
            opt.textContent = c.name;
            if (c.key === defaultKey) opt.selected = true;
            sel.appendChild(opt);
        }
    }

    fillSelect(band1Select, digitColors, 'yellow');
    fillSelect(band2Select, digitColors, 'violet');
    fillSelect(band3Select, multColors, 'red');
    fillSelect(band4Select, tolColors, 'gold');
    fillSelect(band5Select, tolColors, 'brown');

    if (resistorMode4Btn) {
        resistorMode4Btn.addEventListener('click', () => setResistorBandMode(4));
    }
    if (resistorMode5Btn) {
        resistorMode5Btn.addEventListener('click', () => setResistorBandMode(5));
    }
    if (resistorBodyTypeBtn) {
        resistorBodyTypeBtn.addEventListener('click', () => {
            setResistorBodyType(resistorBodyType === 'metal' ? 'carbon' : 'metal');
        });
    }

    // Klick auf Bänder im virtuellen Widerstand wählt den jeweiligen Ring
    visBands.forEach((bandEl, idx) => {
        if (!bandEl) return;
        bandEl.addEventListener('click', () => {
            if (idx < resistorBandMode) {
                setActiveBandIndex(idx);
            }
        });
    });

    [band1Select, band2Select, band3Select, band4Select, band5Select].forEach((sel, idx) => {
        if (!sel) return;
        sel.addEventListener('change', () => {
            if (idx < currentResistorBands.length) {
                currentResistorBands[idx] = sel.value;
                updateResistorCalculation();
                renderBandCards();
                renderSwatchGrid();
            }
        });
    });

    updateResistorCalculation();
    renderBandCards();
    renderSwatchGrid();
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h *= 60;
    }
    return [h, s, v];
}

function classifyHsvBand(rgb, isToleranceSlot = false) {
    const [r, g, b] = rgb;
    const [h, s, v] = rgbToHsv(r, g, b);

    // Sehr dunkel -> Schwarz
    if (v < 0.22) return COLOR_BY_KEY.black;

    // Sehr geringe Sättigung -> Weiß, Silber oder Grau
    if (s < 0.18) {
        if (v > 0.82) return COLOR_BY_KEY.white;
        if (isToleranceSlot) return COLOR_BY_KEY.silver;
        return COLOR_BY_KEY.grey;
    }

    // Toleranzring (Gold vs. Braun/Rot)
    if (isToleranceSlot && h >= 22 && h <= 54 && s < 0.82) {
        return COLOR_BY_KEY.gold;
    }

    // Farbton-Bereiche (Hue 0..360°), unempfindlich gegenüber weißem Glanzlicht auf runden Ringen
    if (h >= 342 || h < 13) {
        if (v < 0.48) return COLOR_BY_KEY.brown;
        return COLOR_BY_KEY.red;
    }
    if (h >= 13 && h < 25) {
        if (v < 0.58 || s < 0.58) return COLOR_BY_KEY.brown;
        return COLOR_BY_KEY.orange;
    }
    if (h >= 25 && h < 42) {
        if (isToleranceSlot) return COLOR_BY_KEY.gold;
        if (v < 0.58) return COLOR_BY_KEY.brown;
        return COLOR_BY_KEY.orange;
    }
    if (h >= 42 && h < 68) {
        if (isToleranceSlot || (s < 0.78 && v < 0.84)) return COLOR_BY_KEY.gold;
        return COLOR_BY_KEY.yellow;
    }
    if (h >= 68 && h < 165) return COLOR_BY_KEY.green;
    if (h >= 165 && h < 255) return COLOR_BY_KEY.blue;
    if (h >= 255 && h < 342) return COLOR_BY_KEY.violet;

    return COLOR_BY_KEY.brown;
}

function locateAllResistorBodies(sourceEl, srcW, srcH) {
    const workMax = 320;
    const scale = Math.min(1, workMax / Math.max(srcW, srcH));
    const w = Math.max(16, Math.round(srcW * scale));
    const h = Math.max(16, Math.round(srcH * scale));

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tctx = tmpCanvas.getContext('2d');
    tctx.drawImage(sourceEl, 0, 0, w, h);
    const data = tctx.getImageData(0, 0, w, h).data;

    // Maske für warme/farbige Widerstandskörper vor grauem/weißem Hintergrund oder Metallbeinchen
    const mask = new Uint8Array(w * h);
    const lumArr = new Float32Array(w * h);
    const satArr = new Float32Array(w * h);
    const hueArr = new Float32Array(w * h);
    const valArr = new Float32Array(w * h);
    let neutralBgCount = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            const idx = p * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            const [hv, s, v] = rgbToHsv(r, g, b);
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            lumArr[p] = lum;
            satArr[p] = s;
            hueArr[p] = hv;
            valArr[p] = v;
            if (lum > 140 && s < 0.25) neutralBgCount++;
            if (s > 0.18 && v > 0.22 && (r > b + 15 || s > 0.35)) {
                mask[p] = 1;
            }
        }
    }

    // Widerstände liegen vor einem neutralen/hellen Hintergrund (verhindert Fehlalarme in dunklen Innenräumen)
    if (neutralBgCount / (w * h) < 0.25) {
        return [];
    }

    // 2D Connected-Components (Flood-Fill), um einzelne Widerstände in Reihen (z.B. 10x 2,2 kOhm) zu trennen
    const visited = new Uint8Array(w * h);
    const clusters = [];
    const q = new Int32Array(w * h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const startIdx = y * w + x;
            if (!mask[startIdx] || visited[startIdx]) continue;

            let head = 0, tail = 0;
            q[tail++] = startIdx;
            visited[startIdx] = 1;

            let minX = x, maxX = x, minY = y, maxY = y, area = 0;
            while (head < tail) {
                const curr = q[head++];
                const cy = Math.floor(curr / w);
                const cx = curr % w;
                area++;
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;

                const neighbors = [
                    cy > 0 ? curr - w : -1,
                    cy < h - 1 ? curr + w : -1,
                    cx > 0 ? curr - 1 : -1,
                    cx < w - 1 ? curr + 1 : -1
                ];
                for (const nb of neighbors) {
                    if (nb >= 0 && mask[nb] && !visited[nb]) {
                        visited[nb] = 1;
                        q[tail++] = nb;
                    }
                }
            }

            const bw = maxX - minX + 1;
            const bh = maxY - minY + 1;
            const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
            const areaFrac = area / (w * h);
            const touchesBorder = minX <= 1 || maxX >= w - 2 || minY <= 1 || maxY >= h - 2;

            if (!touchesBorder && area >= 110 && areaFrac <= 0.28 && aspect >= 1.45 && aspect <= 8.8) {
                const isVert = bh > bw * 1.15;
                // 1. Prüfe, ob die beiden Längsseiten des Widerstandskörpers an neutralen/hellen Hintergrund grenzen (filtert Gesicht/Hand/Holz aus)
                const pad = Math.max(3, Math.round(Math.min(bw, bh) * 0.35));
                let flankTotal = 0, flankNeutral = 0;
                if (isVert) {
                    const y0 = minY + Math.floor(bh * 0.20), y1 = maxY - Math.floor(bh * 0.20);
                    for (let yy = y0; yy <= y1; yy++) {
                        for (let xx = Math.max(0, minX - pad); xx < minX; xx++) {
                            const p = yy * w + xx;
                            flankTotal++;
                            if (lumArr[p] > 135 && satArr[p] < 0.26) flankNeutral++;
                        }
                        for (let xx = maxX + 1; xx <= Math.min(w - 1, maxX + pad); xx++) {
                            const p = yy * w + xx;
                            flankTotal++;
                            if (lumArr[p] > 135 && satArr[p] < 0.26) flankNeutral++;
                        }
                    }
                } else {
                    const x0 = minX + Math.floor(bw * 0.20), x1 = maxX - Math.floor(bw * 0.20);
                    for (let xx = x0; xx <= x1; xx++) {
                        for (let yy = Math.max(0, minY - pad); yy < minY; yy++) {
                            const p = yy * w + xx;
                            flankTotal++;
                            if (lumArr[p] > 135 && satArr[p] < 0.26) flankNeutral++;
                        }
                        for (let yy = maxY + 1; yy <= Math.min(h - 1, maxY + pad); yy++) {
                            const p = yy * w + xx;
                            flankTotal++;
                            if (lumArr[p] > 135 && satArr[p] < 0.26) flankNeutral++;
                        }
                    }
                }
                if (flankTotal > 0 && (flankNeutral / flankTotal) < 0.38) continue;

                // 2. Prüfe, ob im Inneren der Box echte Farbring-Pixel (Nicht-Hautton-Farben wie Rot/Gelb/Violett/Grün/Blau oder dunkle Ringe) existieren
                let boxTotal = 0, bandLikePixels = 0;
                for (let yy = minY; yy <= maxY; yy++) {
                    for (let xx = minX; xx <= maxX; xx++) {
                        const p = yy * w + xx;
                        boxTotal++;
                        const hv = hueArr[p], sv = satArr[p], vv = valArr[p];
                        if ((sv > 0.44 && (hv < 12 || hv > 40)) || vv < 0.24) {
                            bandLikePixels++;
                        }
                    }
                }
                if (boxTotal > 0 && (bandLikePixels / boxTotal) < 0.04) continue;

                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;
                const distCenter = Math.hypot(cx / w - 0.5, cy / h - 0.5);
                const score = area * (1.2 - distCenter);
                clusters.push({
                    x1: Math.round(minX / scale),
                    y1: Math.round(minY / scale),
                    x2: Math.round(maxX / scale),
                    y2: Math.round(maxY / scale),
                    vertical: isVert,
                    score
                });
            }
        }
    }
    return clusters;
}

function locateBestResistorBody(sourceEl, srcW, srcH) {
    // Falls in Stufe 0 bereits ein Widerstand (oder eine spezifische Box) aktiv ausgewählt wurde:
    const selBox = getSelectedComponentBox();
    if (selBox && (selBox.kind === 'resistor' || /widerstand|resistor/i.test(selBox.label || ''))) {
        const bw = selBox.x2 - selBox.x1;
        const bh = selBox.y2 - selBox.y1;
        return {
            x1: selBox.x1,
            y1: selBox.y1,
            x2: selBox.x2,
            y2: selBox.y2,
            vertical: selBox.vertical !== undefined ? selBox.vertical : (bh > bw * 1.15)
        };
    }

    const clusters = locateAllResistorBodies(sourceEl, srcW, srcH);
    if (clusters.length > 0) {
        clusters.sort((a, b) => b.score - a.score);
        return clusters[0];
    }

    return {
        x1: Math.round(srcW * 0.15),
        y1: Math.round(srcH * 0.25),
        x2: Math.round(srcW * 0.85),
        y2: Math.round(srcH * 0.75),
        vertical: srcH > srcW * 1.25
    };
}

function scanResistorBandsFromImage() {
    const sourceEl = currentMode === 'webcam' ? video : previewImage;
    const srcW = currentMode === 'webcam' ? video.videoWidth : previewImage.naturalWidth;
    const srcH = currentMode === 'webcam' ? video.videoHeight : previewImage.naturalHeight;
    if (!srcW || !srcH) return;

    const box = locateBestResistorBody(sourceEl, srcW, srcH);
    const boxW = Math.max(16, box.x2 - box.x1);
    const boxH = Math.max(16, box.y2 - box.y1);

    const targetW = 360;
    const targetH = 90;
    resistorScanCanvas.width = targetW;
    resistorScanCanvas.height = targetH;
    const sctx = resistorScanCanvas.getContext('2d');
    sctx.save();

    // Falls der Widerstand vertikal im Bild liegt (wie in resistors_2k2_row.jpg), um 90° drehen
    if (box.vertical) {
        sctx.translate(targetW / 2, targetH / 2);
        sctx.rotate(-Math.PI / 2);
        sctx.drawImage(sourceEl, box.x1, box.y1, boxW, boxH, -targetH / 2, -targetW / 2, targetH, targetW);
    } else {
        sctx.drawImage(sourceEl, box.x1, box.y1, boxW, boxH, 0, 0, targetW, targetH);
    }
    sctx.restore();

    const orientLabel = box.vertical ? 'vertikal erkannt → automatisch horizontal ausgerichtet' : 'horizontal erkannt';
    resistorScanLabel.innerText = `Erkannter Widerstandskörper (${orientLabel}):`;

    const imgData = sctx.getImageData(0, 0, targetW, targetH).data;
    const centerPct = Number(scanYSlider.value || 50) / 100;
    const yMin = Math.max(4, Math.round(targetH * (centerPct - 0.16)));
    const yMax = Math.min(targetH - 4, Math.round(targetH * (centerPct + 0.16)));

    const profile = new Array(targetW);
    const hsvProfile = new Array(targetW);

    for (let x = 0; x < targetW; x++) {
        const rList = [], gList = [], bList = [];
        for (let y = yMin; y < yMax; y++) {
            const idx = (y * targetW + x) * 4;
            rList.push(imgData[idx]);
            gList.push(imgData[idx + 1]);
            bList.push(imgData[idx + 2]);
        }
        rList.sort((a, b) => a - b);
        gList.sort((a, b) => a - b);
        bList.sort((a, b) => a - b);
        const m = Math.floor(rList.length / 2);
        const rgb = [rList[m] || 0, gList[m] || 0, bList[m] || 0];
        profile[x] = rgb;
        hsvProfile[x] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    }

    // Bestimme Median-Gehäusefarbe (Beige/Hellbraun) im mittleren Bereich [10%..90%]
    const xStart = Math.round(targetW * 0.08);
    const xEnd = Math.round(targetW * 0.92);
    const bgR = [], bgG = [], bgB = [];
    for (let x = xStart; x <= xEnd; x++) {
        bgR.push(profile[x][0]);
        bgG.push(profile[x][1]);
        bgB.push(profile[x][2]);
    }
    bgR.sort((a, b) => a - b);
    bgG.sort((a, b) => a - b);
    bgB.sort((a, b) => a - b);
    const mid = Math.floor(bgR.length / 2);
    const bodyRgb = [bgR[mid] || 215, bgG[mid] || 185, bgB[mid] || 145];
    const [bgH, bgS] = rgbToHsv(bodyRgb[0], bodyRgb[1], bodyRgb[2]);

    // Erkenne Farbringe anhand von Sättigungs-/Hue-Abweichung zur beigen Gehäusefarbe (filtert dunkle Kappen-Schatten aus)
    const isBandCol = new Uint8Array(targetW);
    for (let x = xStart; x <= xEnd; x++) {
        const [r, g, b] = profile[x];
        const [ph, ps, pv] = hsvProfile[x];
        const dr = r - bodyRgb[0], dg = g - bodyRgb[1], db = b - bodyRgb[2];
        const rgbDist = Math.sqrt(dr * dr + dg * dg + db * db);
        const hueDiff = Math.min(Math.abs(ph - bgH), 360 - Math.abs(ph - bgH));

        const isSaturatedRing = ps > bgS + 0.16;
        const isDistinctHueRing = hueDiff > 18 && ps > 0.34;
        const isDarkRing = pv < 0.28;
        const isBrightYellowOrWhite = pv > 0.78 && (ps > 0.55 || ps < 0.15) && rgbDist > 34;

        if (rgbDist > 32 && (isSaturatedRing || isDistinctHueRing || isDarkRing || isBrightYellowOrWhite)) {
            isBandCol[x] = 1;
        }
    }

    // Schließe minimale 1-2px Lücken durch Glanzlichter
    for (let x = xStart + 1; x < xEnd - 1; x++) {
        if (!isBandCol[x] && isBandCol[x - 1] && isBandCol[x + 1]) {
            isBandCol[x] = 1;
        }
    }

    const rawSegments = [];
    let inSeg = false;
    let segStart = 0;
    for (let x = xStart; x <= xEnd; x++) {
        if (isBandCol[x] && !inSeg) {
            inSeg = true;
            segStart = x;
        } else if ((!isBandCol[x] || x === xEnd) && inSeg) {
            inSeg = false;
            const segEnd = x - 1;
            const w = segEnd - segStart + 1;
            if (w >= 4 && w <= targetW * 0.18) {
                rawSegments.push({ x1: segStart, x2: segEnd });
            }
        }
    }

    // Verschmelze eng benachbarte Segmente desselben Rings (z.B. wenn ein Glanzstreifen den Ring teilt)
    const merged = [];
    for (const seg of rawSegments) {
        if (merged.length > 0 && seg.x1 - merged[merged.length - 1].x2 <= 5) {
            merged[merged.length - 1].x2 = seg.x2;
        } else {
            merged.push({ ...seg });
        }
    }

    const segments = merged.map(seg => {
        const w = seg.x2 - seg.x1 + 1;
        const c1 = seg.x1 + Math.floor(w * 0.2);
        const c2 = Math.max(c1, seg.x2 - Math.floor(w * 0.2));
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let k = c1; k <= c2; k++) {
            sr += profile[k][0];
            sg += profile[k][1];
            sb += profile[k][2];
            n++;
        }
        return {
            x1: seg.x1,
            x2: seg.x2,
            centerX: Math.round((seg.x1 + seg.x2) / 2),
            rgb: [sr / n, sg / n, sb / n]
        };
    });

    // Zeichne Scan-Korridor und erkannte Farbringe in die Canvas-Vorschau
    sctx.strokeStyle = 'rgba(59, 130, 246, 0.75)';
    sctx.lineWidth = 1.5;
    sctx.strokeRect(xStart, yMin, xEnd - xStart, yMax - yMin);

    for (const seg of segments) {
        const detected = classifyHsvBand(seg.rgb, false);
        sctx.strokeStyle = '#10b981';
        sctx.lineWidth = 2.5;
        sctx.strokeRect(seg.x1, yMin - 2, seg.x2 - seg.x1, (yMax - yMin) + 4);
        sctx.fillStyle = detected.hex;
        sctx.fillRect(seg.x1, 2, Math.max(6, seg.x2 - seg.x1), 8);
    }
    resistorScanWrapper.style.display = 'block';

    if (segments.length >= 3) {
        // Pruefe, ob der Grundkoerper blaeulich/cyan ist (Metallschicht)
        const isBlueBody = (bodyRgb[2] > bodyRgb[0] * 0.82 && bodyRgb[1] > 110) || (bodyRgb[2] > 120 && bodyRgb[0] < 160);
        const use5Bands = segments.length >= 5 || (isBlueBody && segments.length >= 4);

        if (use5Bands) {
            setResistorBandMode(5, true);
            setResistorBodyType('metal');

            let picked = segments.slice(0, 5);
            if (picked.length === 5) {
                const gapLeft = picked[1].centerX - picked[0].centerX;
                const gapRight = picked[4].centerX - picked[3].centerX;
                if (gapLeft > gapRight * 1.3) {
                    picked = picked.slice().reverse();
                }
            }

            const c1 = classifyHsvBand(picked[0].rgb, false);
            const c2 = classifyHsvBand(picked[1].rgb, false);
            const c3 = classifyHsvBand(picked[2].rgb, false);
            const c4 = picked[3] ? classifyHsvBand(picked[3].rgb, false) : COLOR_BY_KEY.brown;
            const c5 = picked[4] ? classifyHsvBand(picked[4].rgb, true) : (isBlueBody ? COLOR_BY_KEY.brown : COLOR_BY_KEY.gold);

            currentResistorBands[0] = c1.digit !== null ? c1.key : 'brown';
            currentResistorBands[1] = c2.digit !== null ? c2.key : 'black';
            currentResistorBands[2] = c3.digit !== null ? c3.key : 'black';
            currentResistorBands[3] = c4.key;
            currentResistorBands[4] = c5.tol !== null ? c5.key : 'brown';
        } else {
            setResistorBandMode(4, true);
            setResistorBodyType(isBlueBody ? 'metal' : 'carbon');

            let picked = segments.slice(0, 4);
            // Pruefe anhand der Ringabstaende, ob der Toleranzring links lag
            if (picked.length === 4) {
                const gapLeft = picked[1].centerX - picked[0].centerX;
                const gapRight = picked[3].centerX - picked[2].centerX;
                if (gapLeft > gapRight * 1.35) {
                    picked = picked.slice().reverse();
                }
            } else if (picked.length === 3) {
                const distLeft = picked[0].centerX - xStart;
                const distRight = xEnd - picked[2].centerX;
                if (distLeft > distRight * 1.4) {
                    picked = picked.slice().reverse();
                }
            }

            const c1 = classifyHsvBand(picked[0].rgb, false);
            const c2 = classifyHsvBand(picked[1].rgb, false);
            const c3 = classifyHsvBand(picked[2].rgb, false);
            const c4 = picked[3]
                ? classifyHsvBand(picked[3].rgb, true)
                : COLOR_BY_KEY.gold;

            currentResistorBands[0] = c1.digit !== null ? c1.key : 'red';
            currentResistorBands[1] = c2.digit !== null ? c2.key : 'red';
            currentResistorBands[2] = c3.key;
            currentResistorBands[3] = c4.tol !== null ? c4.key : 'gold';
        }

        updateResistorCalculation();
        renderBandCards();
        renderSwatchGrid();

        const ringNames = currentResistorBands.slice(0, resistorBandMode)
            .map(k => (COLOR_BY_KEY[k]?.name || k).split(' ')[0])
            .join(' – ');
        const modeLabel = resistorBandMode === 5 ? '5-Ring Metallschicht' : '4-Ring Kohleschicht';
        statusDiv.innerText = `Widerstand erkannt (${modeLabel}, ${orientLabel}): ${ringNames} → ${ohmDisplay.innerText}`;
    } else {
        statusDiv.innerText = `Nur ${segments.length} Farbringe erkannt – passe „Scan-Linie“ an oder wähle die Ringe manuell.`;
    }
}

reverseBandsBtn.addEventListener('click', () => {
    if (resistorBandMode === 5) {
        // Tausche 1. Ziffer mit Multiplikator und 2. mit 3. Ziffer
        const b0 = currentResistorBands[0];
        const b1 = currentResistorBands[1];
        const b2 = currentResistorBands[2];
        const b3 = currentResistorBands[3];
        if (COLOR_BY_KEY[b3]?.digit !== null) {
            currentResistorBands[0] = b3;
            currentResistorBands[1] = b2;
            currentResistorBands[2] = b1;
            currentResistorBands[3] = b0;
        } else {
            currentResistorBands = currentResistorBands.slice(0, 5).reverse();
        }
    } else {
        const b0 = currentResistorBands[0];
        const b2 = currentResistorBands[2];
        if (COLOR_BY_KEY[b2]?.digit !== null) {
            currentResistorBands[0] = b2;
            currentResistorBands[2] = b0;
        }
    }
    updateResistorCalculation();
    renderBandCards();
    renderSwatchGrid();
});

scanYSlider.addEventListener('input', () => {
    scanYVal.innerText = `${scanYSlider.value}%`;
    scanResistorBandsFromImage();
});

scanResistorBtn.addEventListener('click', () => {
    scanResistorBandsFromImage();
});

// SMD-Code-Decoder (3-Digit, 4-Digit, R-Notation, EIA-96)
const EIA96_VALUES = [
    100,102,105,107,110,113,115,118,121,124,127,130,133,137,140,143,
    147,150,154,158,162,165,169,174,178,182,187,191,196,200,205,210,
    215,221,226,232,237,243,249,255,261,267,274,280,287,294,301,309,
    316,324,332,340,348,357,365,374,383,392,402,412,422,432,442,453,
    464,475,487,499,511,523,536,549,562,576,590,604,619,634,649,665,
    681,698,715,732,750,768,787,806,825,845,866,887,909,931,953,976
];
const EIA96_MULT = { Z: 0.001, Y: 0.01, R: 0.01, X: 0.1, S: 0.1, A: 1, B: 10, H: 10, C: 100, D: 1000, E: 10000, F: 100000 };

function updateSmdDecoder() {
    const code = smdInput.value.trim().toUpperCase();
    if (!code) {
        smdOutput.innerText = '→ Wert eingeben';
        return;
    }
    if (code === '0' || code === '000' || code === '0000') {
        smdOutput.innerText = '= 0 Ω (Null-Ohm-Brücke)';
        return;
    }
    // R-Notation (z.B. 4R7 = 4.7 Ohm, R22 = 0.22 Ohm)
    if (/^\d*R\d+$/.test(code)) {
        const val = parseFloat(code.replace('R', '.'));
        smdOutput.innerText = `= ${formatOhms(val)}`;
        return;
    }
    // 3- oder 4-stelliger Zahlencode (z.B. 103 = 10 kOhm, 4702 = 47 kOhm)
    if (/^\d{3,4}$/.test(code)) {
        const base = parseInt(code.slice(0, -1), 10);
        const exp = parseInt(code.slice(-1), 10);
        const ohms = base * Math.pow(10, exp);
        smdOutput.innerText = `= ${formatOhms(ohms)}`;
        return;
    }
    // EIA-96 (z.B. 01C = 100 * 100 = 10 kOhm)
    const eiaMatch = code.match(/^(\d{2})([ZYRXSABHCDEF])$/);
    if (eiaMatch) {
        const idx = parseInt(eiaMatch[1], 10) - 1;
        if (idx >= 0 && idx < 96) {
            const ohms = EIA96_VALUES[idx] * EIA96_MULT[eiaMatch[2]];
            smdOutput.innerText = `= ${formatOhms(ohms)} ±1% (EIA-96)`;
            return;
        }
    }
    smdOutput.innerText = '(Unbekanntes SMD-Format)';
}

smdInput.addEventListener('input', updateSmdDecoder);

