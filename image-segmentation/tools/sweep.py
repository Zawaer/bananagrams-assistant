"""Run a model once per image at a low confidence, then sweep post-processing
(confidence threshold, NMS IoU, class-agnostic NMS) over the cached detections.

Sets:
  test, valid        the labelled photos (originals shrunk to 1600 like the app)
  test_mosaic,
  valid_mosaic       2x2 grids of those photos at 1600x1200, so tiles are half the
                     size: a labelled stand-in for whole-pool photos
  test1, test2       unlabelled real photos (test1 = the full 144-tile pool,
                     test2 = a big pile cut by the frame): detection count only

usage: sweep.py MODEL [--imgsz 640] [--slice 0|-1|N] [--device cpu|0] [--json out]
CPU time per photo (mean over test+valid) is printed; it is only meaningful with
--device cpu and an otherwise idle machine.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import supervision as sv  # noqa: E402
from core import (REPO, app_shrink, load_split, mask_polygon, match, raw_detect,  # noqa: E402
                  server_post, summarize, to_tiles)


def mosaic(data, k=4, cell=(800, 600)):
    out = []
    n = len(data)
    cw, ch = cell
    for i in range(0, n, 2):
        group = [data[(i + j) % n] for j in range(k)]
        canvas = np.full((ch * 2, cw * 2, 3), 30, np.uint8)
        gt = []
        for j, (_, img, g) in enumerate(group):
            h, w = img.shape[:2]
            s = min(cw / w, ch / h)
            im = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
            ox, oy = (j % 2) * cw, (j // 2) * ch
            canvas[oy:oy + im.shape[0], ox:ox + im.shape[1]] = im
            gt += [(c, p * s + [ox, oy]) for c, p in g]
        canvas = cv2.imdecode(cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])[1], 1)
        out.append((f"mosaic{i}", canvas, gt))
    return out


def load_sets(long=1600):
    sets = {}
    for sp in ("test", "valid"):
        d = load_split(sp, "orig", long)
        sets[sp] = d
        sets[sp + "_mosaic"] = mosaic(d)
    for k in (1, 2):
        img = app_shrink(cv2.imread(f"{REPO}/image-segmentation/test{k}.jpg"), long)
        sets[f"test{k}"] = [(f"test{k}", img, None)]
    return sets


def _with_polygons(d, dx=0, dy=0):
    """Swap masks for polygons (full-frame masks for every crop would not fit in memory)."""
    polys = [np.asarray(mask_polygon(d.mask[i] if d.mask is not None else None,
                                     d.xyxy[i]), float) + [dx, dy] for i in range(len(d))]
    d.mask = None
    d.data["polygon"] = np.array(polys + [None], dtype=object)[:-1]
    return d


def sliced(model, image, imgsz, conf, tile=None, overlap=0.25, device="cpu"):
    """Full-image pass plus overlapping crops; merge with (agnostic) NMS afterwards."""
    H, W = image.shape[:2]
    tile = tile or int(max(H, W) * (1 + overlap) / 2)
    t = time.perf_counter()
    r = model(image, imgsz=imgsz, conf=conf, verbose=False, max_det=500, device=device)[0]
    dets = [_with_polygons(sv.Detections.from_ultralytics(r))]
    step = int(tile * (1 - overlap))
    xs = list(range(0, max(W - tile, 0) + 1, step)) or [0]
    ys = list(range(0, max(H - tile, 0) + 1, step)) or [0]
    if xs[-1] + tile < W:
        xs.append(W - tile)
    if ys[-1] + tile < H:
        ys.append(H - tile)
    for y in ys:
        for x in xs:
            crop = image[y:y + tile, x:x + tile]
            r = model(crop, imgsz=imgsz, conf=conf, verbose=False, max_det=500, device=device)[0]
            d = sv.Detections.from_ultralytics(r)
            if len(d) == 0:
                continue
            ch, cw = crop.shape[:2]
            # drop detections touching an inner crop edge: the tile is cut there
            x1, y1, x2, y2 = d.xyxy.T
            keep = np.ones(len(d), bool)
            if x > 0:
                keep &= x1 > 3
            if y > 0:
                keep &= y1 > 3
            if x + cw < W:
                keep &= x2 < cw - 3
            if y + ch < H:
                keep &= y2 < ch - 3
            d = d[keep]
            if len(d) == 0:
                continue
            d = _with_polygons(d, x, y)
            d.xyxy = d.xyxy + np.array([x, y, x, y], dtype=d.xyxy.dtype)
            dets.append(d)
    dets = [d for d in dets if len(d)]
    merged = sv.Detections.merge(dets) if dets else sv.Detections.empty()
    return merged, time.perf_counter() - t


CONFIGS = [(c, n, ag) for c in (0.8, 0.6, 0.5, 0.4, 0.3, 0.25)
           for n, ag in ((0.8, False), (0.5, True), (0.3, True))]


def evaluate(raw, set_names, configs=CONFIGS):
    results = []
    print(f"{'conf':>5}{'nms':>5}{'agn':>5} | " + " | ".join(f"{s:^22}" for s in set_names))
    for c, n, ag in configs:
        row = {"conf": c, "nms": n, "agnostic": ag}
        cells = []
        for sn in set_names:
            rows, count = [], None
            for gt, det in raw[sn]:
                tiles = to_tiles(server_post(det, n, c, ag))
                if gt is None:
                    count = len(tiles)
                    continue
                tp, ng, nd, cor = match(gt, tiles)
                rows.append(("", tp, ng, nd, cor))
            if count is not None:
                row[sn] = count
                cells.append(f"{count:^22}")
            else:
                s = summarize(rows)
                row[sn] = s
                cells.append(f"R{s['recall']:.3f} P{s['precision']:.3f} L{s['letter_acc']:.3f}")
        results.append(row)
        print(f"{c:>5}{n:>5}{str(ag)[0]:>5} | " + " | ".join(cells), flush=True)
    return results


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--slice", type=int, default=0, help="crop px; 0 = none, -1 = auto (2x2)")
    ap.add_argument("--long", type=int, default=1600)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--sets", default="test,valid,test_mosaic,valid_mosaic,test1,test2")
    ap.add_argument("--json")
    ap.add_argument("--configs", help='only these, e.g. "0.8:0.5:1,0.5:0.5:1" (conf:nms:agnostic)')
    a = ap.parse_args()
    from ultralytics import YOLO
    model = YOLO(a.model, task="segment")
    sets = load_sets(a.long)
    names = a.sets.split(",")
    raw, times = {}, []
    model(sets[names[0]][0][1], imgsz=a.imgsz, verbose=False, device=a.device)  # warm-up
    for sn in names:
        raw[sn] = []
        for _, img, gt in sets[sn]:
            if a.slice:
                det, dt = sliced(model, img, a.imgsz, 0.05, None if a.slice < 0 else a.slice,
                                 device=a.device)
            else:
                det, dt = raw_detect(model, img, imgsz=a.imgsz, conf=0.05, device=a.device)
            if sn in ("test", "valid"):
                times.append(dt)
            raw[sn].append((gt, det))
    print(f"model={os.path.basename(a.model)} imgsz={a.imgsz} slice={a.slice} long={a.long} "
          f"device={a.device} mean_ms(test+valid)={1000 * np.mean(times):.0f}", flush=True)
    configs = CONFIGS
    if a.configs:
        configs = [(float(c), float(n), ag == "1")
                   for c, n, ag in (x.split(":") for x in a.configs.split(","))]
    results = evaluate(raw, names, configs)
    if a.json:
        json.dump({"mean_ms": 1000 * np.mean(times), "results": results}, open(a.json, "w"), indent=1)
