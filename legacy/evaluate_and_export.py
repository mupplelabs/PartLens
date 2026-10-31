from pathlib import Path
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
import torch
from PIL import Image
from transformers import (
    AutoImageProcessor,
    ViTForImageClassification,
    CLIPProcessor,
    CLIPModel,
)

WORKSPACE = Path(__file__).resolve().parent
STUDIES_DIR = WORKSPACE / "studies"
EXPORT_DIR = WORKSPACE / "models" / "electronic-components-onnx"

# Die echten Labels aus dem zugehörigen Datensatz qipchip31/electronic_components
ID2LABEL = {
    0: "resistor (Widerstand)",
    1: "capacitor (Kondensator)",
    2: "inductor (Spule/Induktivität)",
    3: "transistor (Transistor)",
}
LABEL2ID = {v: k for k, v in ID2LABEL.items()}


def evaluate_qipchip_model(images: dict[str, Image.Image]):
    print("=" * 70)
    print("1) Evaluierung: qipchip31/electronic-components-model (ViT Fine-Tune)")
    print("=" * 70)
    model_id = "qipchip31/electronic-components-model"
    base_processor_id = "google/vit-base-patch16-224"

    # Hinweis: Im Original-Repo fehlt die preprocessor_config.json, daher vom Basismodell laden
    processor = AutoImageProcessor.from_pretrained(base_processor_id)
    model = ViTForImageClassification.from_pretrained(
        model_id,
        id2label={str(k): v for k, v in ID2LABEL.items()},
        label2id={v: k for k, v in ID2LABEL.items()},
    )
    model.eval()

    for name, img in images.items():
        inputs = processor(images=img, return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits
            probs = torch.softmax(logits, dim=-1)[0]

        print(f"\nBild: {name} ({img.size[0]}x{img.size[1]})")
        sorted_indices = torch.argsort(probs, descending=True)
        for idx in sorted_indices:
            idx_int = int(idx.item())
            score = probs[idx_int].item() * 100
            print(f"  - {ID2LABEL[idx_int]:<32}: {score:6.2f}%")

    return model, processor


def evaluate_clip_zeroshot(images: dict[str, Image.Image]):
    print("\n" + "=" * 70)
    print("2) Vergleich: Zero-Shot Klassifizierung (openai/clip-vit-base-patch32)")
    print("   (Unterstützt beliebige Bauteil-Klassen inkl. ICs/Mikrochips, Dioden, LEDs)")
    print("=" * 70)
    clip_id = "openai/clip-vit-base-patch32"
    model = CLIPModel.from_pretrained(clip_id)
    processor = CLIPProcessor.from_pretrained(clip_id)
    model.eval()

    categories = [
        ("a black DIP integrated circuit microchip with metal pins", "IC / Mikrochip (DIP)"),
        ("an axial resistor with color bands", "Widerstand (Resistor)"),
        ("an electronic capacitor", "Kondensator (Capacitor)"),
        ("an electronic inductor coil", "Spule / Induktivität (Inductor)"),
        ("a three-pin electronic transistor", "Transistor"),
        ("a light emitting diode LED", "LED / Diode"),
        ("a rotary potentiometer", "Potentiometer"),
    ]
    prompts = [c[0] for c in categories]
    display_names = [c[1] for c in categories]

    for name, img in images.items():
        inputs = processor(text=prompts, images=img, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model(**inputs)
            probs = outputs.logits_per_image.softmax(dim=-1)[0]

        print(f"\nBild: {name}")
        sorted_indices = torch.argsort(probs, descending=True)
        for idx in sorted_indices[:5]:
            idx_int = int(idx.item())
            score = probs[idx_int].item() * 100
            print(f"  - {display_names[idx_int]:<32}: {score:6.2f}%")


def export_to_onnx_for_transformers_js(model, processor, images: dict[str, Image.Image]):
    print("\n" + "=" * 70)
    print("3) ONNX-Export & Quantisierung für Transformers.js (Browser / Variante A)")
    print("=" * 70)
    onnx_dir = EXPORT_DIR / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    # Speichere korrigierte config.json (mit echten Bauteil-Namen statt LABEL_0..3)
    # und die fehlende preprocessor_config.json im Zielordner
    model.config.id2label = {str(k): v for k, v in ID2LABEL.items()}
    model.config.label2id = {v: k for k, v in ID2LABEL.items()}
    model.config.save_pretrained(EXPORT_DIR)
    processor.save_pretrained(EXPORT_DIR)

    onnx_path = onnx_dir / "model.onnx"
    q8_path = onnx_dir / "model_quantized.onnx"

    if not onnx_path.exists():
        dummy_input = torch.randn(1, 3, 224, 224)
        torch.onnx.export(
            model,
            (dummy_input,),
            str(onnx_path),
            input_names=["pixel_values"],
            output_names=["logits"],
            dynamic_axes={
                "pixel_values": {0: "batch_size"},
                "logits": {0: "batch_size"},
            },
            opset_version=14,
            dynamo=False,
        )

    size_mb = onnx_path.stat().st_size / (1024 * 1024)
    print(f"FP32 ONNX-Modell:        {onnx_path} ({size_mb:.1f} MB)")

    quantize_dynamic(
        str(onnx_path),
        str(q8_path),
        weight_type=QuantType.QUInt8,
    )
    q8_size_mb = q8_path.stat().st_size / (1024 * 1024)
    print(f"Quantisiertes ONNX (Q8): {q8_path} ({q8_size_mb:.1f} MB)")

    # Verifiziere das quantisierte ONNX-Modell mit ONNX Runtime
    sess = ort.InferenceSession(str(q8_path))
    print("\nVerifikation des quantisierten ONNX-Modells (model_quantized.onnx):")
    for name, img in images.items():
        pv = processor(images=img, return_tensors="np")["pixel_values"]
        logits = sess.run(None, {"pixel_values": pv})[0][0]
        probs = np.exp(logits) / np.sum(np.exp(logits))
        top_idx = int(np.argmax(probs))
        print(f"  - {name}: {ID2LABEL[top_idx]} ({probs[top_idx]*100:.2f}%)")


def main():
    test_files = [
        STUDIES_DIR / "F0526717-01.webp",
        STUDIES_DIR / "IMG_2221.jpg",
    ]
    images = {}
    for p in test_files:
        if p.exists():
            images[p.name] = Image.open(p).convert("RGB")
        else:
            print(f"Warnung: {p} nicht gefunden.")

    model, processor = evaluate_qipchip_model(images)
    evaluate_clip_zeroshot(images)
    export_to_onnx_for_transformers_js(model, processor, images)


if __name__ == "__main__":
    main()
