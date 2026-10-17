"""Writes mallard-exif-rotated.jpg: the Mallard fixture photo stored turned by 90 degrees, with the EXIF orientation 6
("turn it clockwise to show it"), the way a phone held upright stores its pictures. Every browser shows it upright, and so
must the engine: the end-to-end test checks that the picture the model sees is landscape and still a Mallard.

    .venv/bin/python tests/fixtures/vision/make-exif-fixture.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
source = Image.open(HERE.parents[1] / 'fixtures' / 'photos' / 'Mallard_drake_on_Union_Bay_Natural_Area.jpg')
exif = Image.Exif()
exif[0x0112] = 6
source.rotate(90, expand=True).save(HERE / 'mallard-exif-rotated.jpg', quality=90, exif=exif)
print('wrote', HERE / 'mallard-exif-rotated.jpg')
