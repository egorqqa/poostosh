"""Сборка игровых ассетов из исходных картинок.
Запуск из корня проекта:  python tools/build_assets.py
Результат: game/assets/... и game/js/manifest.js
"""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "game", "assets")

SHEETS = {
    "military": ("8da839eb-17a4-49b9-ba3a-35153d59af41.png", 0.95, False),
    "camp": ("postapocalyptic_camp_transparent.png", 0.5, True),
    "market": ("postapocalyptic_market_transparent.png", 0.5, True),
    "veg": ("age_of_caravans_vegetation_transparent.png", 0.62, True),
    "power": ("Пиксельный набор промышленных электросетей.png", 0.5, False),
    "objects": ("Постапокалиптический изометрический набор объектов.png", 0.62, False),
    "postind": ("Изометрический набор постиндустриальных объектов.png", 0.85, False),
}

# имя спрайта: (лист, (x0, y0, x1, y1)) — координаты в исходном листе
SPRITES = {
    # --- лагерь ---
    "gas_station": ("camp", (29, 20, 790, 636)),
    "garage": ("camp", (725, 112, 1525, 593)),
    "tent_green_lit": ("camp", (64, 566, 412, 835)),
    "tent_white": ("camp", (479, 579, 781, 825)),
    "tent_green": ("camp", (1165, 568, 1503, 825)),
    "truck": ("camp", (640, 702, 1187, 1011)),
    # --- рынок ---
    "shop_big": ("market", (15, 22, 771, 503)),
    "booth": ("market", (779, 44, 1202, 450)),
    "shop_parts": ("market", (832, 268, 1495, 985)),
    "stall_awning": ("market", (383, 431, 835, 735)),
    "stall_food": ("market", (46, 625, 533, 992)),
    # --- объекты ---
    "water_tower": ("objects", (22, 12, 342, 420)),
    "watchtower_wood": ("objects", (353, 13, 641, 386)),
    "quonset": ("objects", (581, 12, 1079, 347)),
    "med_tent": ("objects", (1086, 20, 1532, 328)),
    "fuel_tank": ("objects", (411, 315, 865, 633)),
    "car_shed": ("objects", (867, 265, 1360, 627)),
    "windmill": ("objects", (1368, 293, 1530, 709)),
    "bunker_small": ("objects", (16, 413, 448, 691)),
    "sandbag_post": ("objects", (894, 551, 1495, 899)),
    "bus": ("objects", (10, 650, 577, 915)),
    "wrecked_cars": ("objects", (568, 615, 899, 834)),
    "crate_long": ("objects", (494, 833, 585, 910)),
    "ammo_box": ("objects", (595, 822, 705, 905)),
    "jersey_small": ("objects", (15, 919, 107, 1002)),
    "jersey_yellow": ("objects", (113, 901, 260, 998)),
    "jersey_red": ("objects", (263, 880, 388, 978)),
    "hedgehog": ("objects", (389, 860, 484, 972)),
    "crate_small": ("objects", (502, 918, 579, 991)),
    "barrels": ("objects", (589, 895, 729, 1006)),
    "cable_spool": ("objects", (733, 847, 819, 954)),
    "tires": ("objects", (825, 843, 976, 982)),
    "pallet": ("objects", (979, 878, 1122, 981)),
    "sacks_pallet": ("objects", (1122, 901, 1301, 1007)),
    "pipes": ("objects", (1308, 841, 1522, 982)),
    # --- военные ---
    "mil_hq": ("military", (8, 8, 532, 330)),
    "mil_mg_bunker": ("military", (465, 52, 735, 218)),
    "mil_aa": ("military", (712, 15, 998, 255)),
    "mil_tower": ("military", (987, 12, 1208, 293)),
    "mil_radio_truck": ("military", (1215, 52, 1530, 288)),
    "mil_med_tent": ("military", (387, 225, 818, 450)),
    "mil_heli": ("military", (768, 262, 1320, 555)),
    "mil_fuel": ("military", (1245, 285, 1530, 518)),
    "mil_hangar": ("military", (8, 330, 518, 608)),
    "mil_truck_shed": ("military", (532, 435, 945, 683)),
    "mil_tent": ("military", (15, 600, 270, 758)),
    "mil_camo_net": ("military", (267, 563, 563, 758)),
    "mil_missile": ("military", (885, 533, 1245, 758)),
    "mil_radar": ("military", (1245, 510, 1530, 743)),
    "mil_btr": ("military", (8, 750, 353, 938)),
    "mil_tank": ("military", (360, 720, 705, 915)),
    "mil_lamp": ("military", (717, 690, 788, 878)),
    "mil_checkpoint": ("military", (750, 698, 1005, 885)),
    "mil_bunker_door": ("military", (1312, 743, 1530, 923)),
    "mil_sandwall": ("military", (192, 897, 435, 998)),
    "mil_barrier": ("military", (435, 922, 543, 1008)),
    "mil_barrier2": ("military", (548, 900, 660, 983)),
    "mil_crates": ("military", (8, 915, 105, 1017)),
    "mil_concrete": ("military", (1118, 758, 1208, 840)),
    "mil_crate_pile": ("military", (1208, 743, 1305, 825)),
    "mil_ammo": ("military", (1260, 930, 1358, 1008)),
    "mil_locker": ("military", (1155, 870, 1223, 960)),
    # --- электросети ---
    "transformer_big": ("power", (23, 16, 482, 510)),
    "transformer": ("power", (489, 107, 768, 492)),
    "transformer_rad": ("power", (756, 181, 1020, 519)),
    "pole": ("power", (1101, 164, 1226, 477)),
    "pole_box": ("power", (1318, 223, 1396, 516)),
    "lamp_post": ("power", (54, 458, 107, 724)),
    "pillar": ("power", (724, 559, 805, 724)),
    "gate_rad": ("power", (881, 506, 1445, 743)),
    "fence_wire": ("power", (19, 731, 331, 977)),
    "fence_wire_s": ("power", (340, 739, 519, 950)),
    "fence_wire_corner": ("power", (544, 742, 810, 981)),
    "fence_bars": ("power", (824, 736, 1095, 953)),
    # --- растительность ---
    "tree_oak": ("veg", (8, 8, 285, 390)),
    "tree_pine": ("veg", (563, 8, 720, 360)),
    "tree_spruce": ("veg", (717, 15, 855, 352)),
    "tree_yellow": ("veg", (846, 4, 1026, 381)),
    "tree_dead": ("veg", (1019, 55, 1171, 386)),
    "tree_dead2": ("veg", (1178, 16, 1300, 380)),
    "tree_willow": ("veg", (1300, 53, 1521, 397)),
    "tree_small": ("veg", (521, 284, 633, 555)),
    "bush_berry": ("veg", (748, 356, 918, 540)),
    "bush_round": ("veg", (923, 366, 1051, 514)),
    "bush_flower": ("veg", (1055, 365, 1221, 533)),
    "bush_dry": ("veg", (1224, 412, 1361, 527)),
    "stump_big": ("veg", (1281, 374, 1529, 600)),
    "bush_low": ("veg", (639, 596, 812, 690)),
    "log": ("veg", (3, 678, 318, 836)),
    "log2": ("veg", (286, 681, 541, 792)),
    "stump": ("veg", (715, 678, 927, 792)),
    "grass1": ("veg", (283, 779, 418, 884)),
    "grass2": ("veg", (368, 774, 590, 926)),
    "grass3": ("veg", (12, 862, 124, 934)),
    "grass4": ("veg", (144, 854, 243, 955)),
    "flowers": ("veg", (596, 796, 697, 884)),
    "weeds": ("veg", (755, 810, 915, 916)),
    "rocks": ("veg", (950, 900, 1110, 1014)),
    "rocks2": ("veg", (1113, 877, 1256, 989)),
    "rocks_big": ("veg", (1256, 833, 1522, 1011)),
    # --- постиндустриальный набор ---
    "brick_factory": ("postind", (14, 22, 503, 395)),
    "warehouse": ("postind", (485, 48, 977, 337)),
    "silo": ("postind", (951, 10, 1176, 378)),
    "tank_horizontal": ("postind", (1182, 81, 1523, 363)),
    "storage_shed": ("postind", (387, 332, 782, 614)),
    "water_tower2": ("postind", (797, 298, 946, 637)),
    "gantry_crane": ("postind", (30, 367, 382, 648)),
    "office_hq": ("postind", (964, 373, 1319, 679)),
    "floodlight": ("postind", (1330, 362, 1406, 663)),
    "power_pole2": ("postind", (1413, 370, 1509, 699)),
    "bus2": ("postind", (30, 605, 361, 796)),
    "boxcar": ("postind", (423, 611, 707, 784)),
    "pipes_stack": ("postind", (710, 634, 898, 746)),
    "elec_cabinet": ("postind", (892, 636, 1002, 755)),
    "guard_booth": ("postind", (1028, 674, 1125, 780)),
    "forklift": ("postind", (1145, 674, 1274, 807)),
    "grate": ("postind", (1302, 705, 1406, 763)),
    "wrecked_car": ("postind", (28, 788, 277, 908)),
    "concrete_blocks": ("postind", (314, 766, 476, 879)),
    "barrels_crates": ("postind", (494, 760, 698, 865)),
    "cable_barrel": ("postind", (716, 750, 869, 832)),
    "pallet_boxes": ("postind", (877, 768, 976, 833)),
    "sign_quarantine": ("postind", (991, 787, 1123, 928)),
    "checkpoint2": ("postind", (1157, 810, 1354, 1005)),
    "fence_mesh": ("postind", (1348, 750, 1511, 885)),
    "big_pipes": ("postind", (28, 874, 347, 1005)),
    "jersey_yellow2": ("postind", (447, 875, 574, 964)),
    "jersey_grey": ("postind", (505, 922, 614, 1004)),
    "crate_pile": ("postind", (630, 861, 767, 953)),
    "locker_green": ("postind", (790, 841, 914, 995)),
    "barriers_red": ("postind", (969, 903, 1145, 1005)),
    "vent_hatch": ("postind", (1366, 872, 1517, 981)),
}

_cache = {}


def clean_sheet(key):
    if key in _cache:
        return _cache[key]
    fname, scale, checker = SHEETS[key]
    a = np.array(Image.open(os.path.join(ROOT, fname)).convert("RGBA"))
    rgb = a[:, :, :3].astype(int)
    lowsat_light = (rgb.max(axis=2) - rgb.min(axis=2) <= 14) & (rgb.min(axis=2) >= 170)
    if checker:
        # «шахматка», нарисованная внутри картинки: светло-серые пиксели, связанные с прозрачностью
        cand = (a[:, :, 3] < 30) | lowsat_light
        lab, _ = ndimage.label(cand)
        touching = np.unique(lab[a[:, :, 3] < 30])
        kill = np.isin(lab, touching[touching > 0]) & lowsat_light
        a[kill, 3] = 0
    # белая кайма
    a[(a[:, :, 3] < 220) & lowsat_light, 3] = 0
    mask = a[:, :, 3] > 200
    lab, _ = ndimage.label(ndimage.binary_dilation(mask, iterations=2))
    _cache[key] = (a, mask, lab, scale)
    return _cache[key]


def crop(key, box):
    a, mask, lab, scale = clean_sheet(key)
    x0, y0, x1, y1 = box
    sub = lab[y0:y1, x0:x1]
    ids, cnt_in = np.unique(sub[sub > 0], return_counts=True)
    keep = []
    for i, c in zip(ids, cnt_in):
        total = (lab == i).sum()
        if c / total >= 0.7 and c > 60:
            keep.append(i)
    if not keep:  # объект сросся с соседями — берём всё, что попало в рамку
        keep = [i for i, c in zip(ids, cnt_in) if c > 60]
    sel = np.isin(lab, keep)
    sel[:y0, :] = False; sel[y1:, :] = False; sel[:, :x0] = False; sel[:, x1:] = False
    ys, xs = np.nonzero(sel)
    by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = a[by0:by1, bx0:bx1].copy()
    out[~sel[by0:by1, bx0:bx1], 3] = 0
    im = Image.fromarray(out)
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    return im.resize((w, h), Image.LANCZOS)


def build_soldier(manifest):
    """Лист солдата 8x4: ряды = юг, восток, север, запад. Кадры выравниваются по ногам."""
    src = Image.open(os.path.join(ROOT, "Пиксельный лист солдата в противогазе.png")).convert("RGBA")
    a = np.array(src)
    mask = a[:, :, 3] > 120
    lab, _ = ndimage.label(ndimage.binary_dilation(mask, iterations=2))
    rows = [(0, 245), (262, 497), (515, 757), (775, 1000)]
    FW, FH, AX, AY = 120, 110, 60, 104
    SC = 0.4
    sheet = Image.new("RGBA", (FW * 8, FH * 4), (0, 0, 0, 0))
    for r, (ry0, ry1) in enumerate(rows):
        for c in range(8):
            cx0, cx1 = c * 192, (c + 1) * 192
            sub = lab[ry0:ry1, cx0:cx1]
            ids, cnts = np.unique(sub[sub > 0], return_counts=True)
            if not len(ids):
                continue
            main = ids[np.argmax(cnts)]
            sel = np.zeros_like(mask)
            sel[ry0:ry1, cx0:cx1] = (sub == main)
            sel &= mask | ndimage.binary_dilation(mask, iterations=1)
            ys, xs = np.nonzero(sel & mask)
            by0, by1 = ys.min(), ys.max() + 1
            # центр по туловищу: медиана столбцов в верхней половине фигуры
            top = ys < by0 + (by1 - by0) * 0.45
            cxm = int(np.median(xs[top]))
            fr = a.copy()
            fr[~sel, 3] = 0
            piece = Image.fromarray(fr).crop((cxm - 110, by0, cxm + 110, by1))
            piece = piece.resize((round(piece.width * SC), round(piece.height * SC)), Image.LANCZOS)
            px = c * FW + AX - piece.width // 2
            py = r * FH + AY - piece.height
            sheet.alpha_composite(piece, (px, py))
    path = os.path.join(OUT, "chars", "soldier.png")
    sheet.save(path)
    manifest["char_soldier"] = {"src": "assets/chars/soldier.png", "w": sheet.width, "h": sheet.height,
                                "fw": FW, "fh": FH, "ax": AX, "ay": AY}


def build_rat(manifest):
    """Лист радкрысы: 8 рядов-направлений (S, SE, E, NE, N, NW, W, SW), слева подписи."""
    src = Image.open(os.path.join(ROOT, "радиоактивная_крыса.png")).convert("RGBA")
    a = np.array(src)
    # центры рядов — по плашкам-подписям в левой колонке
    lbl, n = ndimage.label(a[:, :80, 3] > 100)
    centers = sorted(ndimage.center_of_mass(a[:, :80, 3] > 100, lbl, range(1, n + 1)), key=lambda c: c[0])
    centers = [c[0] for c in centers if True][:8]
    a[:, :80, 3] = 0
    mask = a[:, :, 3] > 100
    lab, _ = ndimage.label(mask)
    CW, CH, AX, AY, SC = 100, 72, 50, 66, 0.34
    # склеенные хвостами кадры соседних рядов разрезаем по середине между рядами
    nxt = lab.max() + 1
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        for k in range(7):
            cut = int((centers[k] + centers[k + 1]) / 2)
            if sl[0].start < centers[k] and sl[0].stop > centers[k + 1]:
                part = (lab == i)
                part[:cut] = False
                lab[part] = nxt
                nxt += 1
    rows = [[] for _ in range(8)]
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        ys, xs = sl
        if (lab[sl] == i).sum() < 800:
            continue
        mid = (ys.start + ys.stop) / 2
        r = min(range(8), key=lambda k: abs(centers[k] - mid))
        rows[r].append((xs.start, xs.stop, ys.start, ys.stop, i))
    for f in rows:
        f.sort()
    ncol = max(len(f) for f in rows)
    sheet = Image.new("RGBA", (CW * ncol, CH * 8), (0, 0, 0, 0))
    counts = []
    for r, frames in enumerate(rows):
        counts.append(len(frames))
        for c, (x0, x1, y0, y1, i) in enumerate(frames):
            fr = a.copy()
            fr[lab != i, 3] = 0
            piece = Image.fromarray(fr[y0:y1, x0:x1])
            piece = piece.resize((max(1, round(piece.width * SC)), max(1, round(piece.height * SC))), Image.LANCZOS)
            sheet.alpha_composite(piece, (c * CW + AX - piece.width // 2, r * CH + AY - piece.height))
    sheet.save(os.path.join(OUT, "chars", "rat.png"))
    manifest["char_rat"] = {"src": "assets/chars/rat.png", "w": sheet.width, "h": sheet.height,
                            "fw": CW, "fh": CH, "ax": AX, "ay": AY, "frames": counts}


def build_wolf(manifest):
    """Лист волка: 7 рядов по 6 кадров (Ю, ЮВ, В, ЮВ-2, С, ЮЗ, З) → 8 направлений движка (S, SE, E, NE, N, NW, W, SW)."""
    src = Image.open(os.path.join(ROOT, "мутантный_волк.png")).convert("RGBA")
    a = np.array(src)
    mask = a[:, :, 3] > 100
    lab, _ = ndimage.label(mask)
    objs = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or (lab[sl] == i).sum() < 1500:
            continue
        objs.append((sl, i))
    # 7 равных полос по высоте; фигура — в полосу своей середины
    band = src.height / 7
    rows = [[] for _ in range(7)]
    for sl, i in objs:
        mid = (sl[0].start + sl[0].stop) / 2
        rows[min(6, int(mid // band))].append((sl[1].start, sl[1].stop, sl[0].start, sl[0].stop, i))
    for r in rows:
        r.sort()
    src_rows = [0, 1, 2, 4, 4, 4, 6, 5]  # какие ряды исходника идут в S, SE, E, NE, N, NW, W, SW
    CW, CH, AX, AY, SC = 120, 92, 60, 86, 0.43
    ncol = max(len(r) for r in rows)
    sheet = Image.new("RGBA", (CW * ncol, CH * 8), (0, 0, 0, 0))
    counts = []
    for out_r, sr in enumerate(src_rows):
        frames = rows[sr]
        counts.append(len(frames))
        for c, (x0, x1, y0, y1, i) in enumerate(frames):
            fr = a.copy(); fr[lab != i, 3] = 0
            piece = Image.fromarray(fr[y0:y1, x0:x1])
            piece = piece.resize((max(1, round(piece.width * SC)), max(1, round(piece.height * SC))), Image.LANCZOS)
            sheet.alpha_composite(piece, (c * CW + AX - piece.width // 2, out_r * CH + AY - piece.height))
    sheet.save(os.path.join(OUT, "chars", "wolf.png"))
    manifest["char_wolf"] = {"src": "assets/chars/wolf.png", "w": sheet.width, "h": sheet.height,
                             "fw": CW, "fh": CH, "ax": AX, "ay": AY, "frames": counts, "rows_found": len(rows)}


def build_portrait(manifest):
    src = Image.open(os.path.join(ROOT, "Пиксельный лист солдата в противогазе.png")).convert("RGBA")
    face = src.crop((40, 0, 160, 120)).resize((120, 120), Image.LANCZOS)
    face.save(os.path.join(OUT, "ui", "portrait.png"))
    manifest["ui_portrait"] = {"src": "assets/ui/portrait.png", "w": 120, "h": 120}


def build_ground(manifest):
    srcs = sorted(os.listdir(os.path.join(ROOT, "large_terrain")))
    for f in srcs:
        im = Image.open(os.path.join(ROOT, "large_terrain", f)).convert("RGBA")
        a = np.array(im)
        rgb = a[:, :, :3].astype(int)
        light = (rgb.max(axis=2) - rgb.min(axis=2) <= 16) & (rgb.min(axis=2) >= 150)
        a[light, 3] = 0
        al = a[:, :, 3] > 128
        al = ndimage.binary_erosion(al, iterations=6)
        soft = Image.fromarray((al * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
        a[:, :, 3] = np.minimum(a[:, :, 3], np.array(soft))
        out = Image.fromarray(a)
        out = out.resize((round(out.width * 0.75), round(out.height * 0.75)), Image.LANCZOS)
        name = "ground_" + f.split("_", 1)[1].rsplit(".", 1)[0]
        out.save(os.path.join(OUT, "ground", name + ".png"))
        manifest[name] = {"src": f"assets/ground/{name}.png", "w": out.width, "h": out.height}
    for f in sorted(os.listdir(os.path.join(ROOT, "hex_tiles"))):
        im = Image.open(os.path.join(ROOT, "hex_tiles", f)).convert("RGBA")
        a = np.array(im)
        mask = a[:, :, 3] > 100
        lab, _ = ndimage.label(mask)
        ids, cnts = np.unique(lab[lab > 0], return_counts=True)
        main = ids[np.argmax(cnts)]
        keep = ndimage.binary_erosion(lab == main, iterations=3)
        a[~keep, 3] = 0
        out = Image.fromarray(a)
        out = out.crop(out.getbbox()).resize((104, 100), Image.LANCZOS)
        name = "hex_" + f.split("_", 1)[1].rsplit(".", 1)[0]
        out.save(os.path.join(OUT, "tiles", name + ".png"))
        manifest[name] = {"src": f"assets/tiles/{name}.png", "w": out.width, "h": out.height}


def main():
    for d in ("sprites", "chars", "ground", "tiles", "ui"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    manifest = {}
    for name, (sheet, box) in SPRITES.items():
        im = crop(sheet, box)
        im.save(os.path.join(OUT, "sprites", name + ".png"))
        manifest[name] = {"src": f"assets/sprites/{name}.png", "w": im.width, "h": im.height}
        print(name, im.size)
    build_soldier(manifest)
    build_rat(manifest)
    build_wolf(manifest)
    build_portrait(manifest)
    build_ground(manifest)
    with open(os.path.join(ROOT, "game", "js", "manifest.js"), "w", encoding="utf-8") as f:
        f.write("// Сгенерировано tools/build_assets.py\nwindow.ASSET_MANIFEST = ")
        json.dump(manifest, f, ensure_ascii=False, indent=0)
        f.write(";\n")


if __name__ == "__main__":
    main()
