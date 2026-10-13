"""Модели героя с оружием в руках (пистолет, ружьё, автомат) из папки «оружие».
Все листы приводятся к единому виду: один рост фигуры, общая точка опоры (ноги),
общий тон и контраст, 8 направлений (S, SE, E, NE, N, NW, W, SW).
Колонки листа: кадры ходьбы, затем «прицел», затем «выстрел» (со вспышкой).
Запуск: python tools/build_guns.py  (вызывается и из build_assets.py)
"""
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "оружие")
OUT = os.path.join(ROOT, "game", "assets", "chars")
FW, FH, AX, AY, TARGET_H = 150, 112, 75, 106, 88


def load(name):
    a = np.array(Image.open(os.path.join(SRC, name)).convert("RGBA"))
    rgb = a[:, :, :3].astype(int)
    al = a[:, :, 3]
    # красно-жёлтая кайма по краю (артефакт вырезания): полупрозрачные насыщенные пиксели
    halo = (al < 230) & (rgb[:, :, 0] > rgb[:, :, 1] * 1.35) & (rgb[:, :, 0] > 120) & ~flash_mask(a)
    a[halo, 3] = 0
    a[a[:, :, 3] < 90, 3] = 0
    return a


def flash_mask(a):
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    return (a[:, :, 3] > 0) & (r > 230) & (g > 110) & (b < 120) & (r - b > 130)


def figures(a, big=4000):
    """Фигуры — крупные связные области; мелкие (вспышки, отлетевшие детали) — к ближайшей фигуре."""
    m = a[:, :, 3] > 0
    lab, _ = ndimage.label(ndimage.binary_dilation(m, iterations=1))
    lab[~m] = 0
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        px = int((lab[sl] == i).sum())
        if px >= 30:
            comps.append(dict(i=i, y0=sl[0].start, y1=sl[0].stop, x0=sl[1].start, x1=sl[1].stop, px=px))
    figs = [dict(c, ids=[c["i"]]) for c in comps if c["px"] >= big]
    for c in comps:
        if c["px"] >= big:
            continue
        cy, cx = (c["y0"] + c["y1"]) / 2, (c["x0"] + c["x1"]) / 2

        def d(f):
            dx = max(f["x0"] - cx, 0, cx - f["x1"]); dy = max(f["y0"] - cy, 0, cy - f["y1"])
            return dx * dx + dy * dy
        f = min(figs, key=d)
        if d(f) < 50 ** 2:
            f["ids"].append(c["i"])
    for f in figs:
        f["cy"] = (f["y0"] + f["y1"]) / 2
        f["cx"] = (f["x0"] + f["x1"]) / 2
    return lab, figs


def cut(a, lab, f):
    sel = np.isin(lab, f["ids"])
    ys, xs = np.nonzero(sel)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    fr = a[y0:y1, x0:x1].copy()
    fr[~sel[y0:y1, x0:x1], 3] = 0
    return fr


def body_metrics(fr):
    """Верх и низ тела (без вспышки) и центр по туловищу."""
    m = (fr[:, :, 3] > 0) & ~flash_mask(fr)
    ys, xs = np.nonzero(m)
    by0, by1 = ys.min(), ys.max() + 1
    # центр — по голове и плечам: верхние 30% фигуры, ствол туда почти не попадает
    top = ys < by0 + (by1 - by0) * 0.3
    return by0, by1, float(np.median(xs[top]))


def grid_frames(a, rows, cols):
    lab, figs = figures(a)
    h, w = a.shape[:2]
    cells = {}
    for f in figs:
        r, c = int(f["cy"] // (h / rows)), int(f["cx"] // (w / cols))
        if (r, c) not in cells or f["px"] > cells[(r, c)]["px"]:
            cells[(r, c)] = f
    return {k: cut(a, lab, f) for k, f in cells.items()}


def rows_frames(a, nrows):
    lab, figs = figures(a)
    h = a.shape[0]
    rows = [[] for _ in range(nrows)]
    for f in figs:
        rows[min(nrows - 1, int(f["cy"] // (h / nrows)))].append(f)
    for r in rows:
        r.sort(key=lambda f: f["cx"])
    return [[(cut(a, lab, f), f) for f in r] for r in rows]


def mirror(fr):
    return fr[:, ::-1].copy()


def unflash(fr):
    f2 = fr.copy()
    rgb = fr[:, :, :3].astype(int)
    fm = ndimage.binary_dilation(flash_mask(fr), iterations=4) & ((rgb[:, :, 0] > 150) | (rgb.min(2) > 170))
    # белое ядро вспышки у дула — по краям кадра, где тела уже нет
    w = fr.shape[1]
    edge = np.zeros(fm.shape, bool); edge[:, :int(w * 0.2)] = True; edge[:, int(w * 0.8):] = True
    fm |= edge & (rgb.min(2) > 185)
    f2[fm, 3] = 0
    return despeckle(f2)


def despeckle(fr, keep_flash=True):
    """Убираем мелкие оторванные пиксели (остатки вспышки и фона)."""
    m = fr[:, :, 3] > 0
    lab, n = ndimage.label(m)
    if n <= 1:
        return fr
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    fl = flash_mask(fr)
    out = fr.copy()
    for i, sz in enumerate(sizes, 1):
        if sz < 40:
            part = lab == i
            if keep_flash and (fl & part).sum() > sz * 0.3:
                continue
            out[part, 3] = 0
    return out


def opaque(fr):
    return (fr[:, :, 3] > 0) & ~flash_mask(fr)


def stats(frames):
    px = np.concatenate([fr[opaque(fr)][:, :3].astype(float) for fr in frames])
    return px.mean(0), px.std(0)


def match_colors(frames, ref):
    """Подгоняем средний тон и контраст листа к эталону — модели выглядят одинаково."""
    mu, sd = stats(frames)
    rmu, rsd = ref
    k = np.clip(rsd / (sd + 1e-6), 0.85, 1.15)
    out = []
    for fr in frames:
        f2 = fr.astype(float)
        m = opaque(fr)
        f2[m, :3] = (f2[m, :3] - mu) * k + rmu
        out.append(np.clip(f2, 0, 255).astype(np.uint8))
    return out


def body_h(frames):
    return float(np.median([body_metrics(f)[1] - body_metrics(f)[0] for f in frames]))


def rescale(fr, k):
    im = Image.fromarray(fr)
    return np.array(im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS))


def compose(dirs, ref_h):
    ncol = max(len(d) for d in dirs)
    sheet = Image.new("RGBA", (FW * ncol, FH * 8), (0, 0, 0, 0))
    sc = TARGET_H / ref_h
    for r, frames in enumerate(dirs):
        for c, fr in enumerate(frames):
            fr = despeckle(rescale(fr, sc))
            by0, by1, cx = body_metrics(fr)
            tile = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
            tile.alpha_composite(Image.fromarray(fr), (0, 0), (0, 0)) if False else None
            dx, dy = AX - round(cx), AY - by1
            # обрезаем то, что не влезает в клетку
            sx0, sy0 = max(0, -dx), max(0, -dy)
            piece = Image.fromarray(fr).crop((sx0, sy0, min(fr.shape[1], FW - dx), min(fr.shape[0], FH - dy)))
            tile.alpha_composite(piece, (max(0, dx), max(0, dy)))
            sheet.alpha_composite(tile, (c * FW, r * FH))
    return sheet


def build(manifest=None):
    os.makedirs(OUT, exist_ok=True)
    info = {}
    # пистолет: 8 колонок = направления S..SW; ряды: шаг, шаг, прицел, выстрел
    P = grid_frames(load("Пиксельный солдат_ спрайт-лист 8×4.png"), 4, 8)
    # ружьё: ряды шаг, шаг, выстрел, шаг
    S = grid_frames(load("Пиксельный спрайт-лист солдата в противогазе.png"), 4, 8)
    # автомат: ходьба 7 рядов × 6, стрельба 4 ряда × 8
    W = rows_frames(load("age_of_caravans_soldier_32_sprites_transparent.png"), 7)
    F = rows_frames(load("age_of_caravans_ak_firing_sprites_transparent.png"), 4)

    ref = stats([P[(r, c)] for r in range(2) for c in range(8)])

    def finish(key, dirs, ref_h, nwalk):
        flat = match_colors([f for d in dirs for f in d], ref)
        it = iter(flat)
        dirs = [[next(it) for _ in d] for d in dirs]
        sheet = compose(dirs, ref_h)
        sheet.save(os.path.join(OUT, f"pl_{key}.png"))
        info[key] = dict(walk=nwalk, aim=nwalk, fire=nwalk + 1)
        if manifest is not None:
            manifest[f"gun_{key}"] = {"src": f"assets/chars/pl_{key}.png", "w": sheet.width, "h": sheet.height,
                                      "fw": FW, "fh": FH, "ax": AX, "ay": AY, "walk": nwalk, "aim": nwalk, "fire": nwalk + 1}

    pd = [[P[(0, c)], P[(1, c)], P[(2, c)], P[(3, c)]] for c in range(8)]
    finish("pistol", pd, body_h([P[(r, c)] for r in range(2) for c in range(8)]), 2)

    sd = [[S[(0, c)], S[(1, c)], S[(3, c)], unflash(S[(2, c)]), S[(2, c)]] for c in range(8)]
    finish("rifle", sd, body_h([S[(r, c)] for r in (0, 1, 3) for c in range(8)]), 3)

    walk = [[fr for fr, f in r] for r in W]

    def fire_pair(row):
        cand = [(fr, f) for fr, f in F[row] if (f["x1"] - f["x0"]) < 260]
        fl = [fr for fr, f in cand if flash_mask(fr).sum() > 40]
        nf = [fr for fr, f in cand if flash_mask(fr).sum() <= 40]
        return unflash(nf[0] if nf else fl[0]), fl[0]
    fS, fE, fNE, fSE = fire_pair(0), fire_pair(1), fire_pair(2), fire_pair(3)
    # листы ходьбы и стрельбы нарисованы в разном масштабе — приводим стрельбу к росту ходьбы
    k = body_h([f for r in walk for f in r]) / body_h([fS[0], fE[0], fNE[0], fSE[0]])
    fS, fE, fNE, fSE = [tuple(rescale(x, k) for x in p) for p in (fS, fE, fNE, fSE)]
    # ряды ходьбы исходника: S, SE, W, N, NE, E, SE-2
    ad = [
        walk[0] + list(fS),
        walk[1] + list(fSE),
        walk[5] + list(fE),
        walk[4] + list(fNE),
        walk[3] + list(fNE),
        [mirror(x) for x in walk[4]] + [mirror(x) for x in fNE],
        walk[2] + [mirror(x) for x in fE],
        [mirror(x) for x in walk[1]] + [mirror(x) for x in fSE],
    ]
    finish("ak", ad, body_h([f for r in walk for f in r]), len(walk[0]))
    return info


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False))
