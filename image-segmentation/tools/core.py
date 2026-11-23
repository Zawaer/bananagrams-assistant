"""Shared pieces for evaluating the tile detector.

The detection path mirrors backend/segmentation/segmentation-server.py:
model(image) -> sv.Detections.from_ultralytics -> with_nms -> confidence filter
-> convex-hull polygon per mask. Thresholds are parameters so they can be swept.

Scratch files (venv, models, datasets, runs, outputs) live in WORK, which
defaults to /data/worktrees/dettools (set DETTOOLS to move it).
"""
import glob
import os
import time

import cv2
import numpy as np
import supervision as sv
from shapely.geometry import Polygon
from scipy.optimize import linear_sum_assignment

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DS = f"{REPO}/image-segmentation/dataset"
ORIG = f"{REPO}/image-segmentation/images"
WORK = os.environ.get("DETTOOLS", "/data/worktrees/dettools")
NAMES = ['a', 'a_dot', 'b', 'd', 'e', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'o_dot',
         'p', 'r', 's', 't', 'u', 'v', 'y']


def app_shrink(img, long_edge=1600):
    """What the app does before upload: shrink to long_edge, re-encode as JPEG q0.9."""
    h, w = img.shape[:2]
    s = min(1.0, long_edge / max(h, w))
    if s < 1:
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return cv2.imdecode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1], cv2.IMREAD_COLOR)


def load_split(split, source="orig", long_edge=1600):
    """Return [(name, image BGR, gt list of (cls, polygon Nx2 in pixels))].

    source="roboflow": the 640x640 stretched export images.
    source="orig": the full-resolution originals, shrunk like the app does. The
    Roboflow labels are normalised and the export only stretched the photos, so
    they apply to the originals unchanged.
    """
    out = []
    for lp in sorted(glob.glob(f"{DS}/{split}/labels/*.txt")):
        stem = os.path.basename(lp)[:-4]
        if source == "roboflow":
            img = cv2.imread(f"{DS}/{split}/images/{stem}.jpg")
        else:
            img = app_shrink(cv2.imread(f"{ORIG}/{stem.split('_jpg')[0]}.jpg"), long_edge)
        h, w = img.shape[:2]
        gt = []
        for line in open(lp):
            v = line.split()
            if len(v) < 7:
                continue
            gt.append((int(v[0]), np.array(v[1:], float).reshape(-1, 2) * [w, h]))
        out.append((stem, img, gt))
    return out


def raw_detect(model, image, imgsz=640, conf=0.25, iou=0.7, device="cpu"):
    t = time.perf_counter()
    r = model(image, imgsz=imgsz, conf=conf, iou=iou, verbose=False, max_det=500, device=device)[0]
    dt = time.perf_counter() - t
    return sv.Detections.from_ultralytics(r), dt


def mask_polygon(mask, box):
    x1, y1, x2, y2 = (float(v) for v in box)
    poly = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    if mask is not None:
        cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cs:
            c = cv2.convexHull(max(cs, key=cv2.contourArea))
            a = cv2.approxPolyDP(c, 0.008 * cv2.arcLength(c, True), True)
            if len(a) >= 3:
                poly = a.reshape(-1, 2).tolist()
    return poly


def to_tiles(det):
    tiles = []
    for i in range(len(det)):
        box = [float(v) for v in det.xyxy[i]]
        if "polygon" in det.data:
            poly = [list(map(float, p)) for p in det.data["polygon"][i]]
        else:
            poly = mask_polygon(det.mask[i] if det.mask is not None else None, box)
        tiles.append({"cls": int(det.class_id[i]), "conf": float(det.confidence[i]),
                      "box": box, "polygon": poly})
    return tiles


def server_post(det, nms=0.8, conf=0.8, agnostic=False):
    det = det.with_nms(threshold=nms, class_agnostic=agnostic)
    if conf > 0:
        det = det[det.confidence >= conf]
    return det


def _poly(p):
    P = Polygon(np.asarray(p, float))
    if not P.is_valid:
        P = P.buffer(0)
    return P


def match(gt, tiles, thr=0.5):
    """Hungarian match on polygon IoU. Returns (tp, n_gt, n_pred, letter_correct)."""
    G = [_poly(p) for _, p in gt]
    D = [_poly(t["polygon"]) for t in tiles]
    if not G or not D:
        return 0, len(G), len(D), 0
    iou = np.zeros((len(G), len(D)))
    for i, g in enumerate(G):
        gb = g.bounds
        for j, d in enumerate(D):
            db = d.bounds
            if db[0] > gb[2] or db[2] < gb[0] or db[1] > gb[3] or db[3] < gb[1]:
                continue
            inter = g.intersection(d).area
            if inter > 0:
                iou[i, j] = inter / (g.area + d.area - inter)
    r, c = linear_sum_assignment(-iou)
    tp = correct = 0
    for i, j in zip(r, c):
        if iou[i, j] >= thr:
            tp += 1
            correct += gt[i][0] == tiles[j]["cls"]
    return tp, len(G), len(D), correct


def summarize(rows):
    tp = sum(r[1] for r in rows); ng = sum(r[2] for r in rows)
    nd = sum(r[3] for r in rows); cor = sum(r[4] for r in rows)
    return {"gt": ng, "det": nd, "tp": tp, "recall": tp / max(ng, 1), "precision": tp / max(nd, 1),
            "letter_acc": cor / max(tp, 1), "correct_tiles_over_gt": cor / max(ng, 1)}
