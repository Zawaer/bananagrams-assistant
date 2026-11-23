"""Build lexicon.tsv, the solver's dictionary with what its rules need.

One line per word in wordlist.txt:  word <TAB> classes <TAB> rank
  classes  word classes from the Kotus list, as letters:
           n = noun (substantiivi), v = verb, a = adjective, u = numeral,
           o = anything else (adverbs, interjections, ...)
           p = flag: plural form (housut, hautajaiset, ajovalot), for the
               "no plurals" rule
           x = flag: abbreviation or letter-name word (tv, oy, ry), dropped
               in legit mode
  rank     position in the 50,000 most frequent Finnish words
           (FrequencyWords, from OpenSubtitles; CC BY-SA 4.0,
           github.com/hermitdave/FrequencyWords), or 0 if not in it.
           Only base forms match, since wordlist.txt has no inflections.

Legit mode keeps words with 0 < rank <= its threshold; the other rules
filter on length and class.

Usage:
  curl -LO https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fi/fi_50k.txt
  python3 make-lexicon.py fi_50k.txt
"""

import csv
import sys
from pathlib import Path

here = Path(__file__).parent
CLASS = {
    "substantiivi": "n",
    "verbi": "v",
    "kieltoverbi": "v",
    "adjektiivi": "a",
    "numeraali": "u",
}

words = (here / "wordlist.txt").read_text(encoding="utf-8").split()

classes: dict[str, set[str]] = {}
with open(here / "nykysuomensanalista2024.txt", encoding="utf-8") as f:
    for row in list(csv.reader(f, delimiter="\t"))[1:]:
        for c in row[2].split(","):
            classes.setdefault(row[0].lower(), set()).add(CLASS.get(c.strip(), "o"))

# Plural-only words (housut, sakset, hautajaiset) are base forms in their own
# right, so they are in the list; Kotus doesn't flag them. They end in a vowel
# + t. Real singulars that do too are the kevät/olut (43, 44) and -nut/-nyt
# (47) inflection classes; a compound counts as singular if it ends in one.
SINGULAR_T_CLASSES = {"43", "44", "47"}
singular_t: set[str] = set()
with open(here / "nykysuomensanalista2024.txt", encoding="utf-8") as f:
    for row in list(csv.reader(f, delimiter="\t"))[1:]:
        if (row[3] or "").split("*")[0] in SINGULAR_T_CLASSES:
            singular_t.add(row[0].lower())
VOWELS = set("aeiouyäö")


def is_plural(w: str) -> bool:
    if len(w) < 3 or w[-1] != "t" or w[-2] not in VOWELS:
        return False
    if w.endswith(("nut", "nyt")):
        return False
    return not any(w.endswith(s) for s in singular_t)


rank: dict[str, int] = {}
for i, line in enumerate(Path(sys.argv[1]).read_text(encoding="utf-8").splitlines(), 1):
    if line.strip():
        rank.setdefault(line.split()[0], i)

with open(here / "lexicon.tsv", "w", encoding="utf-8") as out:
    for w in words:
        flags = "".join(sorted(classes.get(w, {"o"}))) + ("p" if is_plural(w) else "")
        # The only two-letter words in the list besides "ei" are
        # abbreviations and slang: bi, id, it, oy, ry, tv.
        if len(w) == 2 and w != "ei":
            flags += "x"
        out.write(f"{w}\t{flags}\t{rank.get(w, 0)}\n")
print(f"{len(words)} words written to lexicon.tsv")
