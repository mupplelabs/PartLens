from pathlib import Path
import gradio as gr
import torch
from PIL import Image
from transformers import (
    AutoImageProcessor,
    CLIPModel,
    CLIPProcessor,
    ViTForImageClassification,
)

WORKSPACE = Path(__file__).resolve().parent
STUDIES_DIR = WORKSPACE / "studies"

# 1. Konfiguration für qipchip31/electronic-components-model (4 feste Klassen)
QIPCHIP_MODEL_ID = "qipchip31/electronic-components-model"
QIPCHIP_PROCESSOR_ID = "google/vit-base-patch16-224"
QIPCHIP_ID2LABEL = {
    0: "Widerstand (Resistor)",
    1: "Kondensator (Capacitor)",
    2: "Spule / Induktivität (Inductor)",
    3: "Transistor",
}

# 2. Konfiguration für CLIP Zero-Shot (beliebig erweiterbare Bauteilklassen)
CLIP_MODEL_ID = "openai/clip-vit-base-patch32"
DEFAULT_CLIP_CATEGORIES = {
    "IC / Mikrochip (DIP / SMD)": "a black DIP integrated circuit microchip with metal pins",
    "Widerstand (Resistor)": "an axial electronic resistor with color bands",
    "Kondensator (Capacitor)": "an electronic capacitor component",
    "Spule / Induktivität (Inductor)": "an electronic inductor coil with copper wire",
    "Transistor": "a three-pin electronic transistor",
    "LED / Diode": "a light emitting diode LED",
    "Potentiometer": "a rotary potentiometer",
}

_models = {}


def get_qipchip():
    if "qipchip" not in _models:
        processor = AutoImageProcessor.from_pretrained(QIPCHIP_PROCESSOR_ID)
        model = ViTForImageClassification.from_pretrained(QIPCHIP_MODEL_ID)
        model.eval()
        _models["qipchip"] = (model, processor)
    return _models["qipchip"]


def get_clip():
    if "clip" not in _models:
        processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
        model = CLIPModel.from_pretrained(CLIP_MODEL_ID)
        model.eval()
        _models["clip"] = (model, processor)
    return _models["clip"]


def classify_component(
    image: Image.Image | None,
    model_choice: str,
    custom_labels_str: str,
) -> dict[str, float]:
    if image is None:
        return {}

    img = image.convert("RGB")

    if model_choice.startswith("CLIP Zero-Shot"):
        model, processor = get_clip()
        categories = dict(DEFAULT_CLIP_CATEGORIES)

        if custom_labels_str and custom_labels_str.strip():
            for raw_label in custom_labels_str.split(","):
                clean = raw_label.strip()
                if clean and clean not in categories:
                    categories[clean] = f"a close-up photo of an electronic {clean}"

        display_names = list(categories.keys())
        prompts = list(categories.values())

        inputs = processor(text=prompts, images=img, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model(**inputs)
            probs = outputs.logits_per_image.softmax(dim=-1)[0]

        return {
            display_names[i]: float(probs[i].item())
            for i in range(len(display_names))
        }

    model, processor = get_qipchip()
    inputs = processor(images=img, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
        probs = torch.softmax(logits, dim=-1)[0]

    return {
        QIPCHIP_ID2LABEL[i]: float(probs[i].item())
        for i in range(len(QIPCHIP_ID2LABEL))
    }


example_images = []
for filename in ["F0526717-01.webp", "IMG_2221.jpg"]:
    candidate = STUDIES_DIR / filename
    if candidate.exists():
        example_images.append([str(candidate)])


with gr.Blocks(title="ComponentTracker – Elektronische Bauteile Erkennung") as demo:
    gr.Markdown(
        """
        # 🔎 ComponentTracker – Elektronische Bauteile Erkennung (Gradio / Hugging Face Space)
        Halte ein elektronisches Bauteil vor die **Webcam / Smartphone-Kamera** oder lade ein **Foto** hoch.
        """
    )

    with gr.Row():
        with gr.Column(scale=1):
            image_input = gr.Image(
                label="Kamera oder Bild-Upload",
                sources=["webcam", "upload", "clipboard"],
                type="pil",
                webcam_options=gr.WebcamOptions(mirror=False),
            )
            model_selector = gr.Radio(
                choices=[
                    "CLIP Zero-Shot (inkl. ICs, Dioden, LEDs, frei erweiterbar)",
                    "qipchip31/electronic-components-model (4 Klassen: R, C, L, Transistor)",
                ],
                value="CLIP Zero-Shot (inkl. ICs, Dioden, LEDs, frei erweiterbar)",
                label="KI-Modell auswählen",
            )
            custom_labels = gr.Textbox(
                label="Zusätzliche Bauteil-Klassen für CLIP (optional, kommagetrennt)",
                placeholder="z.B. SMD resistor, crystal oscillator, fuse, Arduino",
            )
            submit_btn = gr.Button("🔍 Bauteil klassifizieren", variant="primary")

        with gr.Column(scale=1):
            label_output = gr.Label(
                num_top_classes=5,
                label="Ergebnis & Wahrscheinlichkeiten",
            )

    if example_images:
        gr.Examples(
            examples=example_images,
            inputs=[image_input],
            label="Testbilder aus studies/",
        )

    submit_btn.click(
        fn=classify_component,
        inputs=[image_input, model_selector, custom_labels],
        outputs=label_output,
    )
    image_input.change(
        fn=classify_component,
        inputs=[image_input, model_selector, custom_labels],
        outputs=label_output,
    )
    model_selector.change(
        fn=classify_component,
        inputs=[image_input, model_selector, custom_labels],
        outputs=label_output,
    )


if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", server_port=7860)
