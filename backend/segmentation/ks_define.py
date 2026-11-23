"""Word definitions from Kielitoimiston sanakirja (KS), for tap-to-define.

Lookup order for a word:
  1. KS_LOCAL_DIR/<quoted word>.json   a local copy of the dictionary (the raw
                                       search responses from crawl-ks.py)
  2. DEFINE_CACHE_DIR/<quoted word>.json   an earlier answer from the site
  3. the KS site itself, once; the answer is saved to the cache, "not found"
     included, so no word is ever fetched twice.

The site rate-limits hard (a burst of ~25 requests, then minutes of 429), so
this makes one search request per new word, never retries in a loop, and
after a 429 stays away for a while instead of piling on. The search endpoint
turns away Python's HTTP clients but serves curl, so requests go through the
curl binary.

The dictionary is copyrighted (Kotus, Kielikone): nothing fetched here may be
committed or published, only shown to the person who asked.

Deliberately light: only the standard library, so /define never pulls in the
detection stack.
"""

import html
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
from pathlib import Path

API = "https://www.kielitoimistonsanakirja.fi/api"
CACHE_DIR = Path(os.environ.get("DEFINE_CACHE_DIR", "/models/ks-define"))
LOCAL_DIR = Path(os.environ["KS_LOCAL_DIR"]) if os.environ.get("KS_LOCAL_DIR") else None
COOLDOWN_SECONDS = 90  # after a 429, answer "busy" without asking the site
MAX_EXAMPLES = 2  # per sense: enough to show how the word is used
WORD_RE = re.compile(r"^[a-zåäöüéšž-]{1,40}$")

_lock = threading.Lock()  # one request to the site at a time
_tokens: dict = {}
_blocked_until = 0.0


class Busy(Exception):
    """The site is rate limiting us."""


class Unavailable(Exception):
    """The site could not be reached or answered something unexpected."""


def valid(word: str) -> bool:
    return bool(WORD_RE.match(word))


def _file(directory: Path, word: str) -> Path:
    return directory / (urllib.parse.quote(word, safe="") + ".json")


def _read(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, list) else None


def _curl(url: str, token: str | None = None) -> tuple[str, str]:
    """GET with curl, as curl (no custom user agent). Returns (status, body)."""
    cmd = ["curl", "-s", "--max-time", "15", "-w", "\n%{http_code}"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    try:
        out = subprocess.run(cmd + [url], capture_output=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise Unavailable(type(e).__name__) from e
    body, _, code = out.stdout.decode("utf-8", "replace").rpartition("\n")
    return code, body


def _check(code: str):
    global _blocked_until
    if code == "429":
        _blocked_until = time.monotonic() + COOLDOWN_SECONDS
        raise Busy()


def _token_file() -> Path:
    return CACHE_DIR / ".token.json"


def _login() -> str:
    """An anonymous access token. Kept on disk too, since the worker restarts
    whenever the detector unloads its model."""
    code, body = _curl(f"{API}/auth/anon-login")
    _check(code)
    if code != "200":
        raise Unavailable(f"login {code}")
    try:
        _tokens.update(json.loads(body))
    except ValueError as e:
        raise Unavailable("login: not JSON") from e
    try:
        _token_file().write_text(json.dumps(_tokens), encoding="utf-8")
    except OSError:
        pass
    return _tokens["access_token"]


def _access_token() -> str:
    if not _tokens.get("access_token"):
        try:
            _tokens.update(json.loads(_token_file().read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    return _tokens.get("access_token") or _login()


def _search(word: str) -> list:
    """The site's raw search response for a word: one request, or two plus a
    login when the saved token has expired."""
    if time.monotonic() < _blocked_until:
        raise Busy()
    url = f"{API}/search/api/v1/search?" + urllib.parse.urlencode({"keyword": word, "searchMode": "all"})
    code, body = _curl(url, _access_token())
    if code in ("401", "403"):
        code, body = _curl(url, _login())
    _check(code)
    if code != "200":
        raise Unavailable(f"search {code}")
    try:
        data = json.loads(body)
    except ValueError as e:
        raise Unavailable("search: not JSON") from e
    if not isinstance(data, list):
        raise Unavailable("search: unexpected answer")
    return data


def raw_entries(word: str) -> tuple[list, str]:
    """The search response for a word and where it came from."""
    if LOCAL_DIR:
        data = _read(_file(LOCAL_DIR, word))
        if data is not None:
            return data, "local"
    cached = _file(CACHE_DIR, word)
    data = _read(cached)
    if data is not None:
        return data, "cache"
    with _lock:
        data = _read(cached)  # fetched by another request meanwhile
        if data is not None:
            return data, "cache"
        data = _search(word)
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = cached.with_suffix(".part")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, cached)
        except OSError:
            pass  # still answer; it is just fetched again next time
        return data, "ks"


# ── Turning the site's HTML into plain text and labels ─────────────────────

SPAN = re.compile(r'<span class="(kt-[\w-]+)">((?:(?!<span).)*?)</span>', re.S)
TAG = re.compile(r"<[^>]+>")


def _text(fragment: str) -> str:
    text = html.unescape(TAG.sub("", fragment))
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:)])", r"\1", text)


def _labels(scope_html: str) -> list[str]:
    """'ark., halv.' -> ['ark.', 'halv.']; 'Kuv., us. leik.' stays two labels."""
    return [p.strip() for p in _text(scope_html).split(",") if p.strip()]


def _definition(fragment: str) -> tuple[str, list[str], str]:
    """(word class, usage labels, the definition itself) from one definition."""
    pos, labels = "", []

    def take(m):
        nonlocal pos
        cls, inner = m.group(1), m.group(2)
        if cls == "kt-pos":
            pos = pos or _text(inner).rstrip(", ")
            return ""
        if cls == "kt-scope":
            labels.extend(_labels(inner))
            return ""
        return inner

    rest = SPAN.sub(take, fragment)
    return pos, labels, _text(rest)


def _example(fragment: str) -> str:
    def take(m):
        cls, inner = m.group(1), m.group(2)
        if cls in ("kt-link", "kt-source"):
            return ""  # cross-references and quotation sources
        if cls == "kt-exampNote":
            note = _text(inner)
            return f" [{note}]" if note and not note.startswith("[") else f" {note}"
        return inner

    return _text(SPAN.sub(take, fragment))


def _sense(s: dict) -> dict:
    pos, labels, parts = "", [], []
    name_pos, name_labels, name = _definition(s.get("senseName") or "")
    for d in s.get("definitions") or []:
        p, l, t = _definition(d.get("definition") or "")
        pos = pos or p
        labels += l
        if t:
            parts.append(t)
    examples = [e for e in (_example(x.get("text") or "") for x in s.get("examples") or []) if e]
    out = {
        "num": name.rstrip("."),
        "pos": pos or name_pos,
        "labels": list(dict.fromkeys(name_labels + labels)),
        "text": " ".join(parts),
        "examples": examples[:MAX_EXAMPLES],
        "senses": [_sense(c) for c in s.get("senses") or []],
    }
    return out


def _prune(sense: dict) -> dict:
    sense["senses"] = [_prune(c) for c in sense["senses"]]
    return {k: v for k, v in sense.items() if v or k in ("num", "text")}


def _entry(e: dict) -> dict:
    """An entry as the app shows it. KS opens an entry with one or more
    unnamed senses that carry the word class, the labels for the whole word
    and sometimes a gloss of its own (akka: "eukko, muija"); the numbered
    meanings are their children or follow them. Those opening senses become
    the entry's header."""
    raw = list(e.get("senses") or [])
    pos, labels, text, examples, senses = "", [], [], [], []
    while raw and not (raw[0].get("senseName") or "").strip():
        top = _sense(raw.pop(0))
        pos = pos or top["pos"]
        labels += top["labels"]
        # Bare parenthesised notes are grammar and cross-references
        # ("(taivutusmuodoissa ...)"), not meaning: left to the site.
        if top["text"] and not (top["text"].startswith("(") and top["text"].endswith(")")):
            text.append(top["text"])
        examples += top["examples"]
        senses += top["senses"]
    senses += [_sense(s) for s in raw]
    out = {
        "homonym": e.get("homonym") or 0,
        "pos": pos,
        "labels": list(dict.fromkeys(labels)),
        "text": " ".join(text),
        "examples": examples[:MAX_EXAMPLES],
        "senses": [_prune(s) for s in senses],
    }
    return {k: v for k, v in out.items() if v or k in ("homonym", "senses")}


def define(word: str) -> dict:
    """The app's answer for a word. Raises Busy or Unavailable."""
    data, source = raw_entries(word)
    entries = [
        _entry(e)
        for e in data
        if isinstance(e, dict) and (e.get("clean_headword") or "").lower() == word
    ]
    return {"word": word, "found": bool(entries), "entries": entries, "source": source}
