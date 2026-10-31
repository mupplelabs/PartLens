// =====================================================================
// PARTLENS CORE STATE, CONSTANTS & DOM REFERENCES
// =====================================================================

let xenovaModule = null;

const ocrSelect = document.getElementById('ocr-select');
const customClassesInput = document.getElementById('custom-classes');
const tabUpload = document.getElementById('tab-upload');
const tabWebcam = document.getElementById('tab-webcam');
const uploadPanel = document.getElementById('upload-panel');
const webcamPanel = document.getElementById('webcam-panel');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');
const barsContainer = document.getElementById('bars-container');
const previewImage = document.getElementById('preview-image');
const bboxOverlayCanvas = document.getElementById('bbox-overlay-canvas');
const webcamBboxCanvas = document.getElementById('webcam-bbox-canvas');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const reclassifyBtn = document.getElementById('reclassify-btn');
const video = document.getElementById('webcam');
const cameraSelect = document.getElementById('camera-select');
const toggleWebcamBtn = document.getElementById('toggle-webcam-btn');
const captureWebcamBtn = document.getElementById('capture-webcam-btn');
const cameraFileInput = document.getElementById('camera-file-input');
const webcamAutoOcrCb = document.getElementById('webcam-auto-ocr-cb');

// Stufe 0 DOM-Elemente
const runDetectBtn = document.getElementById('run-detect-btn');
const stage0Summary = document.getElementById('stage0-summary');
const bboxChips = document.getElementById('bbox-chips');
const stage0CropCanvas = document.getElementById('stage0-crop-canvas');
const stage0CropTitle = document.getElementById('stage0-crop-title');
const stage0CropInfo = document.getElementById('stage0-crop-info');

const runOcrBtn = document.getElementById('run-ocr-btn');
const enhanceContrastCb = document.getElementById('enhance-contrast-cb');
const centerCropCb = document.getElementById('center-crop-cb');
const ocrAngleSlider = document.getElementById('ocr-angle-slider');
const angleValSpan = document.getElementById('angle-val');
const ocrOutput = document.getElementById('ocr-output');
const partChips = document.getElementById('part-chips');
const ocrPreviewWrapper = document.getElementById('ocr-preview-wrapper');
const ocrPreviewLabel = document.getElementById('ocr-preview-label');
const ocrPreviewCanvas = document.getElementById('ocr-preview-canvas');

// Stufe 3 DOM-Elemente
const scanResistorBtn = document.getElementById('scan-resistor-btn');
const reverseBandsBtn = document.getElementById('reverse-bands-btn');
const scanYSlider = document.getElementById('scan-y-slider');
const scanYVal = document.getElementById('scan-y-val');
const resistorScanWrapper = document.getElementById('resistor-scan-wrapper');
const resistorScanLabel = document.getElementById('resistor-scan-label');
const resistorScanCanvas = document.getElementById('resistor-scan-canvas');
const ohmDisplay = document.getElementById('ohm-display');
const resistorMode4Btn = document.getElementById('resistor-mode-4-btn');
const resistorMode5Btn = document.getElementById('resistor-mode-5-btn');
const resistorBodyTypeBtn = document.getElementById('resistor-body-type-btn');
const resistorBodyGraphic = document.getElementById('resistor-body-graphic');
const resistorBandCards = document.getElementById('resistor-band-cards');
const activeBandLabel = document.getElementById('active-band-label');
const paletteHint = document.getElementById('palette-hint');
const resistorSwatchGrid = document.getElementById('resistor-swatch-grid');
const band1Select = document.getElementById('band-1-select');
const band2Select = document.getElementById('band-2-select');
const band3Select = document.getElementById('band-3-select');
const band4Select = document.getElementById('band-4-select');
const band5Select = document.getElementById('band-5-select');
const visBands = [
    document.getElementById('vis-band-1'),
    document.getElementById('vis-band-2'),
    document.getElementById('vis-band-3'),
    document.getElementById('vis-band-4'),
    document.getElementById('vis-band-5')
];
const smdInput = document.getElementById('smd-input');
const smdOutput = document.getElementById('smd-output');

const BASE_CLIP_CATEGORIES = [
    { prompt: 'a rectangular black plastic DIP integrated circuit microchip package with white printed part number and silver metal pins', label: 'IC / Mikrochip (DIP)' },
    { prompt: 'a cylindrical axial resistor with colored stripe bands and two wire leads', label: 'Widerstand (Resistor)' },
    { prompt: 'a cylindrical aluminum electrolytic capacitor can or round ceramic disc capacitor with two wire leads', label: 'Kondensator (Capacitor)' },
    { prompt: 'an electronic inductor coil with copper wire winding', label: 'Spule / Induktivität (Inductor)' },
    { prompt: 'a small black D-shaped TO-92 or TO-220 semiconductor transistor with three metal wire leads', label: 'Transistor' },
    { prompt: 'a light emitting diode LED with translucent dome or glass diode', label: 'LED / Diode' },
    { prompt: 'a rotary potentiometer with knob or shaft', label: 'Potentiometer' }
];

const KNOWN_COMPONENTS_HINTS = {
    '2N2222A': 'NPN Universal-/Schalttransistor (40V, 800mA, TO-92)',
    '2N2222': 'NPN Universal-/Schalttransistor (30–40V, 800mA, TO-92)',
    '2N3904': 'NPN Kleinsignal-Transistor (40V, 200mA, TO-92)',
    '2N3906': 'PNP Kleinsignal-Transistor (40V, 200mA, TO-92)',
    '2N7000': 'N-Kanal Kleinsignal-MOSFET (60V, 200mA, TO-92)',
    'BC547': 'NPN Kleinsignal-Transistor (45V, 100mA, TO-92)',
    'BC548': 'NPN Kleinsignal-Transistor (30V, 100mA, TO-92)',
    'BC557': 'PNP Kleinsignal-Transistor (45V, 100mA, TO-92)',
    'BC337': 'NPN Universal-Transistor (45V, 800mA, TO-92)',
    'BD139': 'NPN Mittelleistungs-Transistor (80V, 1.5A, TO-126)',
    '2SC1815': 'NPN Audio-/HF-Transistor (50V, 150mA, TO-92)',
    'IRFZ44': 'N-Kanal Power-MOSFET (55V, 49A, TO-220)',
    '1N4007': 'Gleichrichterdiode (1000V, 1A, DO-41)',
    '1N4148': 'Schnelle Universal-Schaltdiode (100V, 200mA)',
    'CD4094': 'CMOS 8-Stage Shift-and-Store Bus Register (Texas Instruments)',
    'ISD1820': 'Voice Record / Playback IC (8–20 Sek. Single-Chip Audio)',
    'ISD9716': 'ChipCorder Audio / Voice IC',
    'NE555': 'Präzisions-Timer / Oszillator IC',
    'LM358': 'Dual Operationsverstärker (Op-Amp)',
    'LM7805': '5V Festspannungsregler (Linear Regulator)',
    'ATMEGA328': '8-Bit AVR Mikrocontroller (Arduino Uno)'
};

// IEC 60062 Widerstands-Farbcode-Tabelle
const RESISTOR_COLORS = [
    { key: 'black',  name: 'Schwarz (0)',  digit: 0, mult: 1,       tol: null,    hex: '#18181b', rgb: [25, 25, 28] },
    { key: 'brown',  name: 'Braun (1)',    digit: 1, mult: 10,      tol: '±1%',   hex: '#7c3f1c', rgb: [124, 63, 28] },
    { key: 'red',    name: 'Rot (2)',      digit: 2, mult: 100,     tol: '±2%',   hex: '#dc2626', rgb: [210, 34, 34] },
    { key: 'orange', name: 'Orange (3)',   digit: 3, mult: 1e3,     tol: null,    hex: '#ea580c', rgb: [234, 98, 18] },
    { key: 'yellow', name: 'Gelb (4)',     digit: 4, mult: 1e4,     tol: null,    hex: '#facc15', rgb: [242, 204, 15] },
    { key: 'green',  name: 'Grün (5)',     digit: 5, mult: 1e5,     tol: '±0,5%', hex: '#16a34a', rgb: [22, 163, 74] },
    { key: 'blue',   name: 'Blau (6)',     digit: 6, mult: 1e6,     tol: '±0,25%',hex: '#2563eb', rgb: [37, 99, 235] },
    { key: 'violet', name: 'Violett (7)',  digit: 7, mult: 1e7,     tol: '±0,1%', hex: '#9333ea', rgb: [128, 42, 168] },
    { key: 'grey',   name: 'Grau (8)',     digit: 8, mult: 1e8,     tol: '±0,05%',hex: '#64748b', rgb: [110, 118, 130] },
    { key: 'white',  name: 'Weiß (9)',     digit: 9, mult: 1e9,     tol: null,    hex: '#f8fafc', rgb: [245, 245, 248] },
    { key: 'gold',   name: 'Gold (±5%)',   digit: null, mult: 0.1,  tol: '±5%',   hex: '#ca8a04', rgb: [201, 158, 42] },
    { key: 'silver', name: 'Silber (±10%)',digit: null, mult: 0.01, tol: '±10%',  hex: '#94a3b8', rgb: [175, 182, 192] }
];
const COLOR_BY_KEY = Object.fromEntries(RESISTOR_COLORS.map(c => [c.key, c]));

let activeClassifier = null;
let currentMode = 'upload';
let webcamRunning = false;
let isInferencing = false;
let isOcrRunning = false;
let lastWebcamAutoOcrAt = 0;
let currentStream = null;

let isRotatingImage = false;
let suppressAutoStage0 = false;

let knownDatasetClasses = [
    'resistor', 'capacitor', 'inductor', 'diode', 'led',
    'transistor', 'ic', 'potentiometer', 'switch_button',
    'relay', 'connector', 'display', 'board', 'other'
];

// DOM-Elemente für Auto-Label & Box-Editor
const runAutolabelBtn = document.getElementById('run-autolabel-btn');
const modeSelectBtn = document.getElementById('mode-select-btn');
const addManualBoxBtn = document.getElementById('add-manual-box-btn');
const boxEditBar = document.getElementById('box-edit-bar');
const selectedBoxTag = document.getElementById('selected-box-tag');
const boxClassSelect = document.getElementById('box-class-select');
const deleteBoxBtn = document.getElementById('delete-box-btn');
const datasetSplit = document.getElementById('dataset-split');
const saveDatasetBtn = document.getElementById('save-dataset-btn');
const autolabelStatus = document.getElementById('autolabel-status');
const datasetCounterBadge = document.getElementById('dataset-counter-badge');

let florenceBundle = null;
let tesseractWorker = null;

// Stufe 0 & Cross-Stage State: Erkannte Bounding Boxes + erkannte OCR-Bauteilcodes
let detectedBoxes = [];
let selectedBoxIndex = 0; // -1 = Gesamtbild, 0..N-1 = ausgewähltes Bauteil
let hoveredBoxIndex = -1;
let isolateSelectedBox = false; // true = nur ausgewähltes Bauteil anzeigen; ist keines gewählt, alle ausblenden
let lastRawStage1Results = null;
let lastRecognizedPartCodes = [];

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

function getActiveMediaSource() {
    if (currentMode === 'webcam') {
        const w = video.videoWidth || 0;
        const h = video.videoHeight || 0;
        return {
            el: video,
            w,
            h,
            ready: Boolean(video.readyState >= video.HAVE_CURRENT_DATA && w > 0 && h > 0),
            overlay: webcamBboxCanvas
        };
    }
    const w = previewImage.naturalWidth || 0;
    const h = previewImage.naturalHeight || 0;
    return {
        el: previewImage,
        w,
        h,
        ready: Boolean(previewImage.complete && w > 0 && h > 0),
        overlay: bboxOverlayCanvas
    };
}



function formatOhms(ohms) {
if (ohms >= 1e9) return `${(ohms / 1e9).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} GΩ`;
if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} MΩ`;
if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} kΩ`;
return `${ohms.toFixed(1).replace(/\.?0+$/, '').replace('.', ',')} Ω`;
}
