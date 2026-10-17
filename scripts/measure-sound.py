#!/usr/bin/env python3
"""How BirdNET behaves on bird recordings, on noise and on other sounds: the numbers behind the catch thresholds.

For every sound it runs the shipped model (BirdNET V2.4 FP16, through ai-edge-litert) on 3 second windows, one per
second, keeps only the birds of the Dex (public/data/species.json, no location filter) and applies the same rules as
src/ml/sound/aggregate.ts: a bird counts when it is among the top 5 of a window with a score of at least 0.10 in two of
the last three windows, and its confidence is the mean of its two best windows (birds under 0.15 are not listed). The
result per sound is

  window  the highest score a Dex bird reached in any single window
  scan    the highest confidence any Dex bird reached in the whole scan (what the screen would show and the Catch
          button would look at)

Sounds shorter than 15 seconds are repeated (a fake microphone does the same) so that there are enough windows.

Run:  .venv/bin/python scripts/measure-sound.py            (prints Markdown tables)
      .venv/bin/python scripts/measure-sound.py --extra DIR  (also every .wav in DIR; LibreOffice's gallery by default)
"""

from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parent.parent
RATE = 48000
WINDOW = 3 * RATE
HOP = RATE
MIN_SECONDS = 15
LIBREOFFICE_SOUNDS = Path("/usr/lib/libreoffice/share/gallery/sounds")


class Model:
    def __init__(self) -> None:
        self.interpreter = Interpreter(model_path=str(ROOT / "public/models/birdnet-v2.4-fp16.tflite"), num_threads=2)
        self.interpreter.allocate_tensors()
        self.input = self.interpreter.get_input_details()[0]
        self.output = self.interpreter.get_output_details()[0]

    def scores(self, window: np.ndarray) -> np.ndarray:
        self.interpreter.set_tensor(self.input["index"], window.reshape(1, WINDOW).astype(np.float32))
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self.output["index"])[0].astype(np.float64)
        return 1.0 / (1.0 + np.exp(-np.clip(logits, -15, 15)))


def read_wav(path: Path) -> np.ndarray:
    """Any WAV the standard library can read, to mono float32 at 48 kHz (linear interpolation: good enough here)."""
    with wave.open(str(path), "rb") as wav:
        channels, width, rate, frames = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
        raw = wav.readframes(frames)
    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"{path.name}: {width * 8}-bit audio is not supported")
    data = data.reshape(-1, channels).mean(axis=1)
    if rate != RATE:
        target = int(round(len(data) * RATE / rate))
        data = np.interp(np.linspace(0, len(data) - 1, target), np.arange(len(data)), data).astype(np.float32)
    return data


def looped(signal: np.ndarray, seconds: int = MIN_SECONDS) -> np.ndarray:
    needed = seconds * RATE
    if len(signal) >= needed:
        return signal
    return np.tile(signal, int(np.ceil(needed / max(1, len(signal)))))[: max(needed, WINDOW)]


def analyse(model: Model, signal: np.ndarray, dex: np.ndarray, ids: dict[int, str]) -> dict[str, object]:
    """Per-window Dex tops and the tracker's best confidence, like ScanTracker in aggregate.ts."""
    signal = looped(signal)
    recent: list[list[tuple[str, float]]] = []
    best: dict[str, float] = {}
    top_window = 0.0
    top_window_id = ""
    top_all = 0.0
    top_all_index = -1
    windows = 0
    for start in range(0, len(signal) - WINDOW + 1, HOP):
        scores = model.scores(signal[start : start + WINDOW])
        windows += 1
        d = scores[dex]
        order = np.argsort(-d)[:5]
        top = [(ids[int(dex[i])], float(d[i])) for i in order]
        if top[0][1] > top_window:
            top_window, top_window_id = top[0][1], top[0][0]
        a = int(np.argmax(scores))
        if scores[a] > top_all:
            top_all, top_all_index = float(scores[a]), a
        recent.append(top)
        recent = recent[-3:]
        seen: dict[str, list[float]] = {}
        for window in recent:
            for species, score in window:
                if score >= 0.1:
                    seen.setdefault(species, []).append(score)
        for species, values in seen.items():
            if len(values) >= 2:
                values.sort(reverse=True)
                confidence = (values[0] + values[1]) / 2
                if confidence >= 0.15:
                    best[species] = max(best.get(species, 0.0), confidence)
    leader = max(best.items(), key=lambda item: item[1]) if best else ("-", 0.0)
    return {
        "windows": windows,
        "window": top_window,
        "window_id": top_window_id,
        "scan": leader[1],
        "scan_id": leader[0],
        "all": top_all,
        "all_index": top_all_index,
    }


def noise(kind: str, seconds: int, level: float, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = seconds * RATE
    if kind == "white":
        x = rng.standard_normal(n)
    elif kind == "pink":
        spectrum = np.fft.rfft(rng.standard_normal(n))
        spectrum /= np.sqrt(np.maximum(1, np.arange(len(spectrum))))
        x = np.fft.irfft(spectrum, n)
    elif kind == "brown":
        x = np.cumsum(rng.standard_normal(n))
        x -= np.linspace(x[0], x[-1], n)
    else:
        raise ValueError(kind)
    x = x / np.max(np.abs(x))
    return (x * level).astype(np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x))))


def mix(signal: np.ndarray, background: np.ndarray, snr_db: float) -> np.ndarray:
    """The signal with the background added at the given signal-to-noise ratio (by RMS)."""
    background = background[: len(signal)]
    wanted = rms(signal) / (10 ** (snr_db / 20))
    mixed = signal + background * (wanted / rms(background))
    return np.clip(mixed, -1, 1).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extra", type=Path, default=LIBREOFFICE_SOUNDS if LIBREOFFICE_SOUNDS.exists() else None)
    args = parser.parse_args()

    labels = (ROOT / "data/birdnet-v2.4/labels_en.txt").read_text(encoding="utf-8").split("\n")
    species = json.loads((ROOT / "public/data/species.json").read_text(encoding="utf-8"))
    dex = np.array(sorted(s["birdnetIndex"] for s in species))
    ids = {s["birdnetIndex"]: s["id"] for s in species}
    model = Model()

    def row(name: str, signal: np.ndarray) -> str:
        r = analyse(model, signal, dex, ids)
        top = labels[r["all_index"]].split("_")[-1] if r["all_index"] >= 0 else "-"
        return f"| {name} | {len(signal) / RATE:.1f} | {r['window']:.3f} ({r['window_id'] or '-'}) | {r['scan']:.3f} ({r['scan_id']}) | {top} {r['all']:.2f} |"

    header = "| sound | seconds | best Dex score in one window | best Dex confidence in the scan | strongest of all 6522 outputs |\n|---|---|---|---|---|"

    print("## Recordings of birds\n")
    print(header)
    demo = read_wav(ROOT / "tests/fixtures/audio/birdnet-demo-sample.wav")
    soundscape = read_wav(ROOT / "tests/fixtures/audio/soundscape-24s.wav")
    print(row("Lesser Redpoll (demo sample, repeated)", demo))
    print(row("North American soundscape (no European birds)", soundscape))

    print("\n## The Lesser Redpoll with less and less sound\n")
    print(header)
    for gain in (1.0, 0.3, 0.1, 0.03, 0.01):
        print(row(f"quieter: x{gain}", demo * gain))
    long_demo = looped(demo)
    for snr in (20, 10, 5, 0, -5):
        print(row(f"with white noise, signal-to-noise {snr:+d} dB", mix(long_demo, noise("white", MIN_SECONDS, 1.0), snr)))
    for snr in (10, 0):
        print(row(f"with pink (wind-like) noise, signal-to-noise {snr:+d} dB", mix(long_demo, noise("pink", MIN_SECONDS, 1.0), snr)))

    print("\n## Sounds that are not birds\n")
    print(header)
    print(row("digital silence", np.zeros(MIN_SECONDS * RATE, dtype=np.float32)))
    for kind in ("white", "pink", "brown"):
        for level in (0.01, 0.1, 0.5):
            print(row(f"{kind} noise, peak {level}", noise(kind, MIN_SECONDS, level)))
    t = np.arange(MIN_SECONDS * RATE) / RATE
    for frequency in (440, 3000, 6000):
        print(row(f"pure tone {frequency} Hz", (0.3 * np.sin(2 * np.pi * frequency * t)).astype(np.float32)))
    # A frequency that swings between 500 and 3500 Hz twice a second... once every two seconds, like a siren.
    swing = 0.5
    phase = 2 * np.pi * (2000 * t - 1500 / (2 * np.pi * swing) * np.cos(2 * np.pi * swing * t))
    print(row("siren-like sweep 500-3500 Hz", (0.3 * np.sin(phase)).astype(np.float32)))
    if args.extra and args.extra.exists():
        for path in sorted(args.extra.glob("*.wav")):
            try:
                print(row(f"{path.name} (LibreOffice gallery)", read_wav(path)))
            except Exception as error:  # a file the standard library cannot read
                print(f"| {path.name} | - | could not read: {error} | | |")


if __name__ == "__main__":
    main()
