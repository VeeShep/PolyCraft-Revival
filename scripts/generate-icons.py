"""Convert the unmodified original hero badge; requires Pillow. Run from repo root."""
from pathlib import Path
from PIL import Image

source = Image.open("128.png").convert("RGBA")
assert source.size == (128, 128)
folder = Path("assets/offline-ui/icons")
(folder / "png").mkdir(parents=True, exist_ok=True)
sizes = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
for size in sizes:
    source.resize((size, size), Image.Resampling.LANCZOS).save(folder / "png" / f"{size}x{size}.png")
large = source.resize((1024, 1024), Image.Resampling.LANCZOS)
large.save(folder / "icon.icns")
large.save(folder / "icon.ico", sizes=[(s, s) for s in sizes if s <= 256])
for size in sizes:
    with Image.open(folder / "png" / f"{size}x{size}.png") as icon:
        assert icon.size == (size, size) and icon.mode == "RGBA"
with Image.open(folder / "icon.icns") as icon:
    assert icon.format == "ICNS" and icon.size == (1024, 1024)
with Image.open(folder / "icon.ico") as icon:
    assert icon.format == "ICO" and (256, 256) in icon.ico.sizes()
assert Image.open(folder / "png/128x128.png").tobytes() == source.tobytes()
print("Verified original hero badge: ICNS, ICO and Linux PNG sizes.")
