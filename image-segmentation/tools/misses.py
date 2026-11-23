"""Find tiles the detector missed in the unlabelled photos: cream tile-coloured
pixels not covered by any detected tile are painted magenta and boxed.

usage: misses.py MODEL TAG [imgsz=640] [conf=0.8] [nms=0.8] [agnostic=0]
Writes $DETTOOLS/out/TAG_miss{1,2}.jpg.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from core import REPO, WORK, app_shrink, raw_detect, server_post, to_tiles  # noqa: E402
from ultralytics import YOLO  # noqa: E402

model, tag = sys.argv[1], sys.argv[2]
imgsz = int(sys.argv[3]) if len(sys.argv) > 3 else 640
conf = float(sys.argv[4]) if len(sys.argv) > 4 else 0.8
nms = float(sys.argv[5]) if len(sys.argv) > 5 else 0.8
agn = len(sys.argv) > 6 and sys.argv[6] == "1"
m = YOLO(model, task="segment")
os.makedirs(f"{WORK}/out", exist_ok=True)
for k in (1, 2):
    img = app_shrink(cv2.imread(f"{REPO}/image-segmentation/test{k}.jpg"))
    det, _ = raw_detect(m, img, imgsz=imgsz, conf=0.05)
    tiles = to_tiles(server_post(det, nms, conf, agn))
    cov = np.zeros(img.shape[:2], np.uint8)
    for t in tiles:
        cv2.fillPoly(cov, [np.array(t["polygon"], np.int32)], 255)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    cream = ((hsv[..., 2] > 150) & (hsv[..., 1] < 90)).astype(np.uint8) * 255
    un = cv2.morphologyEx(cream & ~cov, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    n, _, st, _ = cv2.connectedComponentsWithStats(un)
    out = img.copy()
    for t in tiles:
        p = np.array(t["polygon"], np.int32)
        cv2.polylines(out, [p], True, (0, 255, 0), 1)
        x, y = p.min(0)
        cv2.putText(out, m.names[t["cls"]], (int(x), int(y) + 14), 0, 0.5, (255, 0, 0), 1)
    out[un > 0] = (255, 0, 255)
    big = [i for i in range(1, n) if st[i, 4] > 400]
    for i in big:
        x, y, bw, bh, _ = st[i]
        cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 0, 255), 2)
    cv2.imwrite(f"{WORK}/out/{tag}_miss{k}.jpg", out)
    print(f"test{k}: {len(tiles)} tiles, {len(big)} uncovered cream blobs >400px")
