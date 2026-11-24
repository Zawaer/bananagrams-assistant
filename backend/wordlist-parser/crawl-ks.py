"""Copy the whole Kielitoimiston sanakirja into a local cache, for personal use.

NOT IN USE. Tried in November 2026: the site allows about 25 requests per
burst and then blocks for most of an hour, about 25-100 entries an hour
sustained, so the whole dictionary would take months, and pushing harder
risks blocking the homelab's own live lookups. The app instead looks words
up one at a time when tapped and caches them (backend/segmentation/
ks_define.py), and can read a local copy through KS_LOCAL_DIR if one ever
exists. Kept for reference.

1. List every headword with the site's autocomplete (per first letter; when a
   prefix has more hits than one listing returns, per two-letter prefix,
   and so on). Saved to <cache>/headwords.json.
2. Fetch every headword's full search response (all homonyms, senses,
   examples, inflection tables, notes) and save it untouched as JSON, one
   file per headword in <cache>. Nothing is filtered at this stage.

The cache is NOT committed and must not be published: the dictionary is
copyrighted by Kotus and Kielikone. Already-fetched words are skipped, so
the crawl resumes after an interruption. One request at a time with a
pause, so the site barely notices.

Usage: python3 crawl-ks.py [cache dir]
"""

import importlib.util
import json
import sys
import time
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("ks", here / "make-ks-labels.py")
ks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ks)  # shares request(), entry() and the cache dir

LETTERS = "abcdefghijklmnopqrstuvwxyzåäö0123456789"
PAGE = 500
CAP = 5000  # a listing never returns more than this


def list_prefix(prefix, out):
    first = ks.request("/search/api/v1/autocomplete", keyword=prefix, limit=PAGE, start=0, searchMode="all")
    total = first.get("totalCount", first.get("count", 0))
    if first.get("overMaxLimit") or total > CAP:
        for ch in LETTERS + "-":
            list_prefix(prefix + ch, out)
        return
    page, start = first, 0
    while True:
        for r in page.get("result", []):
            out[r["clean_headword"]] = r["headword"]
        start += PAGE
        if start >= total or not page.get("result"):
            return
        page = ks.request("/search/api/v1/autocomplete", keyword=prefix, limit=PAGE, start=start, searchMode="all")


def headwords():
    path = ks.cache / "headwords.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    found: dict[str, str] = {}
    for ch in LETTERS:
        list_prefix(ch, found)
        print(f"  listed '{ch}': {len(found)} headwords so far", flush=True)
    path.write_text(json.dumps(found, ensure_ascii=False, indent=0), encoding="utf-8")
    return found


def main():
    words = sorted(headwords())
    print(f"{len(words)} headwords", flush=True)
    started, fetched = time.time(), 0
    for i, word in enumerate(words):
        f = ks.cache / (ks.urllib.parse.quote(word, safe="") + ".json")
        if f.exists():
            continue
        try:
            ks.entry(word)
            fetched += 1
        except RuntimeError as e:
            print(f"  skipped {word}: {e}", flush=True)
            time.sleep(30)
        if fetched and fetched % 500 == 0:
            rate = fetched / (time.time() - started)
            print(f"  {i}/{len(words)} headwords, {fetched} fetched this run, "
                  f"~{(len(words) - i) / max(rate, 0.01) / 3600:.1f} h left", flush=True)
    print(f"done: {len(words)} headwords, {fetched} fetched this run", flush=True)


if __name__ == "__main__":
    main()
