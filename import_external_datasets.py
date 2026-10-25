#!/usr/bin/env python3
"""
Importiert und normalisiert externe YOLO-Datensätze (Roboflow & Mendeley Data)
in das ComponentTracker-YOLO-Schema (14 englische Klassen).
Unterstützt Dry-Run, automatische Polygon-zu-BBox-Wandlung und Thumbnail-Generierung.
"""

import os
import sys
import argparse
import shutil
from pathlib import Path

# PIL wird nur beim echten Bild-Import geladen (spart 11s C-Extension Startup)

BASE_DIR = Path(__file__).resolve().parent
DATASET_DIR = BASE_DIR / "dataset"
THUMBNAILS_DIR = DATASET_DIR / "thumbnails"
EXT_DIR = BASE_DIR / "external_datasets"

# 14 Zielklassen
TARGET_CLASSES = [
    "resistor",         # 0
    "capacitor",        # 1
    "inductor",         # 2
    "diode",            # 3
    "led",              # 4
    "transistor",       # 5
    "ic",               # 6
    "potentiometer",    # 7
    "switch_button",    # 8
    "relay",            # 9
    "connector",        # 10
    "display",          # 11
    "board",            # 12
    "other"             # 13
]
CLASS_TO_ID = {c: i for i, c in enumerate(TARGET_CLASSES)}

# Mappings für Mendeley Data (ElectroCom61)
ELECTROCOM61_MAPPING = {
    # Resistors
    'Resistor': 'resistor',
    
    # Capacitors
    'Capacitor-10mf': 'capacitor',
    'Capacitor-470mf': 'capacitor',
    'Film-Capacitor': 'capacitor',
    'High-Voltage-Ceramic-Capacitor': 'capacitor',
    'Low-Voltage-Ceramic-Capacitor': 'capacitor',
    'MLC-Capacitor': 'capacitor',
    
    # Inductors
    'Inductor': 'inductor',
    
    # Diodes & LEDs
    'Diode': 'diode',
    'Zener-Diode': 'diode',
    'LED-Light': 'led',
    
    # Transistors
    'BJT-Transistor': 'transistor',
    'MOSFET': 'transistor',
    'IGBT': 'transistor',
    
    # ICs
    'IC-Chip': 'ic',
    'IC-Base-14-Pin': 'ic',
    'IC-Base-28-Pin': 'ic',
    
    # Potentiometers
    'Taper-Potentiometer': 'potentiometer',
    'Trimmer-Potentiometer': 'potentiometer',
    
    # Switches & Buttons
    'Push-Switch': 'switch_button',
    'Rocker-Switch': 'switch_button',
    'Tact-Switch': 'switch_button',
    
    # Relays
    'Relay-Module': 'relay',
    
    # Connectors
    'Pin-Header': 'connector',
    
    # Displays
    '7-Segment-Display': 'display',
    'LCD-Display': 'display',
    'OLED-Display': 'display',
    
    # Boards & Modules
    'Arduino-Mega': 'board',
    'Arduino-Nano': 'board',
    'Arduino-Uno': 'board',
    'ESP32': 'board',
    'ESP32-CAM': 'board',
    'Bluetooth-Module': 'board',
    'FT-232-USB-Serial-Module': 'board',
    'GSM-Module': 'board',
    'Motor-Driver': 'board',
    
    # Other / Periphery
    '1-5-Volt-Battery': 'other',
    '3-3-Volt-Battery': 'other',
    '9-Volt-Battery': 'other',
    'Breadboard': 'other',
    'Bridge-Rectifier': 'other',
    'Buck-Converter': 'other',
    'Buzzer': 'other',
    'DC-Motor': 'other',
    'Fuse': 'other',
    'Fuse-Base': 'other',
    'Gas-Sensor': 'other',
    'Heat-Sink': 'other',
    'Humidity-Sensor': 'other',
    'IR-Sensor': 'other',
    'Keypad': 'other',
    'LDR-Sensor': 'other',
    'Motion-Sensor': 'other',
    'NTC-Thermistor': 'other',
    'RFID-Scanner': 'other',
    'Raindrops-Module': 'other',
    'Servo-Motor': 'other',
    'Soil-Moisture-Sensor': 'other',
    'Sonar-Sensor': 'other',
    'TCRT5000': 'other',
    'Water-Sensor': 'other',
}

# Mappings für Roboflow (Electronic Components Detection)
ROBOFLOW_MAPPING = {
    'Resistor': 'resistor',
    'resistor': 'resistor',
    'Capacitor': 'capacitor',
    'capacitor': 'capacitor',
    'ceramic-capacitor': 'capacitor',
    'electrolytic-capacitor': 'capacitor',
    'polyester-capacitor': 'capacitor',
    'Inductor': 'inductor',
    'inductor': 'inductor',
    'Ferrite Bead': 'inductor',
    'Diode': 'diode',
    'diode': 'diode',
    'Led': 'led',
    'Transistor': 'transistor',
    'transistor': 'transistor',
    'DIP': 'ic',
    'IC': 'ic',
    'Processor': 'ic',
    'Button': 'switch_button',
    'Switch': 'switch_button',
    'Connector': 'connector',
    # Irrelevante / Lötpunkte
    'Clock': 'other',
    'Jumper': 'other',
    'Oscillator': 'other',
    'Pads': 'other',
    'Pins': 'other',
    'Test Point': 'other',
}

def parse_yaml_names(yaml_path: Path) -> list[str]:
    """Liest Klassennamen aus Roboflow data.yaml."""
    if not yaml_path.exists():
        return []
    lines = yaml_path.read_text(encoding='utf-8').splitlines()
    for l in lines:
        if l.strip().startswith('names:'):
            # Format: names: ['a', 'b', ...]
            val = l.split('names:', 1)[1].strip()
            if val.startswith('[') and val.endswith(']'):
                items = val[1:-1].split(',')
                return [i.strip().strip("'\"") for i in items if i.strip()]
    return []

def polygon_to_bbox(coords: list[float]) -> tuple[float, float, float, float]:
    """Wandelt Polygon-Koordinaten (x1 y1 x2 y2 ...) in YOLO BBox (xc, yc, w, h) um."""
    xs = coords[0::2]
    ys = coords[1::2]
    xmin = max(0.0, min(1.0, min(xs)))
    xmax = max(0.0, min(1.0, max(xs)))
    ymin = max(0.0, min(1.0, min(ys)))
    ymax = max(0.0, min(1.0, max(ys)))
    
    w = max(0.002, xmax - xmin)
    h = max(0.002, ymax - ymin)
    xc = xmin + w / 2.0
    yc = ymin + h / 2.0
    return xc, yc, w, h

def run_import(
    dry_run: bool = True,
    skip_other: bool = False,
    max_samples: int = 0,
    generate_thumbnails: bool = True
):
    print("=" * 70)
    mode_str = "🔍 DRY-RUN (Keine Änderungen)" if dry_run else "🚀 LIVE-IMPORT"
    print(f"ComponentTracker Datensatz-Import: {mode_str}")
    print(f"Ziel-Klassen ({len(TARGET_CLASSES)}): {TARGET_CLASSES}")
    print(f"Optionen: skip_other={skip_other}, max_samples={max_samples or 'Alle'}")
    print("=" * 70)

    datasets = [
        {
            "name": "Mendeley_ElectroCom61",
            "root": EXT_DIR / "ElectroCom61 A Multiclass Dataset for Detection of Electronic Components" / "ElectroCom61",
            "prefix": "mendeley_",
            "mapping": ELECTROCOM61_MAPPING
        },
        {
            "name": "Roboflow_ElectronicComponents",
            "root": EXT_DIR / "Electronic Components Detection",
            "prefix": "roboflow_",
            "mapping": ROBOFLOW_MAPPING
        }
    ]

    total_images_processed = 0
    total_images_imported = 0
    total_boxes_imported = 0
    total_boxes_skipped = 0
    class_stats = {c: 0 for c in TARGET_CLASSES}

    for ds in datasets:
        ds_name = ds["name"]
        root = ds["root"]
        prefix = ds["prefix"]
        mapping = ds["mapping"]

        if not root.exists():
            print(f"⚠️ Verzeichnis für {ds_name} nicht gefunden: {root}")
            continue

        raw_classes = parse_yaml_names(root / "data.yaml")
        print(f"\n📂 Analysiere {ds_name} ({len(raw_classes)} Quell-Klassen)...")

        # Splits verarbeiten (train -> train, valid/val/test -> val)
        splits = ["train", "valid", "val", "test"]
        ds_images_count = 0

        for sp in splits:
            sp_dir = root / sp
            img_dir = sp_dir / "images"
            lbl_dir = sp_dir / "labels"
            if not img_dir.exists():
                continue

            target_split = "train" if sp == "train" else "val"
            img_files = sorted(list(img_dir.glob("*.*")))

            print(f"  Split '{sp}' -> Ziel: '{target_split}' ({len(img_files)} Bilder)", flush=True)

            for idx, img_path in enumerate(img_files):
                if max_samples > 0 and ds_images_count >= max_samples:
                    break

                total_images_processed += 1
                ds_images_count += 1

                if (idx + 1) % 250 == 0 or (idx + 1) == len(img_files):
                    print(f"    ⏳ Verarbeitet: {idx + 1}/{len(img_files)} ({target_split})...", flush=True)

                # Zugehörige Label-Datei finden
                lbl_path = lbl_dir / f"{img_path.stem}.txt"
                if not lbl_path.exists():
                    continue

                try:
                    lines = lbl_path.read_text(encoding="utf-8").splitlines()
                except Exception:
                    continue

                target_lines = []

                for line in lines:
                    parts = line.strip().split()
                    if not parts:
                        continue

                    try:
                        raw_cid = int(parts[0])
                        floats = [float(v) for v in parts[1:]]
                    except ValueError:
                        continue

                    # Klassenname aus dem Quell-Datensatz auflösen
                    raw_name = raw_classes[raw_cid] if 0 <= raw_cid < len(raw_classes) else "other"
                    target_name = mapping.get(raw_name, "other")

                    if skip_other and target_name == "other":
                        total_boxes_skipped += 1
                        continue

                    target_cid = CLASS_TO_ID.get(target_name, CLASS_TO_ID["other"])

                    # Koordinaten bestimmen (BBox oder Polygon)
                    if len(floats) == 4:
                        xc, yc, bw, bh = floats
                    elif len(floats) > 4:
                        xc, yc, bw, bh = polygon_to_bbox(floats)
                    else:
                        continue

                    target_lines.append(f"{target_cid} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")
                    class_stats[target_name] += 1
                    total_boxes_imported += 1

                # Wenn keine Boxen übrig geblieben sind und skip_other aktiv ist, Bild überspringen
                if not target_lines:
                    continue

                total_images_imported += 1
                new_stem = f"{prefix}{img_path.stem}"

                if not dry_run:
                    # 1. Bild kopieren
                    dest_img = DATASET_DIR / "images" / target_split / f"{new_stem}.jpg"
                    dest_lbl = DATASET_DIR / "labels" / target_split / f"{new_stem}.txt"

                    dest_img.parent.mkdir(parents=True, exist_ok=True)
                    dest_lbl.parent.mkdir(parents=True, exist_ok=True)

                    # Als JPEG speichern (konvertiert eventuelle PNGs sauber)
                    try:
                        from PIL import Image
                        with Image.open(img_path) as im:
                            rgb_im = im.convert("RGB")
                            rgb_im.save(dest_img, format="JPEG", quality=92)
                            
                            # 2. Low-Res Thumbnail erzeugen
                            if generate_thumbnails:
                                thumb_dir = THUMBNAILS_DIR / target_split
                                thumb_dir.mkdir(parents=True, exist_ok=True)
                                thumb_path = thumb_dir / f"{new_stem}.webp"
                                thumb_im = rgb_im.copy()
                                thumb_im.thumbnail((380, 380), Image.Resampling.BILINEAR)
                                thumb_im.save(thumb_path, format="WEBP", quality=75)
                    except Exception as err:
                        print(f"Fehler bei Bild {img_path.name}: {err}", flush=True)
                        continue

                    # 3. Label-Datei schreiben
                    dest_lbl.write_text("\n".join(target_lines) + "\n", encoding="utf-8")

    print("\n" + "=" * 70)
    print("📊 ZUSAMMENFASSUNG DES IMPORTS")
    print("=" * 70)
    print(f"Gescannte Bilder:       {total_images_processed}")
    print(f"Zu importierende Bilder: {total_images_imported}")
    print(f"Importierte Boxen:      {total_boxes_imported}")
    if skip_other:
        print(f"Übersprungene Boxen:    {total_boxes_skipped}")

    print("\nVerteilung auf die 14 Ziel-Klassen:")
    for c in TARGET_CLASSES:
        cnt = class_stats[c]
        pct = (cnt / total_boxes_imported * 100) if total_boxes_imported > 0 else 0
        bar = "█" * int(pct / 2.5)
        print(f"  {c:<15} {cnt:>6} Boxen ({pct:>5.1f}%) {bar}")

    if dry_run:
        print("\n💡 Dies war ein DRY-RUN. Führe das Skript ohne '--dry-run' aus, um den Import durchzuführen:")
        print("   python import_external_datasets.py --live")
    else:
        print("\n🎉 Import erfolgreich abgeschlossen! Datensatz und Thumbnails wurden aktualisiert.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import external YOLO datasets")
    parser.add_argument("--live", action="store_true", help="Führt den tatsächlichen Import aus (Standard ist Dry-Run)")
    parser.add_argument("--skip-other", action="store_true", help="Verwirft Boxen, die nach 'other' gemappt wurden")
    parser.add_argument("--max", type=int, default=0, help="Maximale Bilder pro Datensatz (0 = alle)")
    parser.add_argument("--no-thumbnails", action="store_true", help="Keine WebP-Thumbnails erzeugen")

    args = parser.parse_args()
    run_import(
        dry_run=not args.live,
        skip_other=args.skip_other,
        max_samples=args.max,
        generate_thumbnails=not args.no_thumbnails
    )
