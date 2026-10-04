#!/usr/bin/env python3
"""Build deterministic, offline US/UK IPA assets from pinned, checksum-verified sources."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "us": ("open-dict-data/ipa-dict", "43c3570eb3553bdd19fccd2bd0091534889af023", "data/en_US.txt", "2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67"),
    "uk": ("JoseLlarena/Britfone", "1062be14adc96c358f2087ac5449d72130c7a6f4", "britfone.main.3.0.1.csv", "59f197e98520856d1cc88e380beb54e4314d8712efc4d588b6778819c502d920"),
    "ipa-dict-license": ("open-dict-data/ipa-dict", "43c3570eb3553bdd19fccd2bd0091534889af023", "LICENSE", "2c6a7e4c71f834a8fc0114fa4f65ca85e80bc4b4dc7ed08746963a09a7b0d177"),
    "britfone-license": ("JoseLlarena/Britfone", "1062be14adc96c358f2087ac5449d72130c7a6f4", "LICENSE.txt", "ec93e71cd6fcdced20da7a0137bdfc1ff5fd8ea420d1fab332f95804668f9c49"),
    "cmudict-ipa-license": ("lingz/cmudict-ipa", "629483e9a7fa5b9ff11bb83e3fda6dcc25c5c511", "LICENSE", "a504bede5a50d1ac19c38984d9bb33371927f72e714946a963bf40bb2de21188"),
    "syllabify-license": ("kylebgorman/syllabify", "d816db784436e9de87ec1ef9bd11b8e229853710", "syllabify.py", "a9b35ed0bf2c1ef0b51396e9f6eb000904095b6cbac728f17dad6ad7663a96d6"),
    "cmudict-license": ("cmusphinx/cmudict", "74790861f652b15e4ac49015a90074ad62a27690", "LICENSE", "bd4ce8e44170a5f9f481310ca85c51de3c4f851a65e679b40e603b143bd3542a"),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def source(name, cache, offline):
    repo, revision, filename, checksum = SOURCES[name]
    url = f"https://raw.githubusercontent.com/{repo}/{revision}/{filename}"
    cached = cache / f"{name}-{checksum}.source"
    if cached.exists():
        raw = cached.read_bytes()
    else:
        if offline:
            raise RuntimeError(f"Missing offline source: {cached}")
        request = urllib.request.Request(url, headers={"User-Agent": "CloudysGloss-pronunciation-build"})
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read()
    if sha(raw) != checksum:
        raise RuntimeError(f"SHA256 mismatch: {name}")
    if not cached.exists():
        cached.write_bytes(raw)
    return raw.decode("utf-8"), {"repository": f"https://github.com/{repo}", "revision": revision,
                                 "source": url, "sha256": checksum}


def convert(text, dialect):
    entries = {}
    rows = (line.split("\t", 1) for line in text.splitlines()) if dialect == "us" else csv.reader(io.StringIO(text))
    for row in rows:
        if not row or not any(part.strip() for part in row):
            continue
        if len(row) != 2:
            raise RuntimeError(f"Invalid {dialect} dictionary row")
        word, pronunciation = row
        if dialect == "uk":
            word = re.sub(r"\(\d+\)$", "", word.strip()).replace("_", " ")
            pronunciation = "/" + "".join(pronunciation.split()) + "/"
        word = " ".join(unicodedata.normalize("NFC", word).strip().lower().split())
        if not word or "\t" in word or "\n" in word:
            raise RuntimeError("Invalid dictionary headword")
        variants = [value.strip() for value in pronunciation.split(",")]
        known = entries.setdefault(word, [])
        for variant in variants:
            if not variant.startswith("/") or not variant.endswith("/"):
                raise RuntimeError(f"Invalid pronunciation for {word}")
            if variant not in known:
                known.append(variant)
    # Match JavaScript's UTF-16 string comparison, including any non-BMP headwords.
    keys = sorted(entries, key=lambda key: key.encode("utf-16-be"))
    return "".join(f"{key}\t{', '.join(entries[key])}\n" for key in keys).encode("utf-8"), len(keys)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use previously verified local source downloads only")
    parser.add_argument("--cache", type=Path, default=ROOT / "artifacts/pronunciation-sources")
    parser.add_argument("--output", type=Path, default=ROOT / "public/dictionaries")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {"format": "sorted UTF-8 TSV, lowercase NFC headword, all pronunciations preserved",
                "version": 1, "sources": {}, "assets": {}}
    for dialect in ("us", "uk"):
        text, record = source(dialect, args.cache, args.offline)
        raw, count = convert(text, dialect)
        (args.output / f"{dialect}.tsv").write_bytes(raw)
        manifest["sources"][dialect] = record
        manifest["assets"][dialect] = {"file": f"{dialect}.tsv", "entries": count, "bytes": len(raw),
                                        "gzipBytes": len(gzip.compress(raw, mtime=0)), "sha256": sha(raw),
                                        "dialect": "General American" if dialect == "us" else "RP / Standard Southern British"}
    for name in SOURCES:
        if not name.endswith("-license"):
            continue
        text, record = source(name, args.cache, args.offline)
        if name == "syllabify-license":
            preamble = text.split("# syllabify.py:", 1)[0].splitlines()[1:]
            text = "\n".join(line.removeprefix("# ").removeprefix("#") for line in preamble).strip() + "\n"
        (args.output / f"{name}.txt").write_text(text, encoding="utf-8")
        manifest["sources"][name] = record
    (args.output / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["assets"], indent=2))


if __name__ == "__main__":
    main()
