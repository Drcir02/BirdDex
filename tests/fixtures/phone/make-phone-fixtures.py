"""Writes the pictures a real phone produces and a desktop test would not think of (docs/notes/integration.md, section 7).

    .venv/bin/python tests/fixtures/phone/make-phone-fixtures.py

  iphone-portrait-12mp-exif6.jpg  4032x3024 pixels stored, EXIF orientation 6: a portrait shot (3024 wide, 4032 tall when upright)
                                  of the Mallard, the way an upright iPhone stores it. 12.2 megapixels.
  phone-upside-down-exif3.jpg     1200x900 stored turned by 180 degrees, EXIF orientation 3 (the Common Kingfisher).
  phone-portrait-exif8.jpg        stored 900 wide x 1200 tall, EXIF orientation 8; upright it is 1200 wide x 900 tall (the Mallard,
                                  a phone held on its other side).
  kingfisher.png                  the Common Kingfisher as a PNG (screenshots and some galleries).
  tiny.jpg                        a 12x9 picture.
  truncated.jpg                   a real JPEG cut off after a third of its bytes (a download that stopped).

The expected upright shape of each is in tests/e2e/flows.spec.ts.
"""
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
PHOTOS = HERE.parents[0] / 'photos'


def exif(orientation: int) -> Image.Exif:
    tags = Image.Exif()
    tags[0x0112] = orientation
    return tags


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    return ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS)


mallard = Image.open(PHOTOS / 'Mallard_drake_on_Union_Bay_Natural_Area.jpg').convert('RGB')
kingfisher = Image.open(PHOTOS / 'Common_kingfisher_at_Taipei_Zoo.jpg').convert('RGB')

# Upright portrait 3024x4032. The stored pixels are that picture turned 90 degrees counter-clockwise (orientation 6 says:
# turn it clockwise to show it).
upright = cover(mallard, 3024, 4032)
upright.rotate(90, expand=True).save(HERE / 'iphone-portrait-12mp-exif6.jpg', quality=80, exif=exif(6))

# Orientation 3: stored turned by 180 degrees.
cover(kingfisher, 1200, 900).rotate(180).save(HERE / 'phone-upside-down-exif3.jpg', quality=88, exif=exif(3))

# Orientation 8: stored turned 90 degrees clockwise (the camera held with the right side down); upright it is 1200x900.
cover(mallard, 1200, 900).rotate(-90, expand=True).save(HERE / 'phone-portrait-exif8.jpg', quality=88, exif=exif(8))

kingfisher.resize((640, round(640 * kingfisher.height / kingfisher.width)), Image.Resampling.LANCZOS).save(HERE / 'kingfisher.png', optimize=True)
cover(mallard, 12, 9).save(HERE / 'tiny.jpg', quality=90)

whole = (PHOTOS / 'Common_goldeneye_at_Discovery_Park_Seattle.jpg').read_bytes()
(HERE / 'truncated.jpg').write_bytes(whole[: len(whole) // 3])

for path in sorted(HERE.glob('*.[jp][pn]g')):
    with Image.open(path) as image:
        print(f'{path.name:34} {image.size[0]}x{image.size[1]} {path.stat().st_size / 1024:.0f} KB exif={image.getexif().get(0x0112)}')
