"""Разбитые «Жигули» для стартовой локации — из листа «Ржавый советский седан — спрайт-лист» (4 ракурса).
Берём изометрический вид спереди-слева и вид сзади-справа, масштаб — под рост героя (~88 px).
Запуск: python tools/build_car.py  (вызывается и из build_assets.py)
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "game", "assets", "sprites")
SCALE = 0.29  # седан ~1,45 м против героя 1,75 м: крыша на уровне плеч персонажа


def build(manifest=None):
    a = np.array(Image.open(os.path.join(ROOT, "Ржавый советский седан — спрайт-лист.png")).convert("RGBA"))
    a[a[:, :, 3] < 60, 3] = 0
    lab, _ = ndimage.label(ndimage.binary_dilation(a[:, :, 3] > 0, iterations=2))
    h, w = a.shape[:2]
    out = {}
    for name, (qx, qy) in {"lada_wreck": (0, 0), "lada_wreck_back": (1, 0)}.items():
        sub = lab[qy * h // 2:(qy + 1) * h // 2, qx * w // 2:(qx + 1) * w // 2]
        ids, cnt = np.unique(sub[sub > 0], return_counts=True)
        main = ids[np.argmax(cnt)]
        ys, xs = np.nonzero(lab == main)
        fr = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
        fr[lab[ys.min():ys.max() + 1, xs.min():xs.max() + 1] != main, 3] = 0
        im = Image.fromarray(fr)
        im = im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)
        im.save(os.path.join(OUT, name + ".png"))
        out[name] = im.size
        if manifest is not None:
            manifest[name] = {"src": f"assets/sprites/{name}.png", "w": im.width, "h": im.height}
    return out


if __name__ == "__main__":
    print(build())
