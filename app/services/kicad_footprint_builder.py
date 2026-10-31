import re
import json
import asyncio
import httpx
from pathlib import Path
from typing import Optional, List, Dict

from app.config import (
    CACHE_DIR,
    FOOTPRINTS_CACHE_DIR,
    FOOTPRINTS_INDEX_FILE,
    FOOTPRINTS_CDN_URL,
    FOOTPRINTS_CDN_FALLBACK,
)

KICAD_LISTS_URL = "https://raw.githubusercontent.com/Part-DB/kicad-library-lists/master/footprints.txt"

# Mapping from KiCad library category to our 14 standardized component classes
CATEGORY_TO_CLASS = {
    "Package_DIP": "ic",
    "Package_SO": "ic",
    "Package_QFP": "ic",
    "Package_DFN_QFN": "ic",
    "Package_BGA": "ic",
    "Package_SIP": "ic",
    "Resistor_SMD": "resistor",
    "Resistor_THT": "resistor",
    "Capacitor_SMD": "capacitor",
    "Capacitor_THT": "capacitor",
    "Capacitor_Tantalum_SMD": "capacitor",
    "Diode_SMD": "diode",
    "Diode_THT": "diode",
    "LED_SMD": "led",
    "LED_THT": "led",
    "Package_TO_SOT_SMD": "transistor",
    "Package_TO_SOT_THT": "transistor",
    "Inductor_SMD": "inductor",
    "Inductor_THT": "inductor",
    "Button_Switch_SMD": "switch_button",
    "Button_Switch_THT": "switch_button",
    "Relay_SMD": "relay",
    "Relay_THT": "relay",
    "Potentiometer_SMD": "potentiometer",
    "Potentiometer_THT": "potentiometer",
    "Connector_PinHeader_2.54mm": "connector",
    "Connector_PinHeader_1.27mm": "connector",
    "Connector_PinSocket_2.54mm": "connector",
    "Connector_USB": "connector",
    "Connector_JST": "connector",
    "Display": "display",
    "Display_7Segment": "display",
    "Module": "board",
}

# 120 most common hardware packages prioritized for offline bundling / preloading
CORE_FOOTPRINTS_TARGETS = [
    # DIP (Dual Inline Package)
    "Package_DIP:DIP-4_W7.62mm",
    "Package_DIP:DIP-6_W7.62mm",
    "Package_DIP:DIP-8_W7.62mm",
    "Package_DIP:DIP-14_W7.62mm",
    "Package_DIP:DIP-16_W7.62mm",
    "Package_DIP:DIP-18_W7.62mm",
    "Package_DIP:DIP-20_W7.62mm",
    "Package_DIP:DIP-24_W7.62mm",
    "Package_DIP:DIP-28_W7.62mm",
    "Package_DIP:DIP-40_W15.24mm",
    # SOIC / SOP
    "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
    "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm",
    "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm",
    "Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm",
    "Package_SO:SOIC-20W_7.5x12.8mm_P1.27mm",
    "Package_SO:SOIC-28W_7.5x17.9mm_P1.27mm",
    # TSSOP / MSOP
    "Package_SO:TSSOP-8_4.4x3mm_P0.65mm",
    "Package_SO:TSSOP-14_4.4x5mm_P0.65mm",
    "Package_SO:TSSOP-16_4.4x5mm_P0.65mm",
    "Package_SO:TSSOP-20_4.4x6.5mm_P0.65mm",
    "Package_SO:TSSOP-24_4.4x7.8mm_P0.65mm",
    "Package_SO:TSSOP-28_4.4x9.7mm_P0.65mm",
    "Package_SO:MSOP-8_3x3mm_P0.65mm",
    "Package_SO:MSOP-10_3x3mm_P0.5mm",
    "Package_SO:SSOP-28_5.3x10.2mm_P0.65mm",
    # QFP (Quad Flat Package)
    "Package_QFP:TQFP-32_7x7mm_P0.8mm",
    "Package_QFP:TQFP-44_10x10mm_P0.8mm",
    "Package_QFP:TQFP-48_7x7mm_P0.5mm",
    "Package_QFP:TQFP-64_10x10mm_P0.5mm",
    "Package_QFP:TQFP-100_14x14mm_P0.5mm",
    "Package_QFP:LQFP-32_7x7mm_P0.8mm",
    "Package_QFP:LQFP-44_10x10mm_P0.8mm",
    "Package_QFP:LQFP-48_7x7mm_P0.5mm",
    "Package_QFP:LQFP-64_10x10mm_P0.5mm",
    "Package_QFP:LQFP-100_14x14mm_P0.5mm",
    "Package_QFP:PQFP-100_14x20mm_P0.65mm",
    # QFN / DFN
    "Package_DFN_QFN:QFN-16-1EP_3x3mm_P0.5mm_EP1.8x1.8mm",
    "Package_DFN_QFN:QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm",
    "Package_DFN_QFN:QFN-24-1EP_4x4mm_P0.5mm_EP2.6x2.6mm",
    "Package_DFN_QFN:QFN-28-1EP_4x4mm_P0.4mm_EP2.4x2.4mm",
    "Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.1x3.1mm",
    "Package_DFN_QFN:QFN-48-1EP_7x7mm_P0.5mm_EP5.15x5.15mm",
    "Package_DFN_QFN:DFN-8-1EP_2x3mm_P0.5mm_EP0.61x2.2mm",
    # Transistor SOT / TO
    "Package_TO_SOT_SMD:SOT-23",
    "Package_TO_SOT_SMD:SOT-23-5",
    "Package_TO_SOT_SMD:SOT-23-6",
    "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
    "Package_TO_SOT_SMD:SOT-89-3",
    "Package_TO_SOT_SMD:TO-252-2",
    "Package_TO_SOT_SMD:TO-263-2",
    "Package_TO_SOT_THT:TO-92_Inline",
    "Package_TO_SOT_THT:TO-220-3_Vertical",
    "Package_TO_SOT_THT:TO-247-3_Vertical",
    "Package_TO_SOT_THT:TO-126-3_Vertical",
    # Resistors SMD
    "Resistor_SMD:R_0402_1005Metric",
    "Resistor_SMD:R_0603_1608Metric",
    "Resistor_SMD:R_0805_2012Metric",
    "Resistor_SMD:R_1206_3216Metric",
    "Resistor_SMD:R_1210_3225Metric",
    "Resistor_SMD:R_2010_5025Metric",
    "Resistor_SMD:R_2512_6332Metric",
    # Resistors THT
    "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
    "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal",
    "Resistor_THT:R_Axial_DIN0204_L3.6mm_D1.6mm_P5.08mm_Horizontal",
    # Capacitors SMD
    "Capacitor_SMD:C_0402_1005Metric",
    "Capacitor_SMD:C_0603_1608Metric",
    "Capacitor_SMD:C_0805_2012Metric",
    "Capacitor_SMD:C_1206_3216Metric",
    "Capacitor_SMD:C_1210_3225Metric",
    "Capacitor_Tantalum_SMD:CP_EIA-3216-18_Kemet-A",
    "Capacitor_Tantalum_SMD:CP_EIA-3528-21_Kemet-B",
    "Capacitor_Tantalum_SMD:CP_EIA-6032-28_Kemet-C",
    "Capacitor_Tantalum_SMD:CP_EIA-7343-31_Kemet-D",
    # Capacitors THT
    "Capacitor_THT:CP_Radial_D5.0mm_P2.00mm",
    "Capacitor_THT:CP_Radial_D6.3mm_P2.50mm",
    "Capacitor_THT:CP_Radial_D8.0mm_P3.50mm",
    "Capacitor_THT:CP_Radial_D10.0mm_P5.00mm",
    "Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P2.50mm",
    # Diodes SMD & THT
    "Diode_SMD:D_SMA",
    "Diode_SMD:D_SMB",
    "Diode_SMD:D_SMC",
    "Diode_SMD:D_SOD-123",
    "Diode_SMD:D_SOD-323",
    "Diode_SMD:D_SOD-523",
    "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal",
    "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal",
    # LEDs SMD & THT
    "LED_SMD:LED_0603_1608Metric",
    "LED_SMD:LED_0805_2012Metric",
    "LED_SMD:LED_1206_3216Metric",
    "LED_THT:LED_D3.0mm",
    "LED_THT:LED_D5.0mm",
    # Inductors
    "Inductor_SMD:L_0603_1608Metric",
    "Inductor_SMD:L_0805_2012Metric",
    "Inductor_SMD:L_1206_3216Metric",
    "Inductor_SMD:L_1210_3225Metric",
    # Connectors
    "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
    "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
    "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
    "Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical",
    "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical",
    "Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical",
    "Connector_PinHeader_2.54mm:PinHeader_2x04_P2.54mm_Vertical",
    "Connector_USB:USB_C_Receptacle_GCT_USB4085",
    "Connector_USB:USB_Micro-B_Amphenol_10103594-0001LF_Horizontal",
    # Switches
    "Button_Switch_SMD:SW_Push_1P1T_NO_6x6mm_H9.5mm",
    "Button_Switch_THT:SW_PUSH_6mm_H5mm",
    # Relays
    "Relay_THT:Relay_SPDT_Omron_G5Q",
    # Potentiometers
    "Potentiometer_THT:Potentiometer_Bourns_3296W_Vertical",
    "Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical",
]


def clean_footprint_name(raw_name: str) -> str:
    """Generates a clean, short display name for a footprint (e.g. 'SOIC-8', 'TQFP-32', 'R_0805', 'SOD-123')."""
    if raw_name.startswith("D_"):
        sub = raw_name[2:]
        parts = sub.split("_")
        return parts[0]
    if raw_name.startswith("CP_"):
        sub = raw_name[3:]
        parts = sub.split("_")
        if parts[0] == "Radial" and len(parts) > 1:
            return f"Radial_{parts[1]}"
        return parts[0]
    if raw_name.startswith("PinHeader_"):
        parts = raw_name.split("_")
        return f"{parts[0]}_{parts[1]}"

    parts = raw_name.split("_")
    prefix = parts[0]
    if len(parts) > 1 and any(k in parts[1] for k in ["x", "mm", "W", "Tab", "Metric", "Vertical", "Horizontal", "Inline", "DIN"]):
        if prefix in ["R", "C", "L", "LED"]:
            return f"{prefix}_{parts[1]}"
        return prefix
    if len(parts) > 1 and re.match(r"^\d+", parts[1]):
        return f"{prefix}_{parts[1]}"
    return prefix or raw_name


def generate_aliases(cat: str, raw_name: str, clean_name: str) -> List[str]:
    """Generates search-friendly aliases for a footprint."""
    aliases = set()
    for s in (raw_name, clean_name):
        s_low = s.lower()
        aliases.add(s_low)
        aliases.add(s_low.replace("-", "").replace("_", ""))
        aliases.add(s_low.replace("-", "_"))
        aliases.add(s_low.replace("_", "-"))

    # Specific IC aliases
    if "soic" in clean_name.lower():
        num = re.findall(r"\d+", clean_name)
        if num:
            aliases.add(f"so{num[0]}")
            aliases.add(f"sop{num[0]}")
            aliases.add(f"soic{num[0]}")
    elif "tqfp" in clean_name.lower():
        num = re.findall(r"\d+", clean_name)
        if num:
            aliases.add(f"qfp{num[0]}")
            aliases.add(f"tqfp{num[0]}")
    elif "dip" in clean_name.lower():
        num = re.findall(r"\d+", clean_name)
        if num:
            aliases.add(f"dip{num[0]}")
            aliases.add(f"dil{num[0]}")
    elif clean_name.startswith("R_") or clean_name.startswith("C_") or clean_name.startswith("L_"):
        parts = clean_name.split("_")
        if len(parts) > 1 and parts[1].isdigit():
            aliases.add(parts[1])  # e.g. "0805"
            aliases.add(clean_name.lower())
    elif "sod" in raw_name.lower():
        num = re.findall(r"sod-?\d+", raw_name.lower())
        for n in num:
            aliases.add(n)
            aliases.add(n.replace("-", ""))
    elif any(k in raw_name.lower() for k in ["sma", "smb", "smc"]):
        for k in ["sma", "smb", "smc"]:
            if k in raw_name.lower():
                aliases.add(k)
    elif "do-" in raw_name.lower() or "do" in raw_name.lower():
        num = re.findall(r"do-?\d+", raw_name.lower())
        for n in num:
            aliases.add(n)
            aliases.add(n.replace("-", ""))

    return sorted(list(aliases))



async def fetch_kicad_footprints_list() -> List[str]:
    """Fetches the official KiCad footprint list from Part-DB/kicad-library-lists."""
    cached_list_file = CACHE_DIR / "kicad_footprints_raw.txt"
    if cached_list_file.exists():
        return [l.strip() for l in cached_list_file.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(KICAD_LISTS_URL, headers={"User-Agent": "PartLens/2.0"})
            if resp.status_code == 200:
                text = resp.text
                cached_list_file.write_text(text, encoding="utf-8")
                return [l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")]
    except Exception as e:
        print(f"Warning: Could not fetch KiCad footprint list: {e}", flush=True)

    return []


def build_kicad_index(raw_lines: List[str]) -> List[Dict]:
    """Builds a structured index array for PartLens from KiCad footprint lines."""
    entries = []
    seen_ids = set()

    for line in raw_lines:
        cat, _, name = line.partition(":")
        if not cat or not name:
            continue
        if cat not in CATEGORY_TO_CLASS:
            continue

        comp_class = CATEGORY_TO_CLASS[cat]
        clean_name = clean_footprint_name(name)
        rel_path = f"{cat}/{name}.png"

        if rel_path in seen_ids:
            continue
        seen_ids.add(rel_path)

        aliases = generate_aliases(cat, name, clean_name)

        entries.append({
            "id": rel_path,
            "name": clean_name,
            "full_name": name,
            "filename": f"{name}.png",
            "category": cat,
            "subcategory": cat.replace("Package_", "").replace("Connector_", ""),
            "path": rel_path,
            "matched_classes": [comp_class],
            "aliases": aliases,
        })

    return entries


async def download_footprint_file(client: httpx.AsyncClient, rel_path: str, dest_dir: Path) -> bool:
    """Downloads a single footprint preview image to the local cache directory."""
    dest_file = dest_dir / rel_path
    if dest_file.exists() and dest_file.stat().st_size > 100:
        return True

    urls = [
        f"{FOOTPRINTS_CDN_URL.rstrip('/')}/{rel_path}",
        f"{FOOTPRINTS_CDN_FALLBACK.rstrip('/')}/{rel_path}",
    ]

    for u in urls:
        try:
            resp = await client.get(u)
            if resp.status_code == 200 and len(resp.content) > 100:
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                dest_file.write_bytes(resp.content)
                return True
        except Exception:
            continue
    return False


async def preload_core_footprints(progress_callback=None) -> int:
    """Pre-downloads the top ~120 core footprints into the local cache."""
    FOOTPRINTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    success_count = 0

    semaphore = asyncio.Semaphore(10)

    async def _download_one(client, target):
        nonlocal success_count
        cat, _, name = target.partition(":")
        rel_path = f"{cat}/{name}.png"
        async with semaphore:
            ok = await download_footprint_file(client, rel_path, FOOTPRINTS_CACHE_DIR)
            if ok:
                success_count += 1
            if progress_callback:
                progress_callback(success_count, len(CORE_FOOTPRINTS_TARGETS))

    async with httpx.AsyncClient(timeout=12.0) as client:
        tasks = [_download_one(client, target) for target in CORE_FOOTPRINTS_TARGETS]
        await asyncio.gather(*tasks, return_exceptions=True)

    return success_count


async def generate_and_save_index() -> int:
    """Generates the full KiCad footprint index and saves it to FOOTPRINTS_INDEX_FILE."""
    lines = await fetch_kicad_footprints_list()
    if not lines:
        print("No KiCad footprint lines available.", flush=True)
        return 0

    entries = build_kicad_index(lines)
    FOOTPRINTS_INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    FOOTPRINTS_INDEX_FILE.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(f"[PartLens] Successfully built KiCad footprint index with {len(entries)} items at {FOOTPRINTS_INDEX_FILE}", flush=True)
    return len(entries)
