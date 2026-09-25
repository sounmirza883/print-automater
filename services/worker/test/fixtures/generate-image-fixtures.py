"""One-time generator for the 21.9 image fixtures, run manually (not part
of the build or test pipeline). Small real images: an RGB baseline JPEG,
a CMYK JPEG, an RGB PNG and an RGBA PNG.
"""

from PIL import Image

img = Image.new("RGB", (60, 40))
px = img.load()
for x in range(60):
    for y in range(40):
        px[x, y] = (x * 4, y * 6, 128)
img.save("sample.jpg", "JPEG", quality=80)
img.convert("CMYK").save("sample-cmyk.jpg", "JPEG", quality=80)
img.save("sample.png", "PNG")
img.convert("RGBA").save("sample-alpha.png", "PNG")
print("Generated image fixtures")

# EXIF orientation 6 ("rotate 90 CW to display"): a phone photo taken in
# portrait. Stored 60x40, displayed 40x60.
exif = Image.Exif()
exif[0x0112] = 6
img.save("sample-orient6.jpg", "JPEG", quality=80, exif=exif)
print("Generated orientation fixture")
