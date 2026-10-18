"""Модель оружейника Константина из листа «Пиксельный выживальщик в противогазе» (4×4 кадра).
Кадры приводятся к росту и точке опоры моделей героя; порядок кадров сохраняется (ряд × 4 + колонка).
Запуск: python tools/build_konst.py  (вызывается и из build_assets.py)
"""
import os, json
import numpy as np
from PIL import Image
import build_guns as BG

ROOT = BG.ROOT
OUT = BG.OUT


def build(manifest=None):
    a = np.array(Image.open(os.path.join(ROOT, "Пиксельный выживальщик в противогазе.png")).convert("RGBA"))
    a[a[:, :, 3] < 90, 3] = 0
    cells = BG.grid_frames(a, 4, 4)
    frames = [cells[(r, c)] for r in range(4) for c in range(4)]
    ref_h = BG.body_h(frames)
    # одна строка из 16 кадров
    sheet = BG.compose([frames], ref_h)
    # compose рисует 8 рядов — оставляем первый
    sheet = sheet.crop((0, 0, sheet.width, BG.FH))
    sheet.save(os.path.join(OUT, "konst.png"))
    if manifest is not None:
        manifest["npc_konst"] = {"src": "assets/chars/konst.png", "w": sheet.width, "h": sheet.height,
                                 "fw": BG.FW, "fh": BG.FH, "ax": BG.AX, "ay": BG.AY, "n": len(frames)}
    return len(frames)


if __name__ == "__main__":
    print(build())
