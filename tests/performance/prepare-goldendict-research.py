"""Research assets only. Fixed StarDict snapshot + hash-pinned FOLDOC, never production assets.

python3 tests/performance/prepare-goldendict-research.py [--download]
"""
import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import tarfile
import urllib.request
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "artifacts/goldendict-research-2026-10-07"
OUTPUT = ROOT / "docs/performance/data/2026-10-07-goldendict"
SOURCES = {
    "freedict-eng-zho.stardict.tar.xz": {
        "url": "https://download.freedict.org/dictionaries/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.stardict.tar.xz",
        "sha512": "059f9aca26fdc3a5a2c0c0e8fc92e111a34bf8fd438f70d267cccf35f5e47a2d45c46650999a1b3a48c3bffc3e16e0db897232128fe822d1bc59cf34f40b395c",
    },
    "foldoc.txt": {
        "url": "https://foldoc.org/Dictionary",
        "sha256": "4e3f05d40ba976d804a69e8513a1e7b446500dded181662881bb0a152dac32b7",
    },
}


class PlainText(HTMLParser):
    """Research text view; NOT a sanitizer for rendering untrusted HTML."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(html):
    parser = PlainText()
    parser.feed(html)
    return " ".join(" ".join(parser.parts).split())


def load_stardict(data):
    # This measured snapshot is StarDict v3, 32-bit offsets, HTML articles, no .syn.
    # Deliberately reject other formats instead of implying a general importer.
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        def member(suffix):
            names = [m for m in archive.getmembers() if m.isfile() and m.name.endswith(suffix)]
            assert len(names) == 1, suffix
            return archive.extractfile(names[0]).read()
        info = dict(line.split("=", 1) for line in member(".ifo").decode().splitlines() if "=" in line)
        assert info["version"] == "3.0.0" and info["sametypesequence"] == "h"
        assert info.get("idxoffsetbits", "32") == "32"
        index = gzip.decompress(member(".idx.gz"))
        articles = member(".dict")
    assert len(index) == int(info["idxfilesize"])
    records, cursor, entries = {}, 0, 0
    while cursor < len(index):
        end = index.index(b"\0", cursor)
        word = index[cursor:end].decode("utf-8").lower()
        offset, length = struct.unpack_from(">II", index, end + 1)
        assert offset + length <= len(articles)
        records.setdefault(word, []).append(plain(articles[offset:offset + length].decode("utf-8")))
        cursor = end + 9
        entries += 1
    assert entries == int(info["wordcount"])
    return {w: " | ".join(values) for w, values in records.items()}, {
        "rawEntries": entries, "indexBytes": len(index), "articleBytes": len(articles), "info": info,
    }


def load_foldoc(text):
    records = {}
    matches = list(re.finditer(r"^([^\s].*)$", text, re.M))
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        word = match[1].lower()
        body = " ".join(text[match.end():end].split())
        records.setdefault(word, []).append(body)
    # Resolve only entries whose entire body is a single {cross-reference}.
    # Never use substring matches to count a missing headword as covered.
    def expand(body, seen):
        if alias := re.fullmatch(r"\{([^{}]+)\}", body):
            key = alias[1].lower()
            if key not in seen and key in records:
                return alias[1] + ": " + " | ".join(expand(value, seen | {key}) for value in records[key])
        return body
    return {word: " | ".join(expand(body, {word}) for body in bodies) for word, bodies in records.items()}


def write_assets(name, records):
    folder = ASSETS / name
    folder.mkdir(exist_ok=True)
    ordered = sorted(records.items())
    serialized = lambda rows: "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows).encode()
    full = serialized(ordered)
    (folder / "full.jsonl").write_bytes(full)
    count = math.ceil(len(ordered) / 64)
    index, compressed, largest = [], 0, 0
    for start in range(0, len(ordered), count):
        rows = ordered[start:start + count]
        file = f"{len(index)}.jsonl"
        blob = serialized(rows)
        (folder / file).write_bytes(blob)
        index.append({"first": rows[0][0], "file": file})
        compressed += len(gzip.compress(blob, mtime=0))
        largest = max(largest, len(blob.decode().encode("utf-16-le")))
    raw_index = json.dumps(index, separators=(",", ":")).encode()
    (folder / "index.json").write_bytes(raw_index)
    return {"uniqueHeadwords": len(records), "normalizedBytes": len(full),
            "normalizedGzipBytes": len(gzip.compress(full, mtime=0)),
            "rangeGzipBytes": compressed + len(gzip.compress(raw_index, mtime=0)),
            "maxShardUtf16Bytes": largest, "indexBytes": len(raw_index),
            "normalizedSha256": hashlib.sha256(full).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    ASSETS.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source_meta = {}
    for filename, spec in SOURCES.items():
        path = ASSETS / filename
        if args.download and not path.exists():
            path.write_bytes(urllib.request.urlopen(spec["url"], timeout=60).read())
        data = path.read_bytes()
        algorithm = "sha512" if "sha512" in spec else "sha256"
        assert hashlib.new(algorithm, data).hexdigest() == spec[algorithm], f"Source changed: {filename}; review before updating hash"
        source_meta[filename] = {**spec, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    freedict, info = load_stardict((ASSETS / "freedict-eng-zho.stardict.tar.xz").read_bytes())
    foldoc = load_foldoc((ASSETS / "foldoc.txt").read_text())
    # Current US data in the same normalized layout isolates dataset size effects.
    us = dict(line.split("\t", 1) for line in (ROOT / "public/dictionaries/us.tsv").read_text().splitlines())
    corpus_path = ROOT / "tests/performance/dictionary-tech-corpus.json"
    cases_path = ROOT / "tests/quality/offline-dictionary-cases.json"
    corpus = json.loads(corpus_path.read_text())
    cases = json.loads(cases_path.read_text())["cases"]
    results = {}
    for name, records in [("freedict", freedict), ("foldoc", foldoc), ("current-us", us)]:
        measurements = write_assets(name, records)
        measurements["coverage"] = {group: {"hits": sum(w.lower() in records for w in words), "total": len(words),
            "found": [w for w in words if w.lower() in records]} for group, words in corpus.items()}
        if name != "current-us":
            measurements["senseChecks"] = []
            for case in cases:
                body = records.get(case["word"].lower(), "")
                unresolved = name == "foldoc" and bool(re.fullmatch(r"\{[^{}]+\}", body))
                measurements["senseChecks"].append({"word": case["word"], "headwordFound": bool(body),
                    "unresolvedReferenceOnly": unresolved,
                    "conceptsPresent": not unresolved and all(any(term.lower() in body.lower() for term in group)
                        for group in case["concepts"])})
        results[name] = measurements
    (OUTPUT / "coverage.json").write_text(json.dumps({"snapshotDate": "2026-10-07", "sources": source_meta,
        "starDict": info,
        "inputsSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [corpus_path, cases_path, Path(__file__)]},
        "method": "Exact lowercase headword lookup; FOLDOC pure cross-reference aliases resolved, target headwords preserved; unresolved reference alone fails sense check. Counts are not accuracy. HTML reduced to text for research only; no assets shipped.",
        "datasets": results}, ensure_ascii=False, indent=2) + "\n")
    for name, result in results.items():
        print(name, "hits", sum(v["hits"] for v in result["coverage"].values()), "gzip", result["normalizedGzipBytes"],
              "senseConceptChecks", sum(v["conceptsPresent"] for v in result.get("senseChecks", [])))


if __name__ == "__main__":
    main()
