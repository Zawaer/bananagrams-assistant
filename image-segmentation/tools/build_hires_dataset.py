"""Build a YOLO-seg dataset from the full-resolution originals (shrunk to LONG px on
the long edge, as the app uploads them) with the Roboflow labels, which are
normalised and so apply unchanged. Splits follow the Roboflow export.

usage: build_hires_dataset.py [LONG=1600]   ->  $DETTOOLS/data/hires<LONG>/data.yaml
"""
import glob
import os
import shutil
import sys

import cv2

sys.path.insert(0, os.path.dirname(__file__))
from core import DS, ORIG, WORK, NAMES  # noqa: E402

LONG = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
OUT = f"{WORK}/data/hires{LONG}"
for split in ("train", "valid", "test"):
    os.makedirs(f"{OUT}/{split}/images", exist_ok=True)
    os.makedirs(f"{OUT}/{split}/labels", exist_ok=True)
    for lp in glob.glob(f"{DS}/{split}/labels/*.txt"):
        oid = os.path.basename(lp)[:-4].split("_jpg")[0]
        img = cv2.imread(f"{ORIG}/{oid}.jpg")
        h, w = img.shape[:2]
        s = min(1.0, LONG / max(h, w))
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(f"{OUT}/{split}/images/{oid}.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        shutil.copy(lp, f"{OUT}/{split}/labels/{oid}.txt")
with open(f"{OUT}/data.yaml", "w") as f:
    f.write(f"path: {OUT}\ntrain: train/images\nval: valid/images\ntest: test/images\n"
            f"nc: {len(NAMES)}\nnames: {NAMES}\n")
print("done", OUT)
