"""Download optional CPU accelerator + the tiny VAD model; never sends audio."""
import os
from pathlib import Path
from urllib.request import urlretrieve
from faster_whisper.utils import download_model

root = Path(os.environ.get("MODEL_DIR", "models"))
root.mkdir(parents=True, exist_ok=True)
vad = root / "ggml-silero-v6.2.0.bin"
if not vad.exists():
    temporary = vad.with_suffix(".download")
    urlretrieve("https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin", temporary)
    temporary.replace(vad)
download_model("large-v3-turbo", output_dir=str(root / "faster-whisper-large-v3-turbo"))
print("Model akselerator CPU dan VAD siap. Model Whisper GGML lama tetap dipakai sebagai cadangan.")
