"""Внешность героев на карте: перекраска моделей с оружием и без.
Противогаз снимается: капюшон/шлем → волосы, маска и очки → лицо. Одежда — в цвета героя.
Роза — чуть уже в плечах (женский силуэт) и с каре. Гоша остаётся в противогазе и разгрузке.
Запуск: python tools/build_heroes.py  (вызывается и из build_assets.py)
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = os.path.join(ROOT, "game", "assets", "chars")
SHEETS = {"soldier": (120, 110), "pl_pistol": (150, 112), "pl_rifle": (150, 112), "pl_ak": (150, 112)}
HEROES = {
    # волосы, кожа, верх одежды (цвет кожаной куртки/топа), низ; slim — сжатие по ширине; mask — снять противогаз
    "artyom": dict(hair=(70, 48, 30), skin=(214, 166, 130), top=(52, 40, 32), bottom=None, slim=1.0, mask=True, long=False),
    "roza": dict(hair=(38, 26, 20), skin=(226, 182, 150), top=(70, 98, 120), bottom=(48, 44, 40), slim=0.88, mask=True, long=True),
    "gosha": dict(hair=None, skin=None, top=(78, 74, 46), bottom=(60, 58, 40), slim=1.0, mask=False, long=False),
}


def hsv(rgb):
    r, g, b = [rgb[..., i].astype(float) / 255 for i in range(3)]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return mx, s


def tint(px, color, lum):
    """Перекраска с сохранением светотени: цвет × яркость исходного пикселя."""
    k = (lum / max(1e-6, np.median(lum) if lum.size else 1))[:, None]
    return np.clip(np.array(color, float)[None, :] * np.clip(k, 0.35, 1.7), 0, 255)


def process_frame(fr, h, back=False, hr=(0.085, 0.19, 0.14)):
    """hr — пропорции головы: граница волос, низ лица, ширина головы по верхним рядам (доли роста)."""
    a = fr.copy()
    al = a[:, :, 3] > 40
    if al.sum() < 50:
        return a
    ys, xs = np.nonzero(al)
    y0, y1 = ys.min(), ys.max() + 1
    H = y1 - y0
    rgb = a[:, :, :3].astype(float)
    lum = rgb.mean(axis=2)
    r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    yy = np.arange(a.shape[0])[:, None] * np.ones((1, a.shape[1]))
    xx = np.ones((a.shape[0], 1)) * np.arange(a.shape[1])[None, :]
    core = (r_ > 235) & (b_ < 110) & (r_ - b_ > 140)  # насыщенное ядро вспышки
    flash = ndimage.binary_dilation(core, iterations=3) & (lum > 110)  # вспышка выстрела не перекрашивается
    cloth = al & (lum > 55) & ~flash
    if h["mask"]:
        # голова: центр — по самым верхним рядам фигуры, ширина — по верхним 14%
        top = al & (yy < y0 + H * 0.07)
        cx = float(np.median(xx[top]))
        band = al & (yy < y0 + H * hr[2])
        hw = min(13.0, max(6.0, (xx[band].max() - xx[band].min()) / 2))
        hb = al & (yy < y0 + H * hr[1]) & (np.abs(xx - cx) <= hw + 1)
        hair_z = hb & (yy < y0 + H * hr[0])
        face_z = hb & (yy >= y0 + H * hr[0])
        # лицом к нам: в зоне лица много тёмных/серых пикселей маски и очков
        maskish = face_z & ((lum < 80) | ((np.abs(r_ - g_) < 14) & (np.abs(g_ - b_) < 14)))
        front = not back and face_z.sum() and maskish.sum() / max(1, face_z.sum()) > 0.18
        keep = lum >= 38  # тёмный контур оставляем
        hz = hair_z & keep
        a[hz, :3] = tint(rgb[hz], h["hair"], lum[hz])
        fz = face_z & keep & ~flash
        if front:
            # кожа; глаза — две тёмные точки, рот — штрих
            a[fz, :3] = tint(rgb[fz], h["skin"], np.clip(lum[fz] * 0.12 + 150, 120, 200))  # ровная кожа, без узора маски
            fy = int(y0 + H * (hr[0] + 0.03))
            for ex in (-3, 2):
                x = int(round(cx + ex))
                if 0 <= fy < a.shape[0] and 0 <= x < a.shape[1] and al[fy, x]:
                    a[fy, x, :3] = (40, 30, 26)
            my = int(y0 + H * (hr[1] - 0.03))
            for dx in (-1, 0, 1):
                x = int(round(cx + dx))
                if 0 <= my < a.shape[0] and 0 <= x < a.shape[1] and al[my, x]:
                    a[my, x, :3] = (120, 70, 60)
            if h["long"]:  # каре обрамляет лицо по бокам
                side = face_z & keep & (np.abs(xx - cx) >= hw * 0.62)
                a[side, :3] = tint(rgb[side], h["hair"], lum[side])
        else:
            a[fz, :3] = tint(rgb[fz], h["hair"], lum[fz])
        if h["long"] and not front:  # волосы до плеч сзади
            nape = al & keep & (yy >= y0 + H * 0.19) & (yy < y0 + H * 0.26) & (np.abs(xx - cx) <= hw) & ~flash & (lum > 60)
            a[nape, :3] = tint(rgb[nape], h["hair"], lum[nape])
        cloth = cloth & ~hb
    if h["top"] is not None:
        t = cloth & (yy >= y0 + H * 0.17) & (yy < y0 + H * 0.58) & (r_ > b_ * 1.02)
        a[t, :3] = tint(rgb[t], h["top"], lum[t])
    if h["bottom"] is not None:
        b = cloth & (yy >= y0 + H * 0.58) & (yy < y0 + H * 0.9) & (r_ > b_ * 1.02)
        a[b, :3] = tint(rgb[b], h["bottom"], lum[b])
    if h["slim"] < 1:
        im = Image.fromarray(a)
        w2 = round(im.width * h["slim"])
        im2 = im.resize((w2, im.height), Image.LANCZOS)
        out = Image.new("RGBA", im.size, (0, 0, 0, 0))
        out.alpha_composite(im2, ((im.width - w2) // 2, 0))
        a = np.array(out)
    return a


def build(manifest=None, out_dir=CH):
    res = {}
    for hero, h in HEROES.items():
        for sheet, (fw, fh) in SHEETS.items():
            src = np.array(Image.open(os.path.join(CH, sheet + ".png")).convert("RGBA"))
            out = src.copy()
            rows = src.shape[0] // fh
            for ri, y in enumerate(range(0, src.shape[0], fh)):
                # спиной к нам: в листах 8 направлений — СВ, С, СЗ; в листе солдата — С
                back = ri in (3, 4, 5) if rows == 8 else ri == 2
                for x in range(0, src.shape[1], fw):
                    out[y:y + fh, x:x + fw] = process_frame(src[y:y + fh, x:x + fw], h, back, (0.11, 0.25, 0.16) if sheet == 'soldier' else (0.085, 0.19, 0.14))
            name = f"{sheet}_{hero}"
            Image.fromarray(out).save(os.path.join(out_dir, name + ".png"))
            if manifest is not None:
                manifest["hero_" + name] = {"src": f"assets/chars/{name}.png", "w": out.shape[1], "h": out.shape[0], "fw": fw, "fh": fh}
            res[name] = out.shape
    return res


if __name__ == "__main__":
    import sys
    print(build(out_dir=sys.argv[1] if len(sys.argv) > 1 else CH))
