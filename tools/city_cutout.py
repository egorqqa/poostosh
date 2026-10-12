"""Вырезка объектов города с белого фона: фон и холодные тени — заливкой от краёв, водяной знак — прямоугольником."""
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
from scipy import ndimage


def cutout(path, thin=False, holes=False):
    im = Image.open(path).convert("RGB")
    a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    white = (mn >= 200) & (mx - mn <= 26)
    shadow = (b >= r - 3) & (b >= g - 6) & (mx - mn <= 45) & (mn >= 110)
    bgc = white | shadow
    lab, _ = ndimage.label(bgc)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    # крупные «дыры» фона внутри объекта (под лавкой, за сеткой забора)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, lab.max() + 1))
    big = [i + 1 for i, sz in enumerate(sizes) if sz > 1500]
    if holes:  # только голубоватые тени внутри (под лавкой)
        bg |= np.isin(lab, big) & ((b > r + 4) | (mn >= 232))
        bg = ndimage.binary_opening(bg, iterations=1) | (bg & (mn >= 240))
    # водяной знак «Dola AI» в правом нижнем углу
    H, W = bg.shape
    wm = np.zeros_like(bg); wm[int(H * 0.89):, int(W * 0.8):] = True
    bg |= wm & (mn >= 140)
    # мелкие дыры (просветы, похожие на фон внутри) не трогаем — только связанный с краем фон
    alpha = (~bg).astype(np.uint8) * 255
    if thin:  # убрать тонкие провода
        alpha = (ndimage.binary_opening(alpha > 0, iterations=3)).astype(np.uint8) * 255
    # убрать одиночные крошки
    lab2, n2 = ndimage.label(alpha > 0)
    if n2:
        sizes = ndimage.sum(np.ones_like(lab2), lab2, range(1, n2 + 1))
        keep = np.isin(lab2, [i + 1 for i, s in enumerate(sizes) if s > 400])
        alpha[~keep] = 0
    # светлая кайма по краю
    edge_px = (alpha > 0) & ndimage.binary_dilation(alpha == 0, iterations=2)
    alpha[edge_px & (mn >= 185)] = 0
    alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.7)))
    out = Image.fromarray(np.dstack([a.astype(np.uint8), alpha]), "RGBA")
    return out.crop(out.getbbox())


def stylize(im):
    """Приведение к палитре игры: чуть теплее, приглушённее, контрастнее."""
    rgb = im.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(0.82)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.08)
    arr = np.array(rgb).astype(float)
    arr[..., 0] *= 1.02; arr[..., 2] *= 0.9
    arr = np.clip(arr * 0.94, 0, 255).astype(np.uint8)
    out = Image.fromarray(arr).convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
