"""Build wordlist-common.txt: the everyday subset of wordlist.txt.

The solver's "common" (legit) mode uses it so the grid looks like something
a person would build, rather than leaning on long, rare words.

A word is kept if it appears among the 50,000 most frequent Finnish words
(FrequencyWords, from OpenSubtitles; CC BY-SA 4.0, github.com/hermitdave/
FrequencyWords) and is at most MAX_LEN letters long. Only base forms match,
because wordlist.txt has no inflected forms.

Usage:
  curl -LO https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fi/fi_50k.txt
  python3 make-common-wordlist.py fi_50k.txt
"""

import sys
from pathlib import Path

MAX_LEN = 7
here = Path(__file__).parent

words = set((here / "wordlist.txt").read_text(encoding="utf-8").split())
frequent = [line.split()[0] for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if line.strip()]
common = sorted({w for w in frequent if w in words and len(w) <= MAX_LEN})

(here / "wordlist-common.txt").write_text("\n".join(common) + "\n", encoding="utf-8")
print(f"{len(common)} words written to wordlist-common.txt")
