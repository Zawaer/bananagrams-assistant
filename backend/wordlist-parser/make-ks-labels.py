"""Collect usage labels from Kielitoimiston sanakirja into ks-labels.tsv.

KS marks words like paku "ark." (colloquial) and nisti "slg." (slang). A
label can cover a whole entry or just one meaning, and a word can have
homonyms (eno: standard "uncle", dialect "river"). The house rules allow a
word if at least one of its meanings passes them, so for every word whose
meanings are all labelled we record each meaning's label set.

1. Candidates: the site's full-text search finds every occurrence of each
   label (capped at 5,000 hits, so "ark." is also searched per word class).
2. For each candidate in wordlist.txt, fetch the entry (all homonyms) and
   walk its sense tree; labels are inherited by sub-senses.

Output, one line per word with no unlabelled meaning:
  word <TAB> meaning label sets joined by "|", e.g.  muija  dk|s
  k = colloquial (ark., leik., last.)   s = slang (slg.)
  r = old, rare or poetic (vanh., harv., run.)
  d = derogatory or vulgar (halv., alat.)   m = dialect (murt.)
Words with any unlabelled (standard) meaning are left out: always allowed.

Responses are cached in ks-cache/ (not committed), so a rerun resumes.
Usage: python3 make-ks-labels.py [cache dir]
"""

import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

API = "https://www.kielitoimistonsanakirja.fi/api"
GROUP = {"ark": "k", "leik": "k", "last": "k", "slg": "s", "vanh": "r", "harv": "r", "run": "r",
         "halv": "d", "alat": "d", "murt": "m"}
CLASSES = ["substantiivi", "verbi", "adjektiivi", "adverbi", "numeraali", "interjektio", "pronomini"]
SCOPE = re.compile(r'<span class="kt-scope">([^<]*)</span>')
here = Path(__file__).parent
cache = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "ks-cache"
cache.mkdir(parents=True, exist_ok=True)
_token = None
PAUSE = 1.5  # seconds between requests; adapts to the site's rate limit
MIN_PAUSE, MAX_PAUSE = 1.0, 20.0
_ok_streak = 0


def request(path, **params):
    """GET an API path as JSON. Uses curl: the entry endpoint turns away
    unknown clients (Python's urllib included) but serves curl.

    The site throttles bursts, so failures back off patiently (up to five
    minutes between tries) instead of giving up."""
    global _token, PAUSE, _ok_streak
    delay = 60
    for attempt in range(12):
        code = "?"
        try:
            if _token is None:
                out = subprocess.run(["curl", "-sf", f"{API}/auth/anon-login"], capture_output=True, check=True, timeout=30)
                _token = json.loads(out.stdout)["access_token"]
            url = f"{API}{path}?{urllib.parse.urlencode(params)}"
            out = subprocess.run(["curl", "-s", "-w", "\n%{http_code}", "-H", f"Authorization: Bearer {_token}", url],
                                 capture_output=True, timeout=60)
            body, _, code = out.stdout.decode("utf-8", "replace").rpartition("\n")
            time.sleep(PAUSE)
            if code == "200":
                _ok_streak += 1
                if _ok_streak % 200 == 0 and PAUSE > MIN_PAUSE:
                    PAUSE = max(MIN_PAUSE, PAUSE * 0.9)  # going fine: a little faster
                return json.loads(body)
            if code == "429":
                # Too many requests: respect it by slowing down for good.
                PAUSE = min(MAX_PAUSE, PAUSE * 1.5)
                _ok_streak = 0
                print(f"    rate limited; pace now one request per {PAUSE:.1f}s", flush=True)
            if code in ("401", "403"):
                _token = None  # token expired: log in again
        except Exception as e:
            code = f"{type(e).__name__}"
        print(f"    {path} {params.get('keyword')}: {code}, retrying in {delay}s", flush=True)
        time.sleep(delay)
        delay = min(delay * 2, 300)
    raise RuntimeError(f"giving up on {path} {params}")


def candidates():
    words = set()
    keywords = [f"{l}." for l in GROUP] + [f"{c}, ark." for c in CLASSES]
    for kw in keywords:
        start = 0
        while True:
            page = request("/search/api/v1/fulltext_search", keyword=kw, baseforms="no", start=start, limit=500)
            words |= {k["clean_headword"].lower() for k in page["kwicList"]}
            if len(page["kwicList"]) < 500 or start >= 4500:
                break
            start += 500
        print(f"  {kw:22} candidates so far {len(words)}", flush=True)
    return words


def groups_of(definitions):
    out = set()
    for d in definitions:
        for scope in SCOPE.findall(d["definition"]):
            for part in re.split(r"[,\s]+", scope):
                g = GROUP.get(part.strip().rstrip("."))
                if g:
                    out.add(g)
    return out


def leaf_sets(senses, inherited):
    """Label sets of the leaf meanings, labels inherited down the tree."""
    out = []
    for s in senses:
        mine = inherited | groups_of(s["definitions"])
        out += leaf_sets(s["senses"], mine) if s.get("senses") else [mine]
    return out


def entry(word):
    f = cache / (urllib.parse.quote(word, safe="") + ".json")
    if not f.exists():
        f.write_text(json.dumps(request("/search/api/v1/search", keyword=word, searchMode="all")), encoding="utf-8")
    return json.loads(f.read_text(encoding="utf-8"))


def main():
    vocab = set((here / "wordlist.txt").read_text(encoding="utf-8").split())
    todo = sorted(w for w in candidates() if w in vocab)
    print(f"{len(todo)} candidate words in our dictionary", flush=True)
    rows = []
    for i, word in enumerate(todo):
        sets = []
        for e in entry(word):
            if e.get("clean_headword", "").lower() == word:
                sets += leaf_sets(e.get("senses", []), groups_of([]))
        if sets and all(sets):
            rows.append((word, "|".join(sorted({"".join(sorted(s)) for s in sets}))))
        if i % 250 == 0:
            print(f"  {i}/{len(todo)} fetched, {len(rows)} labelled", flush=True)
    with open(here / "ks-labels.tsv", "w", encoding="utf-8") as f:
        for w, sets in rows:
            f.write(f"{w}\t{sets}\n")
    print(f"{len(rows)} labelled words written to ks-labels.tsv")


if __name__ == "__main__":
    main()
