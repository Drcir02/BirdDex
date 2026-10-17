#!/usr/bin/env python3
"""Writes tests/fixtures/audio/golden.json: what BirdNET V2.4 says about windows of the test recordings.

The browser test (tests/e2e/sound-engine.spec.ts) runs the same windows through LiteRT.js in Chromium and compares the
scores with these numbers, so a difference between Python and the browser shows up as a failing test.

For every window the file holds the top 5 outputs (index and score) of the FP16 model (the one the app ships) and of the
FP32 model (for comparison only). Scores are the model's logits through a sigmoid, exactly like BirdNET Analyzer
(model.flat_sigmoid with sensitivity 1.0: 1 / (1 + exp(-clip(x, -15, 15)))). The audio goes in unchanged: 3 seconds of
48 kHz mono, floats between -1 and 1, no other preprocessing (the model computes its own spectrogram).

A second file, golden-demo-full.json, keeps all 6522 FP16 scores of the demo recording, so the browser test can also
compare the whole output and report the real maximum difference.

The same file also holds what BirdNET's location model (FP16) says for a few places and weeks (key "geo"), including how
many birds of the Dex it expects there (score of at least 0.03, BirdNET Analyzer's default), so the browser test can
check the location filter too. golden-geo-full.json has all 6522 values for the first place.

Run:  .venv/bin/python scripts/make-audio-golden.py
Needs public/models/birdnet-v2.4-fp16.tflite and birdnet-v2.4-fp32.tflite (npm run fetch-models -- --with-fp32).
"""

from __future__ import annotations

import hashlib
import json
import sys
import wave
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "tests" / "fixtures" / "audio"
MODELS = ROOT / "public" / "models"
LABELS = ROOT / "data" / "birdnet-v2.4" / "labels_en.txt"

SAMPLE_RATE = 48000
WINDOW_SECONDS = 3
WINDOW = SAMPLE_RATE * WINDOW_SECONDS
TOP = 5
# Windows start every second, like the app's live analysis does.
HOP_SECONDS = 1

FILES = ["birdnet-demo-sample.wav", "soundscape-24s.wav"]

GEO_THRESHOLD = 0.03
# Rounded to 0.1 degrees like the app does before it asks the model. The week is BirdNET's 1 to 48.
GEO_PLACES = [
    ("Prague, week 20", 50.1, 14.4, 20),
    ("Prague, week 2", 50.1, 14.4, 2),
    ("Paris, week 30", 48.9, 2.4, 30),
    ("Sydney, week 10", -33.9, 151.2, 10),
    ("New York, week 20", 40.7, -74.0, 20),
    ("Mid Atlantic, week 24", 0.0, -30.0, 24),
]
# Outputs whose location scores are always stored: Lesser Redpoll (the demo recording) and Black-capped Chickadee (the soundscape).
GEO_WATCH = {"Acanthis cabaret": 6, "Poecile atricapillus": 4771}


def read_wav(path: Path) -> np.ndarray:
    """16-bit mono 48 kHz WAV to float32 in [-1, 1) (what librosa/soundfile give for a 48 kHz file)."""
    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != SAMPLE_RATE:
            raise SystemExit(f"{path.name}: expected 16-bit mono 48 kHz, got {wav.getparams()}")
        raw = wav.readframes(wav.getnframes())
    return (np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0).astype(np.float32)


def sigmoid(logits: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(logits, -15, 15)))


class Model:
    def __init__(self, path: Path) -> None:
        self.interpreter = Interpreter(model_path=str(path), num_threads=2)
        self.interpreter.allocate_tensors()
        self.input = self.interpreter.get_input_details()[0]
        self.output = self.interpreter.get_output_details()[0]
        if list(self.input["shape"]) != [1, WINDOW]:
            raise SystemExit(f"{path.name}: unexpected input shape {self.input['shape']}")

    def scores(self, window: np.ndarray) -> np.ndarray:
        self.interpreter.set_tensor(self.input["index"], window.reshape(1, WINDOW).astype(np.float32))
        self.interpreter.invoke()
        return sigmoid(self.interpreter.get_tensor(self.output["index"])[0].astype(np.float64))


class GeoModel:
    def __init__(self, path: Path) -> None:
        self.interpreter = Interpreter(model_path=str(path), num_threads=2)
        self.interpreter.allocate_tensors()
        self.input = self.interpreter.get_input_details()[0]
        self.output = self.interpreter.get_output_details()[0]
        if list(self.input["shape"]) != [1, 3]:
            raise SystemExit(f"{path.name}: unexpected input shape {self.input['shape']}")

    def scores(self, lat: float, lon: float, week: int) -> np.ndarray:
        self.interpreter.set_tensor(self.input["index"], np.array([[lat, lon, week]], dtype=np.float32))
        self.interpreter.invoke()
        return self.interpreter.get_tensor(self.output["index"])[0].astype(np.float64)


def top(scores: np.ndarray, labels: list[str]) -> list[dict[str, object]]:
    order = np.argsort(-scores, kind="stable")[:TOP]
    return [{"index": int(i), "label": labels[i], "score": round(float(scores[i]), 6)} for i in order]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    fp16_path = MODELS / "birdnet-v2.4-fp16.tflite"
    fp32_path = MODELS / "birdnet-v2.4-fp32.tflite"
    for path in (fp16_path, fp32_path, LABELS):
        if not path.exists():
            raise SystemExit(f"missing {path}")

    labels = LABELS.read_text(encoding="utf-8").split("\n")
    if len(labels) != 6522:
        raise SystemExit(f"expected 6522 labels, got {len(labels)}")

    fp16 = Model(fp16_path)
    fp32 = Model(fp32_path)

    golden: dict[str, object] = {
        "about": "BirdNET V2.4 top 5 per window, made by scripts/make-audio-golden.py with ai-edge-litert in Python. "
        "Scores are sigmoid(clip(logit, -15, 15)). Do not edit by hand.",
        "sampleRate": SAMPLE_RATE,
        "windowSeconds": WINDOW_SECONDS,
        "models": {
            "fp16": {"file": fp16_path.name, "sha256": sha256(fp16_path)},
            "fp32": {"file": fp32_path.name, "sha256": sha256(fp32_path)},
        },
        "files": {},
    }
    files: dict[str, object] = golden["files"]  # type: ignore[assignment]

    max_fp_diff = 0.0
    for name in FILES:
        signal = read_wav(AUDIO / name)
        seconds = len(signal) / SAMPLE_RATE
        windows = []
        start = 0
        while start + WINDOW <= len(signal):
            chunk = signal[start : start + WINDOW]
            s16 = fp16.scores(chunk)
            s32 = fp32.scores(chunk)
            max_fp_diff = max(max_fp_diff, float(np.max(np.abs(s16 - s32))))
            windows.append({"startS": start // SAMPLE_RATE, "fp16": top(s16, labels), "fp32": top(s32, labels)})
            if name == "birdnet-demo-sample.wav" and start == 0:
                full = {
                    "about": "All 6522 FP16 scores (sigmoid) of the whole demo recording, rounded to 5 decimals.",
                    "file": name,
                    "scores": [round(float(v), 5) for v in s16],
                }
                (AUDIO / "golden-demo-full.json").write_text(json.dumps(full, separators=(",", ":")) + "\n", encoding="utf-8")
            start += HOP_SECONDS * SAMPLE_RATE
        files[name] = {"seconds": round(seconds, 3), "windows": windows}
        first = windows[0]["fp16"][0]  # type: ignore[index]
        print(f"{name}: {seconds:.1f} s, {len(windows)} windows, first window top-1 {first['label']} {first['score']:.4f}")

    # ----- The location model -----
    geo_path = MODELS / "birdnet-v2.4-geo-fp16.tflite"
    species_path = ROOT / "public" / "data" / "species.json"
    if geo_path.exists() and species_path.exists():
        geo_model = GeoModel(geo_path)
        dex = np.array(sorted(item["birdnetIndex"] for item in json.loads(species_path.read_text(encoding="utf-8"))))
        places = []
        for name, lat, lon, week in GEO_PLACES:
            values = geo_model.scores(lat, lon, week)
            order = np.argsort(-values, kind="stable")[:10]
            places.append(
                {
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "week": week,
                    "countAboveThreshold": int(np.sum(values >= GEO_THRESHOLD)),
                    "dexCountAboveThreshold": int(np.sum(values[dex] >= GEO_THRESHOLD)),
                    "watch": {label: round(float(values[index]), 6) for label, index in GEO_WATCH.items()},
                    "top": [{"index": int(i), "label": labels[i], "score": round(float(values[i]), 6)} for i in order],
                }
            )
            if name == GEO_PLACES[0][0]:
                full_geo = {"about": f"All 6522 location scores for {name}.", "scores": [round(float(v), 5) for v in values]}
                (AUDIO / "golden-geo-full.json").write_text(json.dumps(full_geo, separators=(",", ":")) + "\n", encoding="utf-8")
        golden["geo"] = {
            "model": {"file": geo_path.name, "sha256": sha256(geo_path)},
            "threshold": GEO_THRESHOLD,
            "places": places,
        }
        print("geo: " + "; ".join(f"{p['name']} {p['dexCountAboveThreshold']} Dex birds" for p in places))
    else:
        print("geo: skipped (needs the location model and public/data/species.json)")

    golden["maxFp16VsFp32AbsDifference"] = round(max_fp_diff, 6)
    (AUDIO / "golden.json").write_text(json.dumps(golden, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {AUDIO / 'golden.json'} (largest FP16 vs FP32 score difference over all outputs: {max_fp_diff:.4f})")


if __name__ == "__main__":
    sys.exit(main())
