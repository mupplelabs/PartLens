// =====================================================================
// COMPUTER VISION, OCR & SMART HYBRID COMPONENT DETECTION
// =====================================================================

function setProgress(pct, message) {
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (message && statusDiv) statusDiv.innerText = message;
}

function hideProgress(message) {
    if (progressContainer) progressContainer.style.display = 'none';
    if (message && statusDiv) statusDiv.innerText = message;
}

function getActiveClipCategories() {
    const list = [...BASE_CLIP_CATEGORIES];
    const raw = customClassesInput.value.trim();
    if (raw) {
        for (const item of raw.split(',')) {
            const clean = item.trim();
            if (clean) {
                list.push({
                    prompt: `a close-up photo of an electronic ${clean}`,
                    label: clean
                });
            }
        }
    }
    return list;
}

// Kombiniert CLIP-Scores intelligent mit Geometrie-/Pin-Merkmalen aus Stufe 0
// (selbst wenn Pins im schwarzen ESD-Schaum stecken) sowie ggf. dem gelesenen Bauteil-Code aus Stufe 2.
function refineStage1Predictions(rawMapped) {
    if (!Array.isArray(rawMapped) || rawMapped.length === 0) return rawMapped;

    const selBox = getSelectedComponentBox();
    const refBox = selBox || (detectedBoxes.length > 0 ? detectedBoxes[0] : null);

    const multipliers = {};
    for (const item of rawMapped) {
        multipliers[item.displayLabel || item.label] = 1.0;
    }

    // 1. Geometrie- & Gehäuse-Analyse aus Stufe 0 (z.B. längliches dunkles Epoxid-Gehäuse vs. TO-92 vs. Widerstand)
    if (refBox) {
        const innerW = (refBox.ocrX2 != null && refBox.ocrX1 != null) ? (refBox.ocrX2 - refBox.ocrX1) : (refBox.x2 - refBox.x1);
        const innerH = (refBox.ocrY2 != null && refBox.ocrY1 != null) ? (refBox.ocrY2 - refBox.ocrY1) : (refBox.y2 - refBox.y1);
        const elongation = Math.max(innerW, innerH) / Math.max(1, Math.min(innerW, innerH));

        if (refBox.kind === 'semiconductor' && refBox.leadType === 'to92') {
            // Stufe 0 hat 2–3 lange Drahtbeinchen am kompakten Gehäuse gefunden → TO-92 Transistor
            multipliers['Transistor'] = (multipliers['Transistor'] || 1) * 6.0;
            multipliers['IC / Mikrochip (DIP)'] = (multipliers['IC / Mikrochip (DIP)'] || 1) * 0.15;
            multipliers['Kondensator (Capacitor)'] = (multipliers['Kondensator (Capacitor)'] || 1) * 0.45;
        } else if (refBox.kind === 'semiconductor') {
            if (elongation >= 1.48 || /IC|DIP/i.test(refBox.label || '')) {
                // Längliches dunkles IC-Gehäuse (auch wenn Beinchen im ESD-Schaum stecken):
                // verhindere Verwechslung mit Elektrolyt-/Keramikkondensator
                multipliers['IC / Mikrochip (DIP)'] = (multipliers['IC / Mikrochip (DIP)'] || 1) * 3.2;
                multipliers['Kondensator (Capacitor)'] = (multipliers['Kondensator (Capacitor)'] || 1) * 0.28;
                multipliers['Widerstand (Resistor)'] = (multipliers['Widerstand (Resistor)'] || 1) * 0.35;
            } else if (elongation <= 1.42 || /Transistor|TO-92/i.test(refBox.label || '')) {
                multipliers['Transistor'] = (multipliers['Transistor'] || 1) * 2.5;
                multipliers['Kondensator (Capacitor)'] = (multipliers['Kondensator (Capacitor)'] || 1) * 0.45;
            }
        } else if (refBox.kind === 'resistor') {
            multipliers['Widerstand (Resistor)'] = (multipliers['Widerstand (Resistor)'] || 1) * 3.0;
        }
    }

    // 2. Cross-Stage-Feedback aus Stufe 2 (falls OCR bereits einen eindeutigen Halbleiter-Code gelesen hat)
    if (lastRecognizedPartCodes && lastRecognizedPartCodes.length > 0) {
        const joined = lastRecognizedPartCodes.join(' ');
        if (/\b(ISD\d+|CD40\d+|CD74\w+|HEF40\d+|SN74\w+|74(?:HC|HCT|LS)\d+|NE55\d|LM\d{3,4}|TL0\d{2}|ATMEGA\d+)\b/i.test(joined)) {
            multipliers['IC / Mikrochip (DIP)'] = (multipliers['IC / Mikrochip (DIP)'] || 1) * 4.5;
            multipliers['Kondensator (Capacitor)'] = (multipliers['Kondensator (Capacitor)'] || 1) * 0.15;
        } else if (/\b(2N\d{3,4}[A-C]?|BC\d{3}[A-C]?|BD\d{3}|2S[ABCDJK]\d{3,4}|IRF\w+)\b/i.test(joined)) {
            multipliers['Transistor'] = (multipliers['Transistor'] || 1) * 4.5;
            multipliers['Kondensator (Capacitor)'] = (multipliers['Kondensator (Capacitor)'] || 1) * 0.20;
        } else if (/\b1N\d{3,4}\b/i.test(joined)) {
            multipliers['LED / Diode'] = (multipliers['LED / Diode'] || 1) * 4.0;
        }
    }

    let sum = 0;
    const adjusted = rawMapped.map(item => {
        const key = item.displayLabel || item.label;
        const mult = multipliers[key] ?? 1.0;
        const newScore = Math.max(0.001, (item.score || 0.001) * mult);
        sum += newScore;
        return { ...item, score: newScore };
    });

    for (const item of adjusted) {
        item.score = item.score / Math.max(1e-6, sum);
    }
    adjusted.sort((a, b) => b.score - a.score);
    return adjusted;
}

function renderPredictions(results) {
    if (!results || results.length === 0) return;
    const top = results[0];
    const topPct = (top.score * 100).toFixed(1);
    const topLabel = top.displayLabel || top.label || '';
    outputDiv.innerText = `${topLabel} (${topPct}%)`;

    barsContainer.innerHTML = '';
    for (const item of results.slice(0, 5)) {
        const pct = (item.score * 100).toFixed(1);
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML = `
            <div class="bar-header">
                <span>${item.displayLabel || item.label}</span>
                <strong>${pct}%</strong>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width: ${Math.min(100, Math.max(1, item.score * 100))}%"></div>
            </div>
        `;
        barsContainer.appendChild(row);
    }

    // Wenn in Stufe 1 ein Widerstand erkannt wurde, automatisch die Farbringe in Stufe 3 scannen
    if (/widerstand|resistor/i.test(topLabel) && top.score > 0.35) {
        scanResistorBandsFromImage();
    }
}

async function initClipClassifier() {
    if (activeClassifier) return;
    setProgress(0, 'Lade Stufe-1-Klassifizierer (Xenova/clip-vit-base-patch32)...');
    outputDiv.innerText = 'Lade CLIP-Modell...';

    const progressCallback = (data) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
            setProgress(Math.round(data.progress), `Lade ${data.file}: ${Math.round(data.progress)}%`);
        } else if (data.status === 'ready') {
            statusDiv.innerText = 'Xenova/clip-vit-base-patch32 bereit!';
        }
    };

    try {
        if (!xenovaModule) {
            setProgress(5, 'Lade Transformers Engine (lokal)...');
            try {
                xenovaModule = await import('/vendor/xenova/transformers.min.js');
            } catch (errVendor) {
                console.warn('Lokaler Vendor-Import fehlgeschlagen, nutze CDN-Fallback:', errVendor);
                xenovaModule = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
            }
        }
        const { pipeline, env } = xenovaModule;
        if (env && env.backends && env.backends.onnx && env.backends.onnx.wasm) {
            env.backends.onnx.wasm.wasmPaths = '/vendor/xenova/';
        }
        env.allowRemoteModels = true;
        env.allowLocalModels = false;
        activeClassifier = await pipeline(
            'zero-shot-image-classification',
            'Xenova/clip-vit-base-patch32',
            { progress_callback: progressCallback }
        );
        hideProgress('Bereit!');
        await classifyCurrentImage();
    } catch (err) {
        console.error('Fehler beim Laden des CLIP-Modells:', err);
        hideProgress(`Fehler beim Laden (${err.message || err}).`);
        outputDiv.innerText = 'Fehler beim Modell-Start';
    }
}

async function runInferenceOnDataUrl(imageUrl) {
    if (!activeClassifier || isInferencing) return;
    isInferencing = true;
    try {
        const categories = getActiveClipCategories();
        const candidatePrompts = categories.map(c => c.prompt);
        const promptToLabel = Object.fromEntries(categories.map(c => [c.prompt, c.label]));
        const rawResults = await activeClassifier(imageUrl, candidatePrompts);
        const mapped = rawResults.map(r => ({
            ...r,
            displayLabel: promptToLabel[r.label] || r.label
        }));
        lastRawStage1Results = mapped;
        renderPredictions(refineStage1Predictions(mapped));
    } catch (err) {
        console.error('Fehler bei der Klassifizierung:', err);
    } finally {
        isInferencing = false;
    }
}

async function classifyCurrentImage() {
    if (!activeClassifier) return;
    const { el: sourceEl, w: srcW, h: srcH } = getActiveMediaSource();
    if (!srcW || !srcH) return;

    if (detectedBoxes.length === 0 && selectedBoxIndex !== -2) {
        lastRawStage1Results = null;
        if (outputDiv) outputDiv.innerText = window.t ? window.t('studio.no_component_detected') : 'Kein Bauteil erkannt';
        if (barsContainer) {
            barsContainer.innerHTML = `<div style="font-size: 0.82rem; color: var(--muted); padding: 4px 0;">${window.t ? window.t('studio.stage0_no_component_hint') : 'Stufe 0 hat kein elektronisches Bauteil im Bild lokalisiert – Klassifizierung pausiert.'}</div>`;
        }
        return;
    }

    const selBox = getSelectedComponentBox();

    if (selBox) {
        const bw = selBox.x2 - selBox.x1;
        const bh = selBox.y2 - selBox.y1;
        const isVert = bh > bw * 1.35 && selBox.leadType !== 'to92';
        // selBox enthält bereits die äußeren Bauteil-Grenzen inkl. Pins; kleiner Kontext-Saum (10%)
        const padX = Math.round(bw * 0.10);
        const padY = Math.round(bh * 0.10);
        const sx = Math.max(0, selBox.x1 - padX);
        const sy = Math.max(0, selBox.y1 - padY);
        const sw = Math.min(srcW - sx, bw + padX * 2);
        const sh = Math.min(srcH - sy, bh + padY * 2);

        const rotW = (isVert && selBox.kind === 'semiconductor') ? sh : sw;
        const rotH = (isVert && selBox.kind === 'semiconductor') ? sw : sh;
        // Quadratisches Canvas verhindert, dass CLIPs 224×224 Center-Crop die Enden/Pins eines länglichen DIP-ICs abschneidet
        const side = Math.max(rotW, rotH);
        canvas.width = side;
        canvas.height = side;
        ctx.fillStyle = (selBox.brightBgRatio != null && selBox.brightBgRatio < 0.30) ? '#1e242b' : '#e2e8f0';
        ctx.fillRect(0, 0, side, side);

        if (isVert && selBox.kind === 'semiconductor') {
            ctx.save();
            ctx.translate(side / 2, side / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(sourceEl, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
            ctx.restore();
        } else {
            ctx.drawImage(sourceEl, sx, sy, sw, sh, Math.round((side - sw) / 2), Math.round((side - sh) / 2), sw, sh);
        }
    } else {
        canvas.width = srcW;
        canvas.height = srcH;
        ctx.drawImage(sourceEl, 0, 0);
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
    await runInferenceOnDataUrl(dataUrl);
}

// =====================================================================
// STUFE 2: BAUTEIL-BESCHRIFTUNG / TYP AUSLESEN (OCR)
// =====================================================================

// Misst, wie weit dünne silberne Drähte (Beinchen) unter (dir=1) bzw. über (dir=-1) einem dunklen Gehäuse
// verlaufen. Glänzende Draht-Mitten werden überbrückt. Liefert Länge, Verhältnis zur Gehäusehöhe und mittlere
// Anzahl an Drähten pro Zeile (TO-92: 2–3, DIP-IC: viele kurze Pins → kein Treffer).
function measureLeadExtent(lumArr, satArr, w, h, minX, maxX, minY, maxY, dir) {
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const xs = Math.max(0, minX - Math.round(bw * 0.15));
    const xe = Math.min(w - 1, maxX + Math.round(bw * 0.15));
    const maxRunW = Math.max(3, Math.round(bw * 0.16));
    const gapTol = Math.max(2, Math.round(bw * 0.07));
    const startY = dir > 0 ? maxY + 1 : minY - 1;
    let lastLeadY = -1, leadRows = 0, gap = 0, runSum = 0;
    const maxRows = Math.round(bh * 6);
    for (let i = 0, y = startY; i < maxRows && y >= 0 && y < h; i++, y += dir) {
        let runs = 0, runW = 0, tooWide = false, leadPx = 0, gapRun = 0;
        for (let x = xs; x <= xe; x++) {
            const p = y * w + x;
            const isLead = lumArr[p] < 228 && lumArr[p] > 60 && satArr[p] < 0.30;
            if (isLead) {
                if (runW > 0 && gapRun > 0) runW += gapRun;
                runW++; leadPx++; gapRun = 0;
            } else if (runW > 0) {
                gapRun++;
                if (gapRun > gapTol) {
                    if (runW > maxRunW) tooWide = true;
                    runs++; runW = 0; gapRun = 0;
                }
            }
        }
        if (runW > 0) { if (runW > maxRunW) tooWide = true; runs++; }
        const okRow = !tooWide && runs >= 1 && runs <= 4 && leadPx < (xe - xs + 1) * 0.45;
        if (okRow) {
            leadRows++; runSum += runs; lastLeadY = y; gap = 0;
        } else if (++gap > 3) {
            break;
        }
    }
    if (lastLeadY < 0) return null;
    const len = Math.abs(lastLeadY - startY) + 1;
    return { len, lastLeadY, ratio: len / bh, avgRuns: runSum / Math.max(1, leadRows) };
}

function locateDarkComponentPackages(sourceEl, srcW, srcH) {
    const workMax = 280;
    const scale = Math.min(1, workMax / Math.max(srcW, srcH));
    const w = Math.max(16, Math.round(srcW * scale));
    const h = Math.max(16, Math.round(srcH * scale));

    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(sourceEl, 0, 0, w, h);
    const d = tctx.getImageData(0, 0, w, h).data;

    const lumArr = new Float32Array(w * h);
    const satArr = new Float32Array(w * h);
    const mask = new Uint8Array(w * h);
    let brightCount = 0;
    let darkFoamCount = 0;
    let warmSkinCount = 0;

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        const sat = (maxC - minC) / Math.max(1, maxC);
        lumArr[p] = lum;
        satArr[p] = sat;
        if (lum > 195) brightCount++;
        if (lum < 85 && sat < 0.32) darkFoamCount++;
        if (r > g + 16 && g > b + 8 && sat > 0.20 && lum > 65 && lum < 225) warmSkinCount++;
        // Dunkles Epoxid-/Kunststoff-Gehäuse vor hellem Hintergrund (IC, TO-92, TO-220)
        if (lum < 105 && sat < 0.38) {
            mask[p] = 1;
        }
    }

    const brightBgRatio = brightCount / (w * h);
    const darkFoamRatio = darkFoamCount / (w * h);
    const warmSkinRatio = warmSkinCount / (w * h);
    const visited = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    const housings = [];

    if (brightBgRatio >= 0.30) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const start = y * w + x;
                if (!mask[start] || visited[start]) continue;

                let head = 0, tail = 0;
                q[tail++] = start;
                visited[start] = 1;
                let minX = x, maxX = x, minY = y, maxY = y, area = 0;
                let sumInsideLum = 0;

                while (head < tail) {
                    const curr = q[head++];
                    const cy = Math.floor(curr / w);
                    const cx = curr % w;
                    area++;
                    sumInsideLum += lumArr[curr];
                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;

                    if (cy > 0 && mask[curr - w] && !visited[curr - w]) { visited[curr - w] = 1; q[tail++] = curr - w; }
                    if (cy < h - 1 && mask[curr + w] && !visited[curr + w]) { visited[curr + w] = 1; q[tail++] = curr + w; }
                    if (cx > 0 && mask[curr - 1] && !visited[curr - 1]) { visited[curr - 1] = 1; q[tail++] = curr - 1; }
                    if (cx < w - 1 && mask[curr + 1] && !visited[curr + 1]) { visited[curr + 1] = 1; q[tail++] = curr + 1; }
                }

                const bw = maxX - minX + 1;
                const bh = maxY - minY + 1;
                const fill = area / Math.max(1, bw * bh);
                const areaFrac = area / (w * h);

                // Ein echtes Bauteil klebt nicht am äußeren Bildrand (wie ein T-Shirt am unteren Rand oder ein Vorhang/Schatten)
                const touchesFrameBorder = minX <= 2 || maxX >= w - 3 || minY <= 2 || maxY >= h - 3;

                if (!touchesFrameBorder && areaFrac >= 0.012 && areaFrac <= 0.38 && fill >= 0.48 && bw <= w * 0.88 && bh <= h * 0.80) {
                    // Prüfe, ob das dunkle Objekt rundherum (auf mindestens 3 von 4 Seiten) von hellem, neutralem Hintergrund umgeben ist
                    const pad = Math.max(4, Math.round(Math.min(bw, bh) * 0.22));
                    const sideStats = [
                        { x0: minX, x1: maxX, y0: Math.max(0, minY - pad), y1: Math.max(0, minY - 1) },         // oben
                        { x0: minX, x1: maxX, y0: Math.min(h - 1, maxY + 1), y1: Math.min(h - 1, maxY + pad) }, // unten
                        { x0: Math.max(0, minX - pad), x1: Math.max(0, minX - 1), y0: minY, y1: maxY },         // links
                        { x0: Math.min(w - 1, maxX + 1), x1: Math.min(w - 1, maxX + pad), y0: minY, y1: maxY }  // rechts
                    ];
                    let brightSides = 0;
                    let totalSurround = 0, brightSurround = 0, sumSurroundLum = 0;
                    for (const sRect of sideStats) {
                        let sCnt = 0, sBright = 0;
                        for (let sy = sRect.y0; sy <= sRect.y1; sy++) {
                            for (let sx = sRect.x0; sx <= sRect.x1; sx++) {
                                const p = sy * w + sx;
                                sCnt++;
                                totalSurround++;
                                sumSurroundLum += lumArr[p];
                                if (lumArr[p] > 155 && satArr[p] < 0.32) {
                                    sBright++;
                                    brightSurround++;
                                }
                            }
                        }
                        if (sCnt > 0 && (sBright / sCnt) >= 0.45) {
                            brightSides++;
                        }
                    }
                    const surroundBrightRatio = totalSurround > 0 ? (brightSurround / totalSurround) : 0;
                    const meanSurroundLum = totalSurround > 0 ? (sumSurroundLum / totalSurround) : 0;
                    const meanInsideLum = sumInsideLum / Math.max(1, area);

                    if (brightSides < 3 || surroundBrightRatio < 0.55 || (meanSurroundLum - meanInsideLum) < 70) {
                        continue;
                    }

                    const cxNorm = ((minX + maxX) / 2) / w;
                    const cyNorm = ((minY + maxY) / 2) / h;
                    const ocrX1 = Math.round(minX / scale);
                    const ocrY1 = Math.round(minY / scale);
                    const ocrX2 = Math.round(maxX / scale);
                    const ocrY2 = Math.round(maxY / scale);
                    const ocrW = ocrX2 - ocrX1;
                    const ocrH = ocrY2 - ocrY1;
                    const isVertPkg = bh > bw * 1.35;
                    const pkgElong = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

                    // Äußere Bounding-Box (x1..y2) für Stufe 0 & Stufe 1 so erweitern, dass die silbernen
                    // DIP-Beinchen (bei CD4094BE oben/unten) bzw. Transistor-Drähte (bei TO-92 unten) im Rahmen liegen
                    let padLeft = Math.round(ocrW * 0.07);
                    let padRight = Math.round(ocrW * 0.07);
                    let padTop = Math.round(ocrH * 0.14);
                    let padBottom = Math.round(ocrH * 0.44);

                    if (pkgElong >= 1.45 && isVertPkg) {
                        padLeft = Math.round(ocrW * 0.28);
                        padRight = Math.round(ocrW * 0.28);
                        padTop = Math.round(ocrH * 0.05);
                        padBottom = Math.round(ocrH * 0.05);
                    } else if (pkgElong >= 1.45 && !isVertPkg) {
                        // Horizontaler DIP-IC (z.B. CD4094BE): obere Pin-Schultern + untere lange Pin-Reihe einschließen
                        padTop = Math.round(ocrH * 0.16);
                        padBottom = Math.round(ocrH * 0.46);
                    }

                    // TO-92-Erkennung über die Beinchen: 2–3 lange, dünne Drähte (≥ 0,8× Gehäusehöhe) unter/über
                    // dem kompakten Gehäuse. DIP-ICs haben viele kurze Pins → werden hier nie als TO-92 eingestuft.
                    let leadType = null;
                    if (pkgElong < 1.45) {
                        const leadsDown = measureLeadExtent(lumArr, satArr, w, h, minX, maxX, minY, maxY, 1);
                        const leadsUp = measureLeadExtent(lumArr, satArr, w, h, minX, maxX, minY, maxY, -1);
                        const isTo92Leads = (l) => l && l.ratio >= 0.8 && l.avgRuns >= 1.5 && l.avgRuns <= 3.6;
                        const best = [leadsDown, leadsUp].filter(isTo92Leads).sort((a, b) => b.len - a.len)[0];
                        if (best) {
                            leadType = 'to92';
                            const leadEndSrc = Math.round(best.lastLeadY / scale);
                            padLeft = Math.round(ocrW * 0.10);
                            padRight = Math.round(ocrW * 0.10);
                            if (best === leadsDown) {
                                padTop = Math.round(ocrH * 0.06);
                                padBottom = Math.max(0, leadEndSrc - ocrY2) + Math.round(ocrH * 0.04);
                            } else {
                                padBottom = Math.round(ocrH * 0.06);
                                padTop = Math.max(0, ocrY1 - leadEndSrc) + Math.round(ocrH * 0.04);
                            }
                        }
                    }

                    housings.push({
                        x1: Math.max(0, ocrX1 - padLeft),
                        y1: Math.max(0, ocrY1 - padTop),
                        x2: Math.min(srcW, ocrX2 + padRight),
                        y2: Math.min(srcH, ocrY2 + padBottom),
                        ocrX1,
                        ocrY1,
                        ocrX2,
                        ocrY2,
                        leadType,
                        score: 100 - (Math.abs(cxNorm - 0.5) + Math.abs(cyNorm - 0.4) * 0.25) * 100,
                        areaFrac
                    });
                }
            }
        }
    } else if (brightBgRatio < 0.12 && darkFoamRatio >= 0.25 && warmSkinRatio < 0.08) {
        // Dunkler/strukturierter ESD-Hintergrund (z.B. schwarzer ESD-Steckschaum in IMG_2221.jpg):
        // Wird nur aktiviert, wenn das Bild tatsächlich aus dunklem ESD-Schaum besteht (kein helles Fenster, keine Hauttöne).
        const smoothMask = new Uint8Array(w * h);
        const yStart = Math.floor(h * 0.18), yEnd = Math.ceil(h * 0.82);
        const xStart = Math.floor(w * 0.18), xEnd = Math.ceil(w * 0.76);
        const rWin = 3;

        for (let y = yStart; y < yEnd; y++) {
            for (let x = xStart; x < xEnd; x++) {
                let darkCnt = 0, brightCnt = 0, sumL = 0, sumS = 0, cnt = 0;
                for (let dy = -rWin; dy <= rWin; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= h) continue;
                    for (let dx = -rWin; dx <= rWin; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= w) continue;
                        const p = ny * w + nx;
                        const l = lumArr[p];
                        if (l < 75) darkCnt++;
                        if (l > 205) brightCnt++;
                        sumL += l;
                        sumS += satArr[p];
                        cnt++;
                    }
                }
                if (darkCnt <= 1 && brightCnt < cnt * 0.50 && sumL / cnt > 82 && sumL / cnt < 195 && sumS / cnt < 0.32) {
                    smoothMask[y * w + x] = 1;
                }
            }
        }

        for (let y = yStart; y < yEnd; y++) {
            for (let x = xStart; x < xEnd; x++) {
                const start = y * w + x;
                if (!smoothMask[start] || visited[start]) continue;

                let head = 0, tail = 0;
                q[tail++] = start;
                visited[start] = 1;
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

                    if (cy > 0 && smoothMask[curr - w] && !visited[curr - w]) { visited[curr - w] = 1; q[tail++] = curr - w; }
                    if (cy < h - 1 && smoothMask[curr + w] && !visited[curr + w]) { visited[curr + w] = 1; q[tail++] = curr + w; }
                    if (cx > 0 && smoothMask[curr - 1] && !visited[curr - 1]) { visited[curr - 1] = 1; q[tail++] = curr - 1; }
                    if (cx < w - 1 && smoothMask[curr + 1] && !visited[curr + 1]) { visited[curr + 1] = 1; q[tail++] = curr + 1; }
                }

                let bw = maxX - minX + 1;
                let bh = maxY - minY + 1;
                const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
                if (area >= 140 && aspect >= 2.0) {
                    const isVert = bh > bw;
                    let bodyX1 = Math.max(0, minX - (isVert ? 1 : 3));
                    let bodyX2 = Math.min(w - 1, maxX + (isVert ? 1 : 3));
                    let bodyY1 = Math.max(0, minY - (isVert ? 3 : 1));
                    let bodyY2 = Math.min(h - 1, maxY + (isVert ? 4 : 1));

                    if (isVert) {
                        const minDipW = Math.round((bodyY2 - bodyY1) * 0.25);
                        while (bodyX2 - bodyX1 < minDipW && bodyX2 < w - 2) {
                            bodyX2++;
                        }
                        while (bodyX2 - bodyX1 > minDipW) {
                            let pinBri = 0, nRows = 0;
                            for (let yy = bodyY1 + 4; yy <= bodyY2 - 4; yy++) {
                                if (lumArr[yy * w + bodyX2] > 195) pinBri++;
                                nRows++;
                            }
                            if (pinBri > nRows * 0.25) bodyX2--;
                            else break;
                        }
                    } else {
                        const minDipH = Math.round((bodyX2 - bodyX1) * 0.25);
                        while (bodyY2 - bodyY1 < minDipH && bodyY2 < h - 2) {
                            bodyY2++;
                        }
                    }

                    const subLums = [];
                    for (let yy = bodyY1; yy <= bodyY2; yy++) {
                        for (let xx = bodyX1; xx <= bodyX2; xx++) {
                            subLums.push(lumArr[yy * w + xx]);
                        }
                    }
                    subLums.sort((a, b) => a - b);
                    const p25 = subLums[Math.floor(subLums.length * 0.25)] || 100;
                    const p50 = subLums[Math.floor(subLums.length * 0.50)] || 120;
                    const p95 = subLums[Math.floor(subLums.length * 0.95)] || 180;
                    if ((p95 - p25) < 40) continue;
                    const contrastScore = (p95 - p25) - Math.abs(p50 - 110) * 0.8 + area * 0.05;

                    const ocrX1 = Math.round(bodyX1 / scale);
                    const ocrY1 = Math.round(bodyY1 / scale);
                    const ocrX2 = Math.round(bodyX2 / scale);
                    const ocrY2 = Math.round(bodyY2 / scale);
                    const ocrW = ocrX2 - ocrX1;
                    const ocrH = ocrY2 - ocrY1;

                    // Äußere Bounding-Box für Stufe 0 & Stufe 1 großzügig inklusive beider silberner DIP-Pinreihen bemessen!
                    const padLeft = Math.round(ocrW * (isVert ? 0.26 : 0.05));
                    const padRight = Math.round(ocrW * (isVert ? 0.34 : 0.05));
                    const padTop = Math.round(ocrH * (isVert ? 0.04 : 0.26));
                    const padBottom = Math.round(ocrH * (isVert ? 0.04 : 0.34));

                    housings.push({
                        x1: Math.max(0, ocrX1 - padLeft),
                        y1: Math.max(0, ocrY1 - padTop),
                        x2: Math.min(srcW, ocrX2 + padRight),
                        y2: Math.min(srcH, ocrY2 + padBottom),
                        ocrX1,
                        ocrY1,
                        ocrX2,
                        ocrY2,
                        score: contrastScore,
                        areaFrac: ((bodyX2 - bodyX1) * (bodyY2 - bodyY1)) / (w * h)
                    });
                }
            }
        }
    }

    housings.sort((a, b) => b.score - a.score);
    return { housings, brightBgRatio };
}

function getSelectedComponentBox() {
    if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
        return detectedBoxes[selectedBoxIndex];
    }
    return null;
}

function prepareOcrImageDataUrl(overrideAngleDeg = null, forceNatural = false) {
    const sourceEl = currentMode === 'webcam' ? video : previewImage;
    const srcW = currentMode === 'webcam' ? video.videoWidth : previewImage.naturalWidth;
    const srcH = currentMode === 'webcam' ? video.videoHeight : previewImage.naturalHeight;
    if (!srcW || !srcH) return null;

    // Im Live-Webcam-Modus keine OCR-Vorverarbeitung ausführen, solange kein Bauteil erkannt wurde
    if (currentMode === 'webcam' && detectedBoxes.length === 0 && selectedBoxIndex !== -2) {
        return null;
    }

    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    let cropDescription = 'Vollbild';

    const { housings, brightBgRatio } = locateDarkComponentPackages(sourceEl, srcW, srcH);
    const selectedStage0Box = getSelectedComponentBox();

    if (centerCropCb.checked) {
        if (selectedStage0Box) {
            const target = selectedStage0Box;
            // Nutze für OCR die präzise Gehäuse-Box (ocrX1..ocrY2 ohne störende Metall-Pins außen)
            const bx1 = target.ocrX1 ?? target.x1;
            const by1 = target.ocrY1 ?? target.y1;
            const bx2 = target.ocrX2 ?? target.x2;
            const by2 = target.ocrY2 ?? target.y2;
            const bw = bx2 - bx1;
            const bh = by2 - by1;
            const padFrac = brightBgRatio >= 0.30 ? 0.06 : 0.02;
            const padX = Math.round(bw * padFrac);
            const padY = Math.round(bh * padFrac);
            sx = Math.max(0, bx1 - padX);
            sy = Math.max(0, by1 - padY);
            sw = Math.min(srcW - sx, bw + padX * 2);
            sh = Math.min(srcH - sy, bh + padY * 2);
            cropDescription = `Stufe-0 Fokus: Bauteil #${selectedBoxIndex + 1} (${target.label})`;
        } else if (housings.length >= 1) {
            const target = housings[0];
            const bx1 = target.ocrX1 ?? target.x1;
            const by1 = target.ocrY1 ?? target.y1;
            const bx2 = target.ocrX2 ?? target.x2;
            const by2 = target.ocrY2 ?? target.y2;
            const bw = bx2 - bx1;
            const bh = by2 - by1;
            const padFrac = brightBgRatio >= 0.30 ? 0.06 : 0.02;
            const padX = Math.round(bw * padFrac);
            const padY = Math.round(bh * padFrac);
            sx = Math.max(0, bx1 - padX);
            sy = Math.max(0, by1 - padY);
            sw = Math.min(srcW - sx, bw + padX * 2);
            sh = Math.min(srcH - sy, bh + padY * 2);
            cropDescription = housings.length > 1
                ? `Auto-Fokus: 1 von ${housings.length} Bauteil-Gehäusen isoliert (bester Kontrast)`
                : 'Auto-Fokus: Bauteil-Gehäuse isoliert';
        } else {
            const cropFactor = 0.65;
            sx = Math.round(srcW * (1 - cropFactor) / 2);
            sy = Math.round(srcH * (1 - cropFactor) / 2);
            sw = Math.round(srcW * cropFactor);
            sh = Math.round(srcH * cropFactor);
            cropDescription = 'Zentrum-Ausschnitt';
        }
    }

    // Falls das isolierte IC-Gehäuse hochkant steht (z.B. DIP-14 in IMG_2221.jpg durch EXIF-Hochformat),
    // automatisch um -90° ins Querformat drehen, damit die Schrift (ISD 1820PY) waagerecht für OCR liegt!
    const isVerticalHousing = sh > sw * 1.35;
    if (isVerticalHousing) {
        cropDescription += ' · vertikal → 90° horizontal ausgerichtet';
    }

    if (ocrPreviewLabel && !forceNatural) {
        ocrPreviewLabel.innerText = `Vorverarbeiteter OCR-Bildausschnitt (${cropDescription}):`;
    }

    const maxDim = 780;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const rawTargetW = Math.max(1, Math.round(sw * scale));
    const rawTargetH = Math.max(1, Math.round(sh * scale));
    const innerW = isVerticalHousing ? rawTargetH : rawTargetW;
    const innerH = isVerticalHousing ? rawTargetW : rawTargetH;

    // Weißer Ruhe-Rand um den Chip, damit Buchstaben nie am Bildrand kleben und Florence-2 kein extremes 6:1-Seitenverhältnis staucht
    const borderX = Math.round(Math.max(16, innerW * 0.04));
    const borderY = Math.round(Math.max(20, innerH * 0.16));
    const targetW = innerW + borderX * 2;
    const targetH = innerH + borderY * 2;

    ocrPreviewCanvas.width = targetW;
    ocrPreviewCanvas.height = targetH;
    const octx = ocrPreviewCanvas.getContext('2d', { willReadFrequently: true });

    const userAngleDeg = overrideAngleDeg !== null ? overrideAngleDeg : Number(ocrAngleSlider.value || 0);
    const totalAngleDeg = (isVerticalHousing ? -90 : 0) + userAngleDeg;
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, targetW, targetH);
    octx.save();
    octx.translate(targetW / 2, targetH / 2);
    octx.rotate((totalAngleDeg * Math.PI) / 180);
    octx.drawImage(sourceEl, sx, sy, sw, sh, -rawTargetW / 2, -rawTargetH / 2, rawTargetW, rawTargetH);
    octx.restore();

    if (enhanceContrastCb.checked && !forceNatural) {
        const imgData = octx.getImageData(0, 0, targetW, targetH);
        const d = imgData.data;

        // Berechne sowohl Luminanz als auch Farb-Wärme (R-B + 0.45*(G-B)) im inneren Chip-Rechteck:
        // Auf dem rechten ISD 1820PY Chip (#2) ist das weiße Glanzlicht auf der rauen Plastikoberfläche links
        // in reinen Graustufen heller (lum=200) als das gedruckte "ISD"-Logo (lum=192), aber die gelblich-beige
        // Laser-/Stempelfarbe hat eine doppelt so hohe Rot-Blau-Wärme (R-B ≈ 55..74 vs. Glanzlicht R-B ≈ 33)!
        const gray = new Float32Array(innerW * innerH);
        const warmChroma = new Float32Array(innerW * innerH);
        for (let y = 0; y < innerH; y++) {
            for (let x = 0; x < innerW; x++) {
                const idx = ((y + borderY) * targetW + (x + borderX)) * 4;
                const r = d[idx], g = d[idx + 1], b = d[idx + 2];
                const p = y * innerW + x;
                gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
                warmChroma[p] = (r - b) + 0.45 * (g - b);
            }
        }

        // 1D Spalten-Hintergrund-Nivellierung (22%-Perzentil über ±16% Breite):
        // Entfernt seitliches Glanzlicht (wie beim rechten ISD 1820PY Chip), ohne große Buchstaben ("ISD") auszuhöhlen!
        const rX = Math.max(12, Math.round(innerW * 0.16));
        const colBgL = new Float32Array(innerW);
        const colBgRB = new Float32Array(innerW);
        const whiteBgCutoff = brightBgRatio >= 0.30 ? 228 : 245;

        for (let x = 0; x < innerW; x++) {
            const x0 = Math.max(0, x - rX);
            const x1b = Math.min(innerW - 1, x + rX);
            const stepX = Math.max(1, Math.floor((x1b - x0) / 18));
            const stepY = Math.max(1, Math.floor(innerH / 24));
            const valsL = [], valsRB = [];
            for (let xx = x0; xx <= x1b; xx += stepX) {
                for (let y = 3; y < innerH - 3; y += stepY) {
                    const p = y * innerW + xx;
                    if (gray[p] < whiteBgCutoff) {
                        valsL.push(gray[p]);
                        valsRB.push(warmChroma[p]);
                    }
                }
            }
            valsL.sort((a, b) => a - b);
            valsRB.sort((a, b) => a - b);
            colBgL[x] = valsL.length > 0 ? valsL[Math.floor(valsL.length * 0.22)] : 90;
            colBgRB[x] = valsRB.length > 0 ? valsRB[Math.floor(valsRB.length * 0.22)] : 20;
        }

        // Prüfe, ob eine warmtonige Laser-/Stempelbeschriftung vorliegt (wie bei ISD 1820PY)
        const rbSamples = [];
        for (let y = 4; y < innerH - 4; y += 2) {
            for (let x = 4; x < innerW - 4; x += 2) {
                const p = y * innerW + x;
                if (gray[p] < whiteBgCutoff) {
                    rbSamples.push(warmChroma[p] - colBgRB[x]);
                }
            }
        }
        rbSamples.sort((a, b) => a - b);
        const warmSpan = rbSamples.length > 20
            ? (rbSamples[Math.floor(rbSamples.length * 0.96)] - rbSamples[Math.floor(rbSamples.length * 0.50)])
            : 0;
        const hasWarmMarking = warmSpan > 12 && brightBgRatio < 0.30;

        const diffArr = new Float32Array(innerW * innerH);
        const validDiffs = [];
        for (let y = 0; y < innerH; y++) {
            for (let x = 0; x < innerW; x++) {
                const p = y * innerW + x;
                const v = gray[p];
                if (v >= whiteBgCutoff) {
                    diffArr[p] = -999;
                } else {
                    const dL = v - colBgL[x];
                    const dRB = Math.max(0, warmChroma[p] - colBgRB[x]);
                    const df = hasWarmMarking ? (dL * 0.55 + dRB * 2.1) : dL;
                    diffArr[p] = df;
                    if (y >= 4 && y < innerH - 4 && x >= 4 && x < innerW - 4) {
                        validDiffs.push(df);
                    }
                }
            }
        }

        validDiffs.sort((a, b) => a - b);
        // 74%-Perzentil als Schwellenwert für Plastik-Körnung -> macht das graue/schwarze Gehäuse 100% schneeweiß!
        const lowPct = brightBgRatio >= 0.30 ? 0.60 : 0.74;
        const dLow = validDiffs.length > 20 ? Math.max(8, validDiffs[Math.floor(validDiffs.length * lowPct)]) : 12;
        const dHigh = validDiffs.length > 20 ? Math.max(dLow + 14, validDiffs[Math.floor(validDiffs.length * 0.96)]) : 45;
        const span = Math.max(12, dHigh - dLow);

        const filt = new Uint8Array(innerW * innerH).fill(255);
        const edgeTrimY = Math.max(2, Math.round(innerH * 0.04));
        const edgeTrimX = Math.max(2, Math.round(innerW * 0.02));

        for (let y = edgeTrimY; y < innerH - edgeTrimY; y++) {
            for (let x = edgeTrimX; x < innerW - edgeTrimX; x++) {
                const df = diffArr[y * innerW + x];
                if (df > dLow) {
                    const s = Math.min(255, Math.max(0, ((df - dLow) / span) * 255));
                    filt[y * innerW + x] = Math.round(255 - s);
                }
            }
        }

        // 3x3 Despeckle-Filter: entfernt isolierte Körnungs-Punkte auf dem IC-Gehäuse
        const minNeighbors = hasWarmMarking ? 2 : 1;
        for (let y = 1; y < innerH - 1; y++) {
            for (let x = 1; x < innerW - 1; x++) {
                const p = y * innerW + x;
                if (filt[p] < 225) {
                    let darkNb = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            if (filt[(y + dy) * innerW + (x + dx)] < 205) darkNb++;
                        }
                    }
                    if (darkNb <= minNeighbors) filt[p] = 255;
                }
            }
        }

        // Alles auf Weiß initialisieren und bereinigtes Chip-Inlet einsetzen
        for (let i = 0; i < d.length; i += 4) {
            d[i] = d[i + 1] = d[i + 2] = 255;
        }
        for (let y = 0; y < innerH; y++) {
            for (let x = 0; x < innerW; x++) {
                const v = filt[y * innerW + x];
                const idx = ((y + borderY) * targetW + (x + borderX)) * 4;
                d[idx] = d[idx + 1] = d[idx + 2] = v;
            }
        }
        octx.putImageData(imgData, 0, 0);
    }

    ocrPreviewWrapper.style.display = 'block';
    return ocrPreviewCanvas.toDataURL('image/png');
}

function analyzeSemiconductorText(rawText) {
    if (!rawText) return { primaryCodes: [], lotCodes: [], summaryText: '' };

    let cleaned = rawText.toUpperCase().replace(/[^A-Z0-9\s\n-]/g, ' ');

    // 1. Korrigiere typische OCR-Buchstabenverwechslungen bei bekannten IC-Baureihen:
    //    - "ISB 1820PY" / "1SD 1820PY" / "I5D 1820PY" -> "ISD 1820PY"
    //    - "ISD 1822PY" / "ISD 1620PY" / "820PY" / "620PY" -> "ISD 1820PY"
    cleaned = cleaned.replace(/\b[I1L][S5][DB0O8]\s*(?=\d{3,4})/g, 'ISD ');
    cleaned = cleaned.replace(/(?:\b(?:ISD|[I1L][S5][DB0O8]|[1I])\s*)?\b1?[86]2[02QO]P[YV]\b/g, ' ISD 1820PY ');
    cleaned = cleaned.replace(/(ISD\s*)1?[86]2[2QO0]P[YV]/g, '$11820PY');
    if (/\bISD\s*1820PY\b/.test(cleaned)) {
        cleaned = cleaned.replace(/\b[C0O]1?[83]30\b/g, ' C1830 ');
    }

    // 2. Repetitions-Bereinigung (falls mehrere identische Bauteile nebeneinander zeilenweise gelesen wurden,
    //    z.B. "2N2N2222222222222ERA33ICA33ICA331" oder "2N 2N 2N / 2222 2222 2222 / A331 A331 A331")
    cleaned = cleaned.replace(/A33[I1L][CA]?/g, ' A331 ');
    cleaned = cleaned.replace(/(?:2N\s*){2,}/g, ' 2N ');
    cleaned = cleaned.replace(/(?:1N\s*){2,}/g, ' 1N ');
    cleaned = cleaned.replace(/(?:BC\s*){2,}/g, ' BC ');
    cleaned = cleaned.replace(/(?:BD\s*){2,}/g, ' BD ');
    cleaned = cleaned.replace(/(\d{3,4})(?:\s*\1){1,}/g, ' $1 ');
    cleaned = cleaned.replace(/(\d)\1{6,}/g, (_, d) => ` ${d.repeat(4)} `);

    // 3. Trenne zusammengeklebte Zeilen ohne Leerzeichen auf (z.B. TI Wafer-Code + Bauteil "4AAAD3ZKE4CD4094BE"
    //    oder Bauteil + Datecode "ISD 1820PYC1830"):
    const embeddedPartPatterns = [
        /(CD40\d{2}[A-Z]{0,3})/g,
        /(CD74[A-Z]{0,4}\d{2,4}[A-Z]{0,2})/g,
        /(HEF40\d{2}[A-Z]{0,3})/g,
        /(SN74[A-Z]{0,4}\d{2,4}[A-Z]{0,2})/g,
        /(74(?:HC|HCT|LS|AC|ACT|F)\d{2,4}[A-Z]{0,2})/g,
        /(ISD\s*\d{4}[A-Z]{0,2})/g,
        /(LM\d{3,4}[A-Z]{0,2})/g,
        /(NE55\d[A-Z]?)/g,
        /(TL0\d{2}[A-Z]{0,2})/g,
        /(ATMEGA\d{2,4}[A-Z]{0,2})/g,
        /(IRF[A-Z]?\d{2,4}[A-Z]?)/g
    ];
    for (const pat of embeddedPartPatterns) {
        cleaned = cleaned.replace(pat, ' $1 ');
    }

    cleaned = cleaned.replace(/\b([A-Z0-9]{3,6})(?:\s+\1){1,}\b/g, '$1');

    const primarySet = new Set();
    const lotSet = new Set();

    // 4. Mehrzeilige Halbleiter-Bezeichnungen zusammensetzen:
    //    a) JEDEC Transistoren/Dioden: "2N" + "2222" (+ optional "A331" -> 2N2222A + Lot A331)
    const jedecRegex = /\b([12]N)\s*[\s\n-]*(\d{3,4})(?:[\s\n-]+([A-C])(\d{2,4})|\s*([A-C])\b)?/g;
    let m;
    while ((m = jedecRegex.exec(cleaned)) !== null) {
        const base = `${m[1]}${m[2]}`;
        const suffix = m[3] || m[5] || '';
        if (suffix) {
            primarySet.add(`${base}${suffix}`);
        }
        primarySet.add(base);
        if (m[3] && m[4]) {
            lotSet.add(`${m[3]}${m[4]}`);
        }
    }

    //    b) Europäische Pro-Electron Transistoren: BC / BD / BF / BS + 3 Ziffern + optional A/B/C
    const proElectronRegex = /\b(BC|BD|BF|BS)\s*[\s\n-]*(\d{3})\s*([A-C])?\b/g;
    while ((m = proElectronRegex.exec(cleaned)) !== null) {
        const base = `${m[1]}${m[2]}`;
        if (m[3]) primarySet.add(`${base}${m[3]}`);
        primarySet.add(base);
    }

    //    c) Japanische JIS-Transistoren: 2SA / 2SB / 2SC / 2SD / 2SK / 2SJ + 3-4 Ziffern
    const jisRegex = /\b(2S[ABCDJK])\s*[\s\n-]*(\d{3,4})\b/g;
    while ((m = jisRegex.exec(cleaned)) !== null) {
        primarySet.add(`${m[1]}${m[2]}`);
    }

    //    d) Klassische ICs & Spannungsregler (CD4094BE, ISD1820PY, LM7805, NE555P, IRFZ44N, TL072, ATMEGA328P)
    const compact = cleaned.replace(/\b(ISD|CD|HEF|SN|LM|NE|TL|IRF|ATMEGA)\s+(\d{2,5}[A-Z0-9]*)\b/g, '$1$2');
    const generalRegex = /\b([A-Z0-9]{1,4}\d{2,5}[A-Z0-9]{0,5})\b/g;
    for (const src of [compact, cleaned]) {
        while ((m = generalRegex.exec(src)) !== null) {
            const token = m[1].trim();
            if (token.length < 4 || /^\d+$/.test(token)) continue;

            // Erkenne TI Wafer-/Lot-Codes (z.B. 14AAAD3ZKE4 / 4AAAD3ZKE4) oder 4-stellige Date-/Lot-Codes (A331, C1830, P71EA118)
            const isTiLotCode = /^[0-9A-Z]{5,11}[EG]4$/.test(token) || /^1?4AAAD/i.test(token);
            const isShortLotOrDateCode = (/^[AC]\d{3,4}$/.test(token) || /^P\d{2}[A-Z]{2}\d{2,3}$/.test(token)) && (primarySet.size > 0 || /^[AC]\d{3,4}$/.test(token));

            if (isTiLotCode || isShortLotOrDateCode) {
                lotSet.add(token);
                continue;
            }
            if (/^[A-Z]/.test(token)) {
                primarySet.add(token);
            }
        }
    }

    const primaryCodes = [...primarySet];
    const lotCodes = [...lotSet];
    let summaryText = '';
    if (primaryCodes.length > 0) {
        summaryText = `Erkannter Bauteil-Typ: ${primaryCodes.join(' / ')}`;
        if (lotCodes.length > 0) {
            summaryText += ` · Chargen-/Lot-Code: ${lotCodes.join(', ')}`;
        }
    }

    return { primaryCodes, lotCodes, summaryText };
}

function findPartCodes(rawText) {
    return analyzeSemiconductorText(rawText).primaryCodes;
}

function extractPartNumbersAndRenderLinks(rawText) {
    partChips.innerHTML = '';
    const { primaryCodes, lotCodes } = analyzeSemiconductorText(rawText);
    lastRecognizedPartCodes = primaryCodes;

    if (primaryCodes.length > 0 && lastRawStage1Results) {
        renderPredictions(refineStage1Predictions(lastRawStage1Results));
    }

    for (const code of primaryCodes) {
        let hint = '';
        for (const [prefix, desc] of Object.entries(KNOWN_COMPONENTS_HINTS)) {
            if (code.startsWith(prefix)) {
                hint = ` – ${desc}`;
                break;
            }
        }

        const link = document.createElement('a');
        link.className = 'part-chip';
        link.href = `https://www.alldatasheet.com/view.jsp?Searchword=${encodeURIComponent(code)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerText = `${code}${hint} (Datenblatt ↗)`;
        partChips.appendChild(link);
    }

    for (const lot of lotCodes) {
        const badge = document.createElement('span');
        badge.className = 'part-chip';
        badge.style.background = 'rgba(148, 163, 184, 0.14)';
        badge.style.borderColor = 'rgba(148, 163, 184, 0.35)';
        badge.style.color = '#cbd5e1';
        badge.innerText = `Lot-/Datumscode: ${lot}`;
        partChips.appendChild(badge);
    }

    // Prüfe zusätzlich, ob im OCR-Text ein 3/4-stelliger SMD-Widerstandscode steht (nur wenn kein Halbleiter-Code vorliegt)
    if (primaryCodes.length === 0) {
        const smdMatch = rawText.toUpperCase().match(/\b(\d{1,2}R\d{1,2}|\d{3,4})\b/);
        if (smdMatch) {
            smdInput.value = smdMatch[1];
            updateSmdDecoder();
        }
    }
}

function padCanvasForSquareModelDataUrl(srcCanvas, maxAspect = 1.45) {
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return '';
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    if (w <= h * maxAspect) {
        return srcCanvas.toDataURL('image/png');
    }
    const targetH = Math.round(w / maxAspect);
    const padY = Math.round((targetH - h) / 2);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = targetH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, targetH);
    ctx.drawImage(srcCanvas, 0, padY);
    return c.toDataURL('image/png');
}

function buildSplitZoneOcrDataUrl(srcCanvas) {
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return '';
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    if (w < h * 1.9) return '';

    // Bei länglichen DIP-ICs mit 2-zeiligem Drop-Cap-Herstellerlogo links (z.B. "ISD")
    // und 2 halbhohen Zeilen rechts ("1820PY" / "C1830"):
    // Stapel linke Logo-Zone (x: 14%..48%) und rechte 2-Zeilen-Zone (x: 44%..86%, 1.45x skaliert)
    // untereinander auf weißem Grund, damit 3 horizontale Standard-Textzeilen entstehen.
    const lx = Math.round(w * 0.14);
    const lw = Math.round(w * 0.34);
    const rx = Math.round(w * 0.44);
    const rw = Math.round(w * 0.42);
    const scaleR = 1.45;
    const scaledRW = Math.round(rw * scaleR);
    const scaledRH = Math.round(h * scaleR);

    const contentW = Math.max(lw, scaledRW) + 48;
    const contentH = h + scaledRH + 48;
    const outW = Math.max(contentW, Math.round(contentH * 1.15));
    const outH = contentH;

    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(srcCanvas, lx, 0, lw, h, 24, 14, lw, h);
    ctx.drawImage(srcCanvas, rx, 0, rw, h, 24, 26 + h, scaledRW, scaledRH);
    return c.toDataURL('image/png');
}

function buildEnhancedGrayscaleTesseractDataUrl(srcCanvas) {
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return '';
    const c = document.createElement('canvas');
    c.width = srcCanvas.width;
    c.height = srcCanvas.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);
    const imgData = ctx.getImageData(0, 0, c.width, c.height);
    const d = imgData.data;
    const count = d.length / 4;
    if (count === 0) return '';

    let totalLum = 0;
    const lums = new Uint8Array(count);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        lums[j] = lum;
        totalLum += lum;
    }
    const avgLum = totalLum / count;
    const isDarkBg = avgLum < 140;

    // Invertiere bei dunklem IC-Gehäuse: Tesseract erwartet dunklen Text auf hellem Grund
    for (let j = 0; j < count; j++) {
        if (isDarkBg) {
            lums[j] = 255 - lums[j];
        }
    }

    // Min-Max Histogramm-Spreizung (5% / 95% Perzentile für maximalen Kontrast)
    const sorted = Array.from(lums).sort((a, b) => a - b);
    const pLow = sorted[Math.floor(count * 0.05)];
    const pHigh = sorted[Math.floor(count * 0.95)];
    const range = Math.max(20, pHigh - pLow);

    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const val = Math.min(255, Math.max(0, Math.round(((lums[j] - pLow) / range) * 255)));
        d[i] = val;
        d[i + 1] = val;
        d[i + 2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
    return c.toDataURL('image/png');
}

async function runFlorence2SinglePass(dataUrl) {
    const { hf3, model, processor } = florenceBundle;
    const image = await hf3.RawImage.fromURL(dataUrl);
    const task = '<OCR>';
    const prompts = processor.construct_prompts(task);
    const inputs = await processor(image, prompts);
    const generatedIds = await model.generate({
        ...inputs,
        max_new_tokens: 64,
    });
    const generatedText = processor.batch_decode(generatedIds, { skip_special_tokens: false })[0];
    const parsed = processor.post_process_generation(generatedText, task, image.size);
    return (parsed[task] || generatedText || '').trim();
}

async function runFlorence2Ocr(dataUrl) {
    if (!florenceBundle) {
        setProgress(10, 'Lade Transformers v3 & Florence-2...');
        let hf3;
        try {
            hf3 = await import('/vendor/huggingface/transformers.min.js');
        } catch (errVendor) {
            console.warn('Lokaler Huggingface-Vendor-Import fehlgeschlagen, nutze CDN-Fallback:', errVendor);
            hf3 = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0');
        }
        hf3.env.allowRemoteModels = true;
        hf3.env.allowLocalModels = false;

        const modelId = 'onnx-community/Florence-2-base-ft';
        const progressCallback = (data) => {
            if (data.status === 'progress' && typeof data.progress === 'number') {
                setProgress(Math.round(data.progress), `Florence-2 (${data.file}): ${Math.round(data.progress)}%`);
            }
        };

        const processor = await hf3.AutoProcessor.from_pretrained(modelId, {
            progress_callback: progressCallback
        });
        const model = await hf3.Florence2ForConditionalGeneration.from_pretrained(modelId, {
            dtype: {
                embed_tokens: 'q4',
                vision_encoder: 'q4',
                encoder_model: 'q4',
                decoder_model_merged: 'q4',
            },
            progress_callback: progressCallback
        });
        florenceBundle = { hf3, model, processor };
        hideProgress('Florence-2 geladen.');
    }

    statusDiv.innerText = 'Florence-2 liest Bauteil-Beschriftung (<OCR>)...';
    const paddedUrl = padCanvasForSquareModelDataUrl(ocrPreviewCanvas) || dataUrl;
    let bestText = await runFlorence2SinglePass(paddedUrl);

    if (findPartCodes(bestText).length === 0) {
        const splitUrl = buildSplitZoneOcrDataUrl(ocrPreviewCanvas);
        if (splitUrl) {
            statusDiv.innerText = 'Florence-2 prüft mehrzeilige IC-Zonen (Logo + Bauteilcode)...';
            const splitText = await runFlorence2SinglePass(splitUrl);
            const combined = `${bestText} ${splitText}`.trim();
            if (findPartCodes(combined).length > 0) {
                bestText = combined;
            } else if (splitText.length > bestText.length) {
                bestText = splitText;
            }
        }
    }

    // Vision-LLMs (wie Florence-2 oder Gemini) sind auf natürlichen RGB-Farbbildern trainiert:
    // Falls der binäre Kontrastfilter noch keinen eindeutigen Bauteilcode geliefert hat,
    // prüfe automatisch auch das ungefilterte RGB-Farbbild (inkl. Split-Zonen)
    if (findPartCodes(bestText).length === 0 && enhanceContrastCb.checked) {
        statusDiv.innerText = 'Florence-2 prüft natürliches RGB-Farbbild (ohne Binärfilter)...';
        prepareOcrImageDataUrl(null, true);
        const natPaddedUrl = padCanvasForSquareModelDataUrl(ocrPreviewCanvas);
        if (natPaddedUrl) {
            const natText = await runFlorence2SinglePass(natPaddedUrl);
            const combinedNat = `${bestText} ${natText}`.trim();
            if (findPartCodes(combinedNat).length > 0) {
                bestText = combinedNat;
            } else {
                const natSplitUrl = buildSplitZoneOcrDataUrl(ocrPreviewCanvas);
                if (natSplitUrl) {
                    const natSplitText = await runFlorence2SinglePass(natSplitUrl);
                    const combinedAll = `${combinedNat} ${natSplitText}`.trim();
                    if (findPartCodes(combinedAll).length > 0 || natSplitText.length > bestText.length) {
                        bestText = combinedAll;
                    }
                }
            }
        }
        prepareOcrImageDataUrl();
    }
    return bestText;
}

async function ensureTesseractCreateWorker() {
    if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') {
        return window.Tesseract.createWorker;
    }
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/tesseract/tesseract.min.js';
        script.onload = resolve;
        script.onerror = () => {
            console.warn('Lokales Tesseract-Skript fehlgeschlagen, nutze CDN-Fallback...');
            const fallbackScript = document.createElement('script');
            fallbackScript.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            fallbackScript.onload = resolve;
            fallbackScript.onerror = () => reject(new Error('Tesseract.js konnte weder lokal noch über CDN geladen werden.'));
            document.head.appendChild(fallbackScript);
        };
        document.head.appendChild(script);
    });
    if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') {
        return window.Tesseract.createWorker;
    }
    throw new Error('window.Tesseract.createWorker ist nicht verfügbar.');
}

async function runTesseractOcr(dataUrl) {
    const defaultParams = {
        tessedit_pageseg_mode: '6', // 6 = PSM.SINGLE_BLOCK (einheitlicher Textblock, ideal für 1-3 IC-Zeilen)
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.+_:#* ',
        preserve_interword_spaces: '1'
    };

    if (!tesseractWorker) {
        setProgress(20, 'Lade Tesseract.js v5 (WASM)...');
        const createWorkerFn = await ensureTesseractCreateWorker();
        tesseractWorker = await createWorkerFn('eng');
        await tesseractWorker.setParameters(defaultParams);
        hideProgress('Tesseract.js bereit.');
    } else {
        await tesseractWorker.setParameters(defaultParams);
    }

    statusDiv.innerText = 'Tesseract.js analysiert IC-Beschriftung (Block-Modus PSM 6)...';
    const ret = await tesseractWorker.recognize(dataUrl);
    let bestText = (ret?.data?.text || '').trim();

    // Pass 2: Sparse-Text (PSM 11) - findet verstreute Markierungen, Logos und Datumscodes
    if (findPartCodes(bestText).length === 0) {
        statusDiv.innerText = 'Tesseract.js prüft verstreute Beschriftung (PSM 11)...';
        await tesseractWorker.setParameters({ tessedit_pageseg_mode: '11' });
        const retSparse = await tesseractWorker.recognize(dataUrl);
        const sparseText = (retSparse?.data?.text || '').trim();
        if (findPartCodes(sparseText).length > 0 || sparseText.length > bestText.length) {
            bestText = sparseText;
        }
    }

    // Pass 3: Mehrzeilige IC-Zonen (Split-Zone für links Logo, rechts Typenbezeichnung)
    if (findPartCodes(bestText).length === 0) {
        const splitUrl = buildSplitZoneOcrDataUrl(ocrPreviewCanvas);
        if (splitUrl) {
            statusDiv.innerText = 'Tesseract.js prüft mehrzeilige IC-Zonen...';
            await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' });
            const retSplit = await tesseractWorker.recognize(splitUrl);
            const splitText = (retSplit?.data?.text || '').trim();
            const combined = `${bestText} ${splitText}`.trim();
            if (findPartCodes(combined).length > 0 || splitText.length > bestText.length) {
                bestText = combined;
            }
        }
    }

    // Pass 4: Falls der IC-Binärfilter aktiv war und kein Code erkannt wurde:
    // Teste das natürliche Farbbild mit automatischer Helligkeitsinversion und Kontrastspreizung
    if (findPartCodes(bestText).length === 0 && enhanceContrastCb.checked) {
        statusDiv.innerText = 'Tesseract.js prüft natürliches Bild (invertiert & gespreizt)...';
        prepareOcrImageDataUrl(null, true);
        const enhancedNatUrl = buildEnhancedGrayscaleTesseractDataUrl(ocrPreviewCanvas);
        if (enhancedNatUrl) {
            await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' });
            const retNat = await tesseractWorker.recognize(enhancedNatUrl);
            const natText = (retNat?.data?.text || '').trim();
            if (findPartCodes(natText).length > 0) {
                bestText = `${bestText} ${natText}`.trim();
            } else {
                await tesseractWorker.setParameters({ tessedit_pageseg_mode: '11' });
                const retNatSparse = await tesseractWorker.recognize(enhancedNatUrl);
                const natSparseText = (retNatSparse?.data?.text || '').trim();
                if (findPartCodes(natSparseText).length > 0 || natSparseText.length > bestText.length) {
                    bestText = `${bestText} ${natSparseText}`.trim();
                }
            }
        }
        prepareOcrImageDataUrl(); // Vorschau zurücksetzen
    }

    // Pass 5: Leichte Winkelkorrektur (19°) für schräg aufgenommene Bauteile
    if (Number(ocrAngleSlider.value) === 0 && findPartCodes(bestText).length === 0) {
        const tiltedDataUrl = prepareOcrImageDataUrl(19);
        if (tiltedDataUrl) {
            await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' });
            const retTilted = await tesseractWorker.recognize(tiltedDataUrl);
            const tiltedText = (retTilted?.data?.text || '').trim();
            if (findPartCodes(tiltedText).length > 0 || tiltedText.length > bestText.length) {
                ocrAngleSlider.value = '19';
                angleValSpan.innerText = '19°';
                bestText = tiltedText;
            } else {
                prepareOcrImageDataUrl(0);
            }
        }
    }
    return bestText;
}

ocrAngleSlider.addEventListener('input', () => {
    angleValSpan.innerText = `${ocrAngleSlider.value}°`;
    prepareOcrImageDataUrl();
});
enhanceContrastCb.addEventListener('change', () => prepareOcrImageDataUrl());
centerCropCb.addEventListener('change', () => prepareOcrImageDataUrl());

let ocrAbortController = null;
let ocrTimerInterval = null;
let ocrStartTime = 0;
const stopOcrBtn = document.getElementById('stop-ocr-btn');

function showOcrActivity() {
    const overlay = document.getElementById('crop-ocr-overlay');
    const timerEl = document.getElementById('ocr-timer-text');
    if (overlay) overlay.style.display = 'flex';
    if (stopOcrBtn) stopOcrBtn.style.display = 'inline-flex';
    if (runOcrBtn) {
        runOcrBtn.disabled = true;
        runOcrBtn.classList.add('loading');
        runOcrBtn.innerHTML = 'OCR...';
    }
    if (timerEl) timerEl.innerText = '0.0s';
    ocrStartTime = performance.now();
    clearInterval(ocrTimerInterval);
    ocrTimerInterval = setInterval(() => {
        const elSec = ((performance.now() - ocrStartTime) / 1000).toFixed(1);
        if (timerEl) timerEl.innerText = `${elSec}s`;
    }, 100);
}

function hideOcrActivity() {
    clearInterval(ocrTimerInterval);
    const overlay = document.getElementById('crop-ocr-overlay');
    if (overlay) overlay.style.display = 'none';
    if (stopOcrBtn) stopOcrBtn.style.display = 'none';
    if (runOcrBtn) {
        runOcrBtn.disabled = false;
        runOcrBtn.classList.remove('loading');
        runOcrBtn.innerHTML = '<svg class="tool-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>OCR</span>';
    }
}

function abortOcrRecognition() {
    if (ocrAbortController) {
        ocrAbortController.abort();
        ocrAbortController = null;
    }
    isOcrRunning = false;
    hideOcrActivity();
    if (captureWebcamBtn) captureWebcamBtn.disabled = false;
    if (ocrOutput) ocrOutput.innerText = 'OCR-Erkennung vom Benutzer abgebrochen.';
    if (statusDiv) statusDiv.innerText = 'OCR abgebrochen.';
}

if (stopOcrBtn) {
    stopOcrBtn.addEventListener('click', abortOcrRecognition);
}

async function executeOcrRecognition() {
    if (isOcrRunning) return;
    const dataUrl = prepareOcrImageDataUrl();
    if (!dataUrl) return;

    isOcrRunning = true;
    ocrAbortController = new AbortController();
    showOcrActivity();
    if (captureWebcamBtn) captureWebcamBtn.disabled = true;
    const engine = ocrSelect ? ocrSelect.value : 'tesseract';
    ocrOutput.innerText = engine === 'florence2'
        ? 'Lese Bauteil-Beschriftung mit Florence-2 (VisionLM)...'
        : 'Lese Bauteil-Beschriftung mit Tesseract.js v5 (Multi-Pass WASM)...';
    partChips.innerHTML = '';

    try {
        let text = '';
        if (engine === 'florence2') {
            text = await runFlorence2Ocr(dataUrl);
        } else {
            text = await runTesseractOcr(dataUrl);
        }

        if (text) {
            const { primaryCodes, summaryText } = analyzeSemiconductorText(text);
            ocrOutput.innerText = summaryText ? `${text}\n${summaryText}` : text;
            extractPartNumbersAndRenderLinks(text);
            statusDiv.innerText = 'OCR & Bauteil-Analyse abgeschlossen.';

            const partMarkingInput = document.getElementById('part-marking-input');
            if (partMarkingInput) {
                const bestMarking = (primaryCodes && primaryCodes.length > 0)
                    ? primaryCodes[0]
                    : text.split('\n')[0].trim();
                partMarkingInput.value = bestMarking;
                if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
                    detectedBoxes[selectedBoxIndex].partMarking = bestMarking;
                }
            }
        } else {
            ocrOutput.innerText = '(Kein Text erkannt – probiere Florence-2 oder schalte den IC-Kontrastfilter um)';
            statusDiv.innerText = 'Kein Text erkannt.';
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('OCR vom Benutzer abgebrochen.');
            return;
        }
        console.error('OCR-Fehler:', err);
        ocrOutput.innerText = `Fehler bei der Texterkennung: ${err.message || err}`;
        hideProgress('OCR-Fehler.');
    } finally {
        isOcrRunning = false;
        ocrAbortController = null;
        hideOcrActivity();
        if (captureWebcamBtn) captureWebcamBtn.disabled = false;
    }
}

runOcrBtn.addEventListener('click', () => executeOcrRecognition());


// =====================================================================
// STUFE 0: BAUTEIL-LOKALISIERUNG & INTERAKTIVES FREISTELLEN (BOUNDING BOXES)
// =====================================================================

function detectSmartHybridBoxes(sourceEl, srcW, srcH) {
    const { housings, brightBgRatio } = locateDarkComponentPackages(sourceEl, srcW, srcH);
    const boxes = [];

    if (housings.length > 0) {
        for (const h of housings) {
            const bw = h.x2 - h.x1;
            const bh = h.y2 - h.y1;
            const elongation = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
            const isTo92 = h.leadType === 'to92';
            const isVertical = !isTo92 && bh > bw * 1.35;
            let label = 'Halbleiter-Bauteil';
            if (isTo92) {
                label = 'Transistor (TO-92)';
            } else if (elongation >= 1.42) {
                label = 'IC / Mikrochip (DIP)';
            } else if (elongation <= 1.35) {
                label = 'Transistor (TO-92)';
            }
            boxes.push({
                x1: h.x1,
                y1: h.y1,
                x2: h.x2,
                y2: h.y2,
                ocrX1: h.ocrX1,
                ocrY1: h.ocrY1,
                ocrX2: h.ocrX2,
                ocrY2: h.ocrY2,
                score: h.score,
                confidence: Math.min(0.99, Math.max(0.72, 0.70 + (h.score / 220))),
                label,
                kind: 'semiconductor',
                leadType: h.leadType || null,
                vertical: isVertical,
                brightBgRatio
            });
        }
    } else {
        const resClusters = locateAllResistorBodies(sourceEl, srcW, srcH);
        for (const c of resClusters) {
            boxes.push({
                x1: c.x1,
                y1: c.y1,
                x2: c.x2,
                y2: c.y2,
                score: c.score,
                confidence: 0.94,
                label: c.vertical ? 'Widerstand (vertikal)' : 'Widerstand (horizontal)',
                kind: 'resistor',
                vertical: c.vertical
            });
        }
    }

    // In natürlicher Leserichtung (oben->unten, links->rechts) nummerieren (#1, #2, #3...)
    boxes.sort((a, b) => {
        const rowA = Math.round(a.y1 / Math.max(1, srcH * 0.22));
        const rowB = Math.round(b.y1 / Math.max(1, srcH * 0.22));
        if (rowA !== rowB) return rowA - rowB;
        return a.x1 - b.x1;
    });

    return boxes;
}

let dragMode = 'idle'; // 'idle' | 'moving' | 'resizing' | 'drawing'
let activeHandle = null; // 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
let dragStartPos = null; // { x, y, clientX, clientY }
let initialBoxState = null; // { x1, y1, x2, y2 }
let manualDrawStart = null;
let manualDrawCurrent = null;
let mouseImgPos = null;
let isDrawingManualBox = false;
let isTouchActive = false;
let boxFillOpacity = parseFloat(localStorage.getItem('box_opacity') || '0.12');
let prevBoxFillOpacity = boxFillOpacity > 0 ? boxFillOpacity : 0.14;

// Roboflow-Style Spotlight Animation State (Butterweicher Ein- und Ausblend-Übergang)
let currentSpotlightAlpha = 0.0;
let targetSpotlightAlpha = 0.0;
let activeSpotlightBox = null;
let spotlightRafId = null;
let lastSpotlightFrameTime = 0;

function stepSpotlightTransition() {
    spotlightRafId = null;
    const now = performance.now();
    const dt = lastSpotlightFrameTime ? Math.min(0.05, (now - lastSpotlightFrameTime) / 1000) : 0.016;
    lastSpotlightFrameTime = now;

    // Sanfte exponentielle Interpolation: schneller Einstieg (~150ms), weiches Ausklingen
    const lerpSpeed = targetSpotlightAlpha > currentSpotlightAlpha ? 14 : 16;
    const factor = 1 - Math.exp(-dt * lerpSpeed);
    currentSpotlightAlpha += (targetSpotlightAlpha - currentSpotlightAlpha) * factor;

    if (Math.abs(currentSpotlightAlpha - targetSpotlightAlpha) < 0.003) {
        currentSpotlightAlpha = targetSpotlightAlpha;
    }

    if (currentSpotlightAlpha <= 0.001) {
        currentSpotlightAlpha = 0;
        if (targetSpotlightAlpha === 0) {
            activeSpotlightBox = null;
        }
    }

    drawBboxOverlay();
}

function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(59, 130, 246, ${alpha})`;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(59, 130, 246, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const HANDLE_CURSORS = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    n:  'ns-resize',
    s:  'ns-resize',
    w:  'ew-resize',
    e:  'ew-resize'
};

// Klassen-Farb-Map für professionelle Semantic Bounding Boxes (14 English classes)
const CLASS_COLOR_MAP = {
    'resistor': '#f59e0b',
    'capacitor': '#8b5cf6',
    'inductor': '#06b6d4',
    'diode': '#ec4899',
    'led': '#ef4444',
    'transistor': '#10b981',
    'ic': '#3b82f6',
    'potentiometer': '#d97706',
    'switch_button': '#a855f7',
    'relay': '#e11d48',
    'connector': '#14b8a6',
    'display': '#0ea5e9',
    'board': '#6366f1',
    'other': '#94a3b8'
};

function getClassColor(label) {
    if (!label) return '#94a3b8';
    const clean = label.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (CLASS_COLOR_MAP[clean]) return CLASS_COLOR_MAP[clean];
    for (const [k, c] of Object.entries(CLASS_COLOR_MAP)) {
        if (clean.includes(k) || k.includes(clean)) return c;
    }
    if (clean.includes('transistor') || clean.includes('mosfet') || clean.includes('bjt')) return '#10b981';
    if (clean.includes('ic') || clean.includes('dip') || clean.includes('chip')) return '#3b82f6';
    if (clean.includes('resistor') || clean.includes('widerstand')) return '#f59e0b';
    if (clean.includes('kondensator') || clean.includes('capacitor')) return '#8b5cf6';
    if (clean.includes('led')) return '#ef4444';
    if (clean.includes('diode')) return '#ec4899';
    if (clean.includes('board') || clean.includes('arduino') || clean.includes('esp32')) return '#6366f1';
    return '#94a3b8';
}

function getBoxHandles(box) {
    const mx = Math.round((box.x1 + box.x2) / 2);
    const my = Math.round((box.y1 + box.y2) / 2);
    return {
        nw: { x: box.x1, y: box.y1 },
        n:  { x: mx,     y: box.y1 },
        ne: { x: box.x2, y: box.y1 },
        e:  { x: box.x2, y: my     },
        se: { x: box.x2, y: box.y2 },
        s:  { x: mx,     y: box.y2 },
        sw: { x: box.x1, y: box.y2 },
        w:  { x: box.x1, y: my     }
    };
}

function getHitHandle(box, clientX, clientY, canvasEl, srcW, srcH) {
    if (!box) return null;
    const rect = canvasEl.getBoundingClientRect();
    const handles = getBoxHandles(box);
    // Touch bekommt größeren Trefferradius (26px) als Maus (15px)
    const hitRadius = isTouchActive ? 26 : 15;
    for (const [hName, pt] of Object.entries(handles)) {
        const screenX = rect.left + (pt.x / srcW) * rect.width;
        const screenY = rect.top + (pt.y / srcH) * rect.height;
        const dist = Math.hypot(clientX - screenX, clientY - screenY);
        if (dist <= hitRadius) {
            return hName;
        }
    }
    return null;
}

function isPointInsideBox(box, imgX, imgY) {
    return imgX >= box.x1 && imgX <= box.x2 && imgY >= box.y1 && imgY <= box.y2;
}

function drawBboxOverlay() {
    const { el: sourceEl, w: srcW, h: srcH, ready } = getActiveMediaSource();
    const activeOverlay = currentMode === 'webcam' ? webcamBboxCanvas : bboxOverlayCanvas;
    if (!activeOverlay || !ready) return;

    activeOverlay.width = srcW;
    activeOverlay.height = srcH;
    const octx = activeOverlay.getContext('2d');
    octx.clearRect(0, 0, srcW, srcH);

    const scaleFactor = Math.max(1, Math.min(srcW, srcH) / 420);
    const lineW = Math.round(3 * scaleFactor);
    const fontPx = Math.round(13 * scaleFactor);

    if (!detectedBoxes || detectedBoxes.length === 0) {
        targetSpotlightAlpha = 0.0;
        currentSpotlightAlpha = 0.0;
        activeSpotlightBox = null;
    }

    // Roboflow-Style Spotlight: Wenn über eine Box gehovert wird (Canvas oder Bauteil-Liste),
    // blendet sich das restliche Umfeld butterweich ab (35% Schleier mit weichem Fade-In/Out).
    let targetBox = null;
    if (hoveredBoxIndex >= 0 && hoveredBoxIndex < (detectedBoxes?.length || 0)) {
        targetBox = detectedBoxes[hoveredBoxIndex];
    } else if ((dragMode === 'moving' || dragMode === 'resizing') && selectedBoxIndex >= 0 && selectedBoxIndex < (detectedBoxes?.length || 0)) {
        targetBox = detectedBoxes[selectedBoxIndex];
    }

    // Wenn eine Box bereits > 85% der gesamten Bildfläche einnimmt, kein störendes Rest-Abdunkeln
    if (targetBox) {
        const bw = targetBox.x2 - targetBox.x1;
        const bh = targetBox.y2 - targetBox.y1;
        if ((bw * bh) >= (srcW * srcH * 0.85)) {
            targetBox = null;
        }
    }

    if (targetBox && dragMode !== 'drawing') {
        targetSpotlightAlpha = 0.35;
        activeSpotlightBox = targetBox;
    } else {
        targetSpotlightAlpha = 0.0;
    }

    // Animation triggern wenn Differenz zwischen aktueller und Ziel-Deckkraft vorhanden
    if (Math.abs(currentSpotlightAlpha - targetSpotlightAlpha) > 0.002) {
        if (!spotlightRafId) {
            lastSpotlightFrameTime = performance.now();
            spotlightRafId = requestAnimationFrame(stepSpotlightTransition);
        }
    }

    // Sanftes Overlay zeichnen falls Alpha > 0
    if (activeSpotlightBox && currentSpotlightAlpha > 0.002 && dragMode !== 'drawing') {
        const cutX = Math.max(0, activeSpotlightBox.x1);
        const cutY = Math.max(0, activeSpotlightBox.y1);
        const cutW = Math.min(srcW - cutX, activeSpotlightBox.x2 - activeSpotlightBox.x1);
        const cutH = Math.min(srcH - cutY, activeSpotlightBox.y2 - activeSpotlightBox.y1);

        if (cutW > 0 && cutH > 0) {
            octx.save();
            octx.beginPath();
            octx.rect(0, 0, srcW, srcH);
            octx.rect(cutX, cutY, cutW, cutH);
            octx.fillStyle = `rgba(0, 0, 0, ${currentSpotlightAlpha.toFixed(3)})`;
            octx.fill('evenodd');
            octx.restore();
        }
    }

    if (detectedBoxes && detectedBoxes.length > 0) {
        detectedBoxes.forEach((box, idx) => {
        if (typeof isolateSelectedBox !== 'undefined' && isolateSelectedBox) {
            if (selectedBoxIndex < 0 || idx !== selectedBoxIndex) {
                return;
            }
        }
        const isSelected = idx === selectedBoxIndex;
        const isHovered = idx === hoveredBoxIndex;
        const bw = box.x2 - box.x1;
        const bh = box.y2 - box.y1;
        const classColor = getClassColor(box.label);

        octx.save();
        if (isSelected) {
            octx.strokeStyle = '#10b981';
            octx.lineWidth = Math.max(2, Math.round(2.5 * scaleFactor));
            octx.fillStyle = boxFillOpacity <= 0 ? 'transparent' : hexToRgba('#10b981', Math.min(0.85, Math.max(0.08, boxFillOpacity + 0.08)));
            octx.setLineDash([]);
        } else if (isHovered) {
            octx.strokeStyle = '#38bdf8';
            octx.lineWidth = Math.max(2, Math.round(2 * scaleFactor));
            octx.fillStyle = boxFillOpacity <= 0 ? 'transparent' : hexToRgba('#38bdf8', Math.min(0.85, Math.max(0.06, boxFillOpacity + 0.08)));
            octx.setLineDash([]);
        } else {
            octx.strokeStyle = classColor;
            octx.lineWidth = Math.max(1.5, Math.round(1.5 * scaleFactor));
            octx.fillStyle = boxFillOpacity <= 0 ? 'transparent' : hexToRgba(classColor, boxFillOpacity);
            octx.setLineDash([Math.round(5 * scaleFactor), Math.round(3 * scaleFactor)]);
        }

        octx.fillRect(box.x1, box.y1, bw, bh);
        octx.strokeRect(box.x1, box.y1, bw, bh);

        // Label-Badge oben links an der Box
        octx.setLineDash([]);
        octx.font = `bold ${fontPx}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const extraTag = [box.footprint, box.partMarking].filter(Boolean).join(' · ');
        let badgeText = extraTag ? `#${idx + 1} ${box.label} (${extraTag})` : `#${idx + 1} ${box.label}`;
        
        // Anti-Collision: Wenn Boxen eng/schmal sind (< 80px) und die Box nicht ausgewählt/gehovert ist, nur ID zeigen
        if (!isSelected && !isHovered && bw < 85 && detectedBoxes.length > 2) {
            badgeText = `#${idx + 1}`;
        }

        const textW = octx.measureText(badgeText).width;
        const padX = Math.round(5 * scaleFactor);
        const badgeH = Math.round(18 * scaleFactor);
        const bx = Math.max(0, Math.min(srcW - textW - padX * 2, box.x1));
        const by = box.y1 >= badgeH + 2 ? box.y1 - badgeH : box.y1;

        octx.fillStyle = isSelected ? '#059669' : (isHovered ? '#0284c7' : classColor);
        octx.fillRect(bx, by, textW + padX * 2, badgeH);
        octx.fillStyle = '#ffffff';
        octx.textBaseline = 'middle';
        octx.fillText(badgeText, bx + padX, by + badgeH / 2);

        // Wenn ausgewählt: 8 Anfasser (Resize-Handles) & Dimensions-Badge zeichnen
        if (isSelected) {
            const handleRadius = Math.max(5, Math.round(5.5 * scaleFactor));
            const handles = getBoxHandles(box);
            for (const [key, pt] of Object.entries(handles)) {
                octx.beginPath();
                octx.arc(pt.x, pt.y, handleRadius, 0, Math.PI * 2);
                octx.fillStyle = '#ffffff';
                octx.fill();
                octx.lineWidth = Math.max(2, Math.round(2 * scaleFactor));
                octx.strokeStyle = '#059669';
                octx.stroke();
            }

            // Dimensionen-Pill unten rechts (z.B. "320 × 140 px")
            octx.font = `bold ${Math.max(10, Math.round(11 * scaleFactor))}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const dimText = `${Math.round(bw)} × ${Math.round(bh)} px`;
            const dimW = octx.measureText(dimText).width;
            const dimPadX = Math.round(5 * scaleFactor);
            const dimH = Math.round(17 * scaleFactor);
            const dimX = Math.max(0, Math.min(srcW - dimW - dimPadX * 2, box.x2 - dimW - dimPadX * 2));
            const dimY = Math.min(srcH - dimH, box.y2 + 3);
            octx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            octx.fillRect(dimX, dimY, dimW + dimPadX * 2, dimH);
            octx.fillStyle = '#6ee7b7';
            octx.textBaseline = 'middle';
            octx.fillText(dimText, dimX + dimPadX, dimY + dimH / 2);
        }

        octx.restore();
    });
    }

    // Dynamisches Vorschau-Rechteck beim manuellen Zeichnen einer neuen Box
    if (manualDrawStart && manualDrawCurrent) {
        const mx1 = Math.min(manualDrawStart.x, manualDrawCurrent.x);
        const my1 = Math.min(manualDrawStart.y, manualDrawCurrent.y);
        const mx2 = Math.max(manualDrawStart.x, manualDrawCurrent.x);
        const my2 = Math.max(manualDrawStart.y, manualDrawCurrent.y);
        const mw = mx2 - mx1;
        const mh = my2 - my1;

        octx.save();
        octx.strokeStyle = '#8b5cf6';
        octx.lineWidth = lineW + 1;
        octx.fillStyle = boxFillOpacity <= 0 ? 'transparent' : hexToRgba('#8b5cf6', Math.max(0.12, boxFillOpacity + 0.08));
        octx.setLineDash([Math.round(5 * scaleFactor), Math.round(4 * scaleFactor)]);
        octx.fillRect(mx1, my1, mw, mh);
        octx.strokeRect(mx1, my1, mw, mh);
        octx.restore();
    }

    // Roboflow-Style Bild-begrenztes Fadenkreuz (Crosshair Guides)
    if (mouseImgPos && !isPanning && dragMode !== 'moving' && dragMode !== 'resizing') {
        const cx = Math.max(0, Math.min(srcW, mouseImgPos.x));
        const cy = Math.max(0, Math.min(srcH, mouseImgPos.y));
        octx.save();
        octx.beginPath();
        // Horizontale Bild-Hilfslinie (exakt 0 bis srcW)
        octx.moveTo(0, cy);
        octx.lineTo(srcW, cy);
        // Vertikale Bild-Hilfslinie (exakt 0 bis srcH)
        octx.moveTo(cx, 0);
        octx.lineTo(cx, srcH);
        octx.strokeStyle = (isDrawingManualBox || dragMode === 'drawing') ? 'rgba(56, 189, 248, 0.75)' : 'rgba(255, 255, 255, 0.38)';
        octx.lineWidth = Math.max(1, Math.round(1 * scaleFactor));
        octx.setLineDash([Math.round(4 * scaleFactor), Math.round(4 * scaleFactor)]);
        octx.stroke();
        octx.restore();
    }
}

function updateStage0CropPreview() {
    const { el: sourceEl, w: srcW, h: srcH, ready } = getActiveMediaSource();
    if (!stage0CropCanvas || !ready) return;
    const selBox = getSelectedComponentBox();

    const cctx = stage0CropCanvas.getContext('2d');
    if (!selBox) {
        const scale = Math.min(180 / srcW, 95 / srcH);
        stage0CropCanvas.width = Math.max(1, Math.round(srcW * scale));
        stage0CropCanvas.height = Math.max(1, Math.round(srcH * scale));
        cctx.drawImage(sourceEl, 0, 0, stage0CropCanvas.width, stage0CropCanvas.height);

        if (detectedBoxes.length === 0 && selectedBoxIndex !== -2) {
            cctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
            cctx.fillRect(0, 0, stage0CropCanvas.width, stage0CropCanvas.height);
            stage0CropTitle.innerText = window.t ? window.t('studio.no_component_detected') : 'Kein Bauteil erkannt';
            stage0CropInfo.innerHTML = `<span class="meta-pill">${srcW} × ${srcH} px</span>`;
        } else {
            stage0CropTitle.innerText = detectedBoxes.length > 0
                ? (window.t ? window.t('studio.full_image_boxes', { count: detectedBoxes.length }) : `Gesamtbild (${detectedBoxes.length} Boxen)`)
                : (window.t ? window.t('studio.full_image') : 'Gesamtbild');
            const compCountText = window.t ? window.t('studio.components_count', { count: detectedBoxes.length }) : `${detectedBoxes.length} Bauteile`;
            stage0CropInfo.innerHTML = `<span class="meta-pill">${srcW} × ${srcH} px</span>` + (detectedBoxes.length > 0 ? ` <span class="meta-pill accent">${compCountText}</span>` : '');
        }
        return;
    }

    const bw = Math.max(8, selBox.x2 - selBox.x1);
    const bh = Math.max(8, selBox.y2 - selBox.y1);
    const isVert = bh > bw * 1.35 && selBox.leadType !== 'to92';
    const dispW = isVert ? bh : bw;
    const dispH = isVert ? bw : bh;
    const scale = Math.min(180 / dispW, 95 / dispH);
    const cw = Math.max(24, Math.round(dispW * scale));
    const ch = Math.max(24, Math.round(dispH * scale));
    stage0CropCanvas.width = cw;
    stage0CropCanvas.height = ch;

    cctx.save();
    if (isVert) {
        cctx.translate(cw / 2, ch / 2);
        cctx.rotate(-Math.PI / 2);
        cctx.drawImage(sourceEl, selBox.x1, selBox.y1, bw, bh, -ch / 2, -cw / 2, ch, cw);
    } else {
        cctx.drawImage(sourceEl, selBox.x1, selBox.y1, bw, bh, 0, 0, cw, ch);
    }
    cctx.restore();

    const confPct = selBox.confidence ? `${Math.round(selBox.confidence * 100)}%` : '';
    stage0CropTitle.innerText = `Box #${selectedBoxIndex + 1}: ${selBox.label}`;
    stage0CropInfo.innerHTML = `<span class="meta-pill">${bw} × ${bh} px</span>` + (confPct ? ` <span class="meta-pill accent">${confPct}</span>` : '') + (isVert ? ` <span class="meta-pill">↻ 90°</span>` : '');
}

function renderStage0Chips() {
    if (!bboxChips) return;
    bboxChips.innerHTML = '';

    if (detectedBoxes.length === 0) {
        const emptyBadge = document.createElement('span');
        emptyBadge.className = 'bbox-chip';
        emptyBadge.style.cursor = 'default';
        emptyBadge.style.opacity = '0.75';
        emptyBadge.innerText = window.t ? window.t('studio.no_boxes_in_image') : 'Keine Bauteil-Boxen im Bild';
        bboxChips.appendChild(emptyBadge);

        const forceFullBtn = document.createElement('button');
        forceFullBtn.type = 'button';
        forceFullBtn.className = `bbox-chip ${selectedBoxIndex === -2 ? 'active' : ''}`;
        forceFullBtn.innerText = window.t ? window.t('studio.force_full_image') : 'Trotzdem Gesamtbild prüfen';
        forceFullBtn.addEventListener('click', () => selectComponentBox(selectedBoxIndex === -2 ? -1 : -2, true));
        bboxChips.appendChild(forceFullBtn);
        return;
    }

    detectedBoxes.forEach((box, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `bbox-chip ${idx === selectedBoxIndex ? 'active' : ''}`;
        const extraTag = [box.footprint, box.partMarking].filter(Boolean).join(', ');
        btn.innerText = extraTag ? `#${idx + 1} ${box.label} [${extraTag}]` : `#${idx + 1} ${box.label}`;
        btn.addEventListener('click', () => selectComponentBox(idx));
        bboxChips.appendChild(btn);
    });

    if (detectedBoxes.length > 1) {
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = `bbox-chip ${selectedBoxIndex === -1 ? 'active' : ''}`;
        allBtn.innerText = window.t ? window.t('studio.full_image_count', { count: detectedBoxes.length }) : `Gesamtbild (${detectedBoxes.length})`;
        allBtn.addEventListener('click', () => selectComponentBox(-1));
        bboxChips.appendChild(allBtn);
    }
}

function selectComponentBox(idx, triggerDownstream = true) {
    selectedBoxIndex = idx;
    lastRecognizedPartCodes = [];
    drawBboxOverlay();
    renderStage0Chips();
    updateStage0CropPreview();
    if (typeof updateBoxEditBar === 'function') {
        updateBoxEditBar();
    }
    const selectedBoxTag = document.getElementById('selected-box-tag');
    if (selectedBoxTag) {
        if (idx >= 0 && idx < detectedBoxes.length) {
            const prefix = window.t ? window.t('studio.box_prefix') : 'Box';
            selectedBoxTag.innerText = `${prefix} #${idx + 1}: ${detectedBoxes[idx].label}`;
        } else {
            selectedBoxTag.innerText = window.t ? window.t('studio.full_image') : 'Gesamtbild';
        }
    }
    if (typeof renderObjectsList === 'function') {
        renderObjectsList();
    }
    if (typeof updateQuickPaletteActiveState === 'function') {
        updateQuickPaletteActiveState();
    }

    if (!triggerDownstream) return;

    if (detectedBoxes.length === 0 && selectedBoxIndex !== -2) {
        classifyCurrentImage();
        return;
    }

    // Aktualisiere Stufe 2 (OCR-Vorschau-Bildausschnitt) sofort
    prepareOcrImageDataUrl();

    // Falls es ein Widerstand ist (oder Widerstands-Bild), aktualisiere Stufe 3 sofort für diese Box
    const selBox = getSelectedComponentBox();
    if ((selBox && selBox.kind === 'resistor') || (currentMode === 'upload' && previewImage.src.includes('resistor'))) {
        scanResistorBandsFromImage();
    }

    // Aktualisiere Stufe 1 (Klassifizierung)
    if (activeClassifier && !isInferencing) {
        classifyCurrentImage();
    }
}

let lastStage0Result = null;

async function runStage0Detection() {
    const { el: sourceEl, w: srcW, h: srcH, ready } = getActiveMediaSource();
    if (!ready) return;

    runDetectBtn.disabled = true;
    try {
        const t0 = performance.now();
        const boxes = detectSmartHybridBoxes(sourceEl, srcW, srcH);
        const dtMs = Math.round(performance.now() - t0);
        detectedBoxes = boxes;

        if (detectedBoxes.length === 0) {
            lastStage0Result = { count: 0, ms: dtMs, bestIdx: -1 };
            stage0Summary.innerText = window.t
                ? window.t('canvas.no_component_detected_ms', { ms: dtMs })
                : `Kein Bauteil im Bild erkannt (${dtMs} ms)`;
            selectComponentBox(-1, true);
            return;
        }

        // Wähle automatisch das Bauteil mit dem besten Kontrast-/Fokus-Score aus
        let bestIdx = 0;
        let bestScore = -Infinity;
        detectedBoxes.forEach((b, i) => {
            if ((b.score ?? 0) > bestScore) {
                bestScore = b.score ?? 0;
                bestIdx = i;
            }
        });

        lastStage0Result = { count: detectedBoxes.length, ms: dtMs, bestIdx };
        stage0Summary.innerText = window.t
            ? window.t('canvas.components_detected_focused', { count: detectedBoxes.length, ms: dtMs, idx: bestIdx + 1 })
            : `${detectedBoxes.length} Bauteil${detectedBoxes.length === 1 ? '' : 'e'} erkannt (${dtMs} ms) – Bauteil #${bestIdx + 1} fokussiert`;
        selectComponentBox(bestIdx, true);
    } catch (err) {
        console.error('Stufe-0 Detektionsfehler:', err);
        stage0Summary.innerText = window.t
            ? window.t('canvas.error_localizing', { error: err.message || err })
            : `Fehler bei Lokalisierung: ${err.message || err}`;
    } finally {
        runDetectBtn.disabled = false;
    }
}

window.addEventListener('languageChanged', () => {
    renderStage0Chips();
    updateStage0CropPreview();
    const selectedBoxTag = document.getElementById('selected-box-tag');
    if (selectedBoxTag) {
        if (selectedBoxIndex >= 0 && selectedBoxIndex < detectedBoxes.length) {
            const prefix = window.t ? window.t('studio.box_prefix') : 'Box';
            selectedBoxTag.innerText = `${prefix} #${selectedBoxIndex + 1}: ${detectedBoxes[selectedBoxIndex].label}`;
        } else {
            selectedBoxTag.innerText = window.t ? window.t('studio.full_image') : 'Gesamtbild';
        }
    }
    if (stage0Summary && lastStage0Result) {
        if (lastStage0Result.count === 0) {
            stage0Summary.innerText = window.t
                ? window.t('canvas.no_component_detected_ms', { ms: lastStage0Result.ms })
                : `No component detected in image (${lastStage0Result.ms} ms)`;
        } else {
            stage0Summary.innerText = window.t
                ? window.t('canvas.components_detected_focused', { count: lastStage0Result.count, ms: lastStage0Result.ms, idx: lastStage0Result.bestIdx + 1 })
                : `${lastStage0Result.count} components detected (${lastStage0Result.ms} ms) – Component #${lastStage0Result.bestIdx + 1} focused`;
        }
    }
});

