"""Нарезка спрайт-листов на отдельные спрайты по альфа-каналу.
Запуск:  python tools/extract_sprites.py <out_dir> [contact_dir]
Создаёт <out_dir>/<sheet>_<NN>.png и index.json с размерами.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = {
    "military": "8da839eb-17a4-49b9-ba3a-35153d59af41.png",
    "camp": "postapocalyptic_camp_transparent.png",
    "market": "postapocalyptic_market_transparent.png",
    "veg": "age_of_caravans_vegetation_transparent.png",
    "power": "Пиксельный набор промышленных электросетей.png",
    "objects": "Постапокалиптический изометрический набор объектов.png",
    "industry": "Промышленные руины_ изометрический набор ассетов.png",
}
MIN_AREA = 900

def extract(key, fname, out, contact):
    im = Image.open(os.path.join(ROOT, fname)).convert("RGBA")
    a = np.array(im)
    alpha = a[:, :, 3]
    # подчищаем остатки «шахматки» (почти белые полупрозрачные пиксели)
    rgb = a[:, :, :3].astype(int)
    whiteish = (rgb.min(axis=2) > 225) & (rgb.max(axis=2) - rgb.min(axis=2) < 12)
    a[whiteish, 3] = 0
    mask = a[:, :, 3] > 200
    grown = ndimage.binary_dilation(ndimage.binary_opening(mask, iterations=1), iterations=2)
    lab, n = ndimage.label(grown)
    boxes = ndimage.find_objects(lab)
    res = []
    for i, sl in enumerate(boxes):
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        region = (lab[sl] == i + 1) & mask[sl]
        if region.sum() < MIN_AREA:
            continue
        crop = a[sl].copy()
        crop[~ndimage.binary_dilation(region, iterations=2), 3] = 0
        res.append((xs.start, ys.start, w, h, crop))
    res.sort(key=lambda r: (r[1] // 120, r[0]))
    meta = {}
    sheet = Image.new("RGB", im.size, (255, 0, 255))
    sheet.paste(im, (0, 0), im)
    d = ImageDraw.Draw(sheet)
    for k, (x, y, w, h, crop) in enumerate(res):
        name = f"{key}_{k:02d}"
        Image.fromarray(crop).save(os.path.join(out, name + ".png"))
        meta[name] = {"w": w, "h": h, "x": x, "y": y}
        d.rectangle([x, y, x + w, y + h], outline=(0, 255, 0), width=2)
        d.rectangle([x, y, x + 34, y + 20], fill=(0, 0, 0))
        d.text((x + 3, y + 3), str(k), fill=(255, 255, 0))
    if contact:
        sheet.resize((im.width * 2 // 3, im.height * 2 // 3)).save(os.path.join(contact, key + ".jpg"), quality=85)
    return meta

if __name__ == "__main__":
    out = sys.argv[1]
    contact = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(out, exist_ok=True)
    allmeta = {}
    for k, f in SHEETS.items():
        m = extract(k, f, out, contact)
        print(k, len(m))
        allmeta.update(m)
    json.dump(allmeta, open(os.path.join(out, "index.json"), "w"), indent=1)
