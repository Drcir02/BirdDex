"""Writes reference-embeddings.json: what the int8 WingCLIP model makes of the fixture photos in Python (Pillow for
decoding and resizing, onnxruntime for the model), independent of our TypeScript. The end-to-end test compares the
embeddings from the browser with these; the rest is documentation (the best species over all 10994 rows and over the Dex).

Needs the models in public/models. Run it again only if the photos, the models or the recipe change:

    .venv/bin/python tests/fixtures/vision/make-reference-embeddings.py
"""
import importlib.util
import json
import sys

sys.dont_write_bytecode = True  # importing the other script must not leave a __pycache__ folder next to it
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MODELS = ROOT / 'public' / 'models'
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

# The probe calibration from WingDex (src/lib/bird-id-local-adapter.ts); the same numbers as src/ml/vision/constants.ts.
BIAS, PLATT_A, PLATT_B = 1.7004907607405835, 1.248338657716024, 2.1821600341974303
TEMPERATURE = 0.007435


def load_vectors_module():
    spec = importlib.util.spec_from_file_location('make_preprocess_vectors', HERE / 'make-preprocess-vectors.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tensor_of(picture: Image.Image) -> np.ndarray:
    picture = picture.convert('RGB')
    w, h = picture.size
    nw, nh = (248, int(248 * h // w)) if w <= h else (int(248 * w // h), 248)
    picture = picture.resize((nw, nh), Image.BICUBIC)
    left, top = int(round((nw - 224) / 2.0)), int(round((nh - 224) / 2.0))
    crop = np.asarray(picture.crop((left, top, left + 224, top + 224)), dtype=np.float32) / np.float32(255)
    return np.ascontiguousarray(((crop - MEAN) / STD).transpose(2, 0, 1))[None].astype(np.float32)


def decode_classifier(path: Path):
    raw = path.read_bytes()
    dim = 768
    n = len(raw) // (dim + 4)
    assert n * (dim + 4) == len(raw)
    q = np.frombuffer(raw, dtype=np.int8, count=n * dim).reshape(n, dim)
    scales = np.frombuffer(raw, dtype=np.float32, count=n, offset=n * dim)
    rows = q.astype(np.float32) * scales[:, None]
    return rows[:-1], rows[-1]


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def logit(p):
    p = min(max(p, 1e-7), 1 - 1e-7)
    return float(np.log(p / (1 - p)))


def main() -> None:
    vectors = load_vectors_module()
    species_rows, probe = decode_classifier(MODELS / 'text_classifier_int8.bin')
    species = json.loads((ROOT / 'public' / 'data' / 'species.json').read_text())
    taxonomy = json.loads(Path('/home/user/birdnet-team/wingdex/src/lib/taxonomy.json').read_text())
    dex_rows = np.array([s['wingclipIndex'] for s in species if s['wingclipIndex'] is not None])
    truth = json.loads((ROOT / 'tests/fixtures/photos/truth.json').read_text())
    session = ort.InferenceSession(str(MODELS / 'wingclip_visual_int8.onnx'), providers=['CPUExecutionProvider'])
    name = session.get_inputs()[0].name

    def embed(tensor: np.ndarray) -> np.ndarray:
        return session.run(None, {name: tensor})[0][0]

    def summary(emb: np.ndarray) -> dict:
        n = np.linalg.norm(emb)
        sims = species_rows @ emb / n
        p_raw = float(sigmoid(float(probe @ emb / n) + BIAS))
        p_bird = float(sigmoid(PLATT_A * logit(p_raw) + PLATT_B))
        full = np.argsort(-sims)[:3]
        dex = dex_rows[np.argsort(-sims[dex_rows])[:3]]
        return {
            'pBird': round(p_bird, 4),
            'fullTop3': [[taxonomy[int(r)][0], round(float(sims[r]), 4)] for r in full],
            'dexTop3': [[taxonomy[int(r)][0], round(float(sims[r]), 4)] for r in dex],
        }

    out = {'photos': {}, 'synthetic': {}}
    for path in sorted((ROOT / 'tests/fixtures/photos').glob('*.jpg')):
        emb = embed(tensor_of(Image.open(path)))
        out['photos'][path.name] = {'truth': truth.get(path.name), **summary(emb), 'embedding': [round(float(v), 5) for v in emb]}
        print(path.name, out['photos'][path.name]['dexTop3'][0])
    for case_name, w, h, seed, _why in vectors.CASES[:3]:
        emb = embed(tensor_of(Image.fromarray(vectors.synth(w, h, seed), 'RGB')))
        out['synthetic'][case_name] = {'width': w, 'height': h, 'seed': seed, 'embedding': [round(float(v), 5) for v in emb]}
    (HERE / 'reference-embeddings.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print('wrote', HERE / 'reference-embeddings.json', (HERE / 'reference-embeddings.json').stat().st_size, 'bytes')


if __name__ == '__main__':
    sys.exit(main())
