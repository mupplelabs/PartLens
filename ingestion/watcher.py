"""
PartLens Ingestion Watcher Sidecar Service.
Monitors a watch folder (e.g. NAS share) for incoming component photos,
batches them using configurable debounce (quiet period & max wait),
verifies image integrity, converts HEIC to JPEG, and invokes the PartLens
Auto-Label and Dataset API with 'needs-review' tagging.
"""

import base64
from datetime import datetime
import io
import logging
import os
from pathlib import Path
import shutil
import sys
import threading
import time
from typing import Optional, Set

import httpx
from PIL import Image
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [Ingestion] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout
)
logger = logging.getLogger("partlens-ingestion")

# Configuration via environment variables
WATCH_DIR = Path(os.environ.get("WATCH_DIR", "/watch"))
API_BASE_URL = os.environ.get("API_BASE_URL", "http://component-tracker:8000").rstrip("/")
QUIET_PERIOD_SEC = float(os.environ.get("INGESTION_QUIET_PERIOD_SEC", "300"))
MAX_WAIT_SEC = float(os.environ.get("INGESTION_MAX_WAIT_SEC", "900"))
STABILITY_DELAY_SEC = float(os.environ.get("FILE_STABILITY_DELAY_SEC", "10"))
DEFAULT_TAGS = [t.strip() for t in os.environ.get("DEFAULT_TAGS", "needs-review,watch-import").split(",") if t.strip()]

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp"}


class DebounceBatchQueue:
    """Thread-safe batch queue with quiet-period debounce and max-wait ceiling."""

    def __init__(self, quiet_period: float, max_wait: float):
        self.quiet_period = quiet_period
        self.max_wait = max_wait
        self.pending_files: Set[Path] = set()
        self.first_event_at: Optional[float] = None
        self.last_event_at: Optional[float] = None
        self.lock = threading.Lock()

    def add(self, path: Path):
        with self.lock:
            now = time.time()
            if not self.pending_files:
                self.first_event_at = now
            self.last_event_at = now
            self.pending_files.add(path)
            logger.info("Queued file: %s (Total pending: %d)", path.name, len(self.pending_files))

    def should_process(self) -> bool:
        with self.lock:
            if not self.pending_files or self.last_event_at is None or self.first_event_at is None:
                return False
            now = time.time()
            quiet_exceeded = (now - self.last_event_at) >= self.quiet_period
            max_wait_exceeded = (now - self.first_event_at) >= self.max_wait
            return quiet_exceeded or max_wait_exceeded

    def pop_batch(self) -> list[Path]:
        with self.lock:
            batch = sorted(list(self.pending_files))
            self.pending_files.clear()
            self.first_event_at = None
            self.last_event_at = None
            return batch


class WatchHandler(FileSystemEventHandler):
    """Watches for new and modified image files."""

    def __init__(self, queue: DebounceBatchQueue):
        super().__init__()
        self.queue = queue

    def on_created(self, event):
        if not event.is_directory:
            self._handle_path(Path(event.src_path))

    def on_modified(self, event):
        if not event.is_directory:
            self._handle_path(Path(event.src_path))

    def _handle_path(self, path: Path):
        # Ignore hidden files, temporary files, and internal subdirectories
        if path.name.startswith(".") or ".tmp" in path.name.lower():
            return
        for parent in path.parents:
            if parent.name.startswith("."):
                return
        if path.suffix.lower() in SUPPORTED_EXTENSIONS:
            self.queue.add(path)


def verify_and_prepare_image(path: Path) -> tuple[bytes, str]:
    """
    Verifies image integrity and converts HEIC to standard JPEG.
    Returns (image_bytes, format_ext).
    """
    with Image.open(path) as img:
        img.verify()

    with Image.open(path) as img:
        # Convert RGBA / P / CMYK to RGB for consistent YOLO & LLM compatibility
        if img.mode in ("RGBA", "P", "LA", "CMYK"):
            img = img.convert("RGB")
        out_buf = io.BytesIO()
        img.save(out_buf, format="JPEG", quality=95)
        return out_buf.getvalue(), "jpg"


def wait_for_file_stability(path: Path, delay: float = STABILITY_DELAY_SEC) -> bool:
    """Ensures file transfer has finished by checking size stability."""
    if not path.exists():
        return False
    size_initial = path.stat().st_size
    time.sleep(delay)
    if not path.exists():
        return False
    size_final = path.stat().st_size
    return size_initial > 0 and size_initial == size_final


def process_single_image(client: httpx.Client, file_path: Path, processed_dir: Path, failed_dir: Path):
    """Processes a single image file through PartLens API."""
    logger.info("Processing file: %s", file_path.name)
    try:
        if not wait_for_file_stability(file_path):
            raise ValueError(f"File {file_path.name} is not stable or was removed during transfer.")

        image_bytes, ext = verify_and_prepare_image(file_path)
        image_b64 = f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode('utf-8')}"

        # 1. Call Auto-Label endpoint
        logger.info("Invoking Auto-Label for %s...", file_path.name)
        autolabel_resp = client.post(
            f"{API_BASE_URL}/api/auto-label",
            json={
                "image_base64": image_b64,
                "enable_footprint": True,
                "enable_subgroup": True
            },
            timeout=180.0
        )
        if autolabel_resp.status_code != 200:
            raise RuntimeError(f"Auto-Label API error HTTP {autolabel_resp.status_code}: {autolabel_resp.text}")

        autolabel_data = autolabel_resp.json()
        components = autolabel_data.get("components", [])
        suggested_split = autolabel_data.get("suggested_split", "train")
        logger.info(
            "Auto-Label completed for %s: %d components, suggested split: %s",
            file_path.name, len(components), suggested_split
        )

        # 2. Save sample with needs-review tag into dataset
        save_payload = {
            "image_base64": image_b64,
            "boxes": components,
            "split": suggested_split if suggested_split in ("train", "val") else "train",
            "tags": DEFAULT_TAGS
        }

        save_resp = client.post(
            f"{API_BASE_URL}/api/dataset/sample",
            json=save_payload,
            timeout=60.0
        )
        if save_resp.status_code != 200:
            raise RuntimeError(f"Dataset Save API error HTTP {save_resp.status_code}: {save_resp.text}")

        save_data = save_resp.json()
        sample_id = save_data.get("id", file_path.stem)
        logger.info("Successfully imported sample %s as %s", file_path.name, sample_id)

        # 3. Move original file to .processed/YYYY-MM/
        month_str = datetime.now().strftime("%Y-%m")
        target_dir = processed_dir / month_str
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / file_path.name
        if target_path.exists():
            target_path = target_dir / f"{file_path.stem}_{int(time.time())}{file_path.suffix}"
        shutil.move(str(file_path), str(target_path))
        logger.info("Moved processed file to %s", target_path)

    except Exception as exc:
        logger.error("Failed processing %s: %s", file_path.name, str(exc))
        try:
            failed_dir.mkdir(parents=True, exist_ok=True)
            target_failed = failed_dir / file_path.name
            if target_failed.exists():
                target_failed = failed_dir / f"{file_path.stem}_{int(time.time())}{file_path.suffix}"
            if file_path.exists():
                shutil.move(str(file_path), str(target_failed))
            err_file = failed_dir / f"{file_path.stem}.error.txt"
            err_file.write_text(f"Timestamp: {datetime.now().isoformat()}\nError: {str(exc)}\n", encoding="utf-8")
        except Exception as move_err:
            logger.error("Could not move failed file %s: %s", file_path.name, str(move_err))


def process_batch(batch: list[Path], processed_dir: Path, failed_dir: Path):
    """Processes a batch of files sequentially."""
    logger.info("=== Starting processing batch of %d files ===", len(batch))
    with httpx.Client(timeout=180.0) as client:
        for p in batch:
            if p.exists():
                process_single_image(client, p, processed_dir, failed_dir)
            else:
                logger.warning("File no longer exists: %s", p)
    logger.info("=== Finished processing batch ===")


def scan_existing_files(watch_dir: Path, queue: DebounceBatchQueue):
    """Scans for existing files on service startup."""
    count = 0
    for item in watch_dir.iterdir():
        if item.is_file() and not item.name.startswith(".") and item.suffix.lower() in SUPPORTED_EXTENSIONS:
            queue.add(item)
            count += 1
    if count > 0:
        logger.info("Enqueued %d pre-existing files found in watch folder.", count)


def main():
    logger.info("PartLens Ingestion Service starting up...")
    logger.info("Watch Directory: %s", WATCH_DIR)
    logger.info("API Base URL: %s", API_BASE_URL)
    logger.info("Debounce Quiet Period: %s seconds", QUIET_PERIOD_SEC)
    logger.info("Max Wait Ceiling: %s seconds", MAX_WAIT_SEC)
    logger.info("Stability Delay: %s seconds", STABILITY_DELAY_SEC)

    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    processed_dir = WATCH_DIR / ".processed"
    failed_dir = WATCH_DIR / ".failed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    failed_dir.mkdir(parents=True, exist_ok=True)

    queue = DebounceBatchQueue(quiet_period=QUIET_PERIOD_SEC, max_wait=MAX_WAIT_SEC)
    scan_existing_files(WATCH_DIR, queue)

    event_handler = WatchHandler(queue)
    observer = Observer()
    observer.schedule(event_handler, str(WATCH_DIR), recursive=False)
    observer.start()
    logger.info("Watchdog observer active. Listening for new files...")

    try:
        while True:
            time.sleep(1.0)
            if queue.should_process():
                batch = queue.pop_batch()
                if batch:
                    process_batch(batch, processed_dir, failed_dir)
    except KeyboardInterrupt:
        logger.info("Stopping observer...")
        observer.stop()
    observer.join()
    logger.info("PartLens Ingestion Service exited cleanly.")


if __name__ == "__main__":
    main()
