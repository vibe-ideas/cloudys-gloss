"""Measure fixed dictionary snapshots; generate local-only assets for browser benchmarks.

No runtime dictionary replacement. Outputs include source hashes and per-word matches.
Usage: python3 tests/performance/prepare-dictionary-research.py [--download]
"""
import argparse
import csv
import gzip
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'artifacts/dictionary-research-2026-10-07'
REPORT = ROOT / 'docs/performance/data/2026-10-07-dictionaries'
SOURCES = {
    'wikipron-us.tsv': ('CUNY-CL/wikipron', 'd282e848a211ea31cfd730f0ced8bc8cdab9e83d', 'data/scrape/tsv/eng_latn_us_broad.tsv', 'f304b8f0565466e8abfe4c04a30d99421e1590d2aa17c4a08ebfa5942c587e75'),
    'wikipron-uk.tsv': ('CUNY-CL/wikipron', 'd282e848a211ea31cfd730f0ced8bc8cdab9e83d', 'data/scrape/tsv/eng_latn_uk_broad.tsv', 'f8ca476aa2e96cb22cafbf9099d689b5902a9d321579055081909b2eeafa1b8d'),
    'ecdict.csv': ('skywind3000/ECDICT', 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b', 'ecdict.csv', '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'),
    'cmudict.dict': ('cmusphinx/cmudict', '74790861f652b15e4ac49015a90074ad62a27690', 'cmudict.dict', '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22'),
}


def bucket(word):
    value = 2166136261
    data = word.encode('utf-16-le')
    for offset in range(0, len(data), 2):
        value = ((value ^ int.from_bytes(data[offset:offset+2], 'little')) * 16777619) & 0xffffffff
    return value % 64


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    ASSETS.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)
    sources = []
    for name, (repo, revision, path, digest) in SOURCES.items():
        url = f'https://raw.githubusercontent.com/{repo}/{revision}/{path}'
        target = ASSETS / name
        if not target.exists() and args.download:
            with urllib.request.urlopen(url, timeout=120) as response:
                target.write_bytes(response.read())
        raw = target.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest, name
        sources.append(dict(file=name, url=url, sha256=digest, bytes=len(raw)))

    dictionaries = {}
    for dialect in ['us', 'uk']:
        path = ROOT / f'public/dictionaries/{dialect}.tsv'
        raw = path.read_bytes()
        sources.append(dict(file=str(path.relative_to(ROOT)), sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw)))
        dictionaries['current-' + dialect] = dict(line.split('\t', 1) for line in raw.decode().splitlines())
        entries = {}
        for line in (ASSETS / f'wikipron-{dialect}.tsv').read_text().splitlines():
            word, pronunciation = line.split('\t')
            variants = entries.setdefault(word.lower(), [])
            ipa = '/' + pronunciation.replace(' ', '') + '/'
            if ipa not in variants:
                variants.append(ipa)
        dictionaries['wikipron-' + dialect] = {key: ', '.join(values) for key, values in entries.items()}

    ecdict = {}
    all_ecdict = {}
    definition_audit = {}
    compact_all = []
    compact_core = []
    with (ASSETS / 'ecdict.csv').open() as source:
        for row in csv.DictReader(source):
            word = row['word'].lower()
            all_ecdict[word] = bool(row['translation'])
            compact = json.dumps([row['word'], row['phonetic'], row['translation']], ensure_ascii=False, separators=(',', ':')) + '\n'
            compact_all.append(compact)
            if any(row[key] and float(row[key]) > 0 for key in ['bnc', 'frq', 'collins', 'oxford']) or row['tag']:
                compact_core.append(compact)
            if word in ['typescript', 'docker', 'rag', 'token', 'transformer', 'inference', 'embedding', 'gpu', 'llm']:
                definition_audit[row['word']] = row['translation']
            if row['phonetic'].strip():
                ecdict[word] = row['phonetic'].strip()
    dictionaries['ecdict-phonetic'] = ecdict
    cmu = {}
    for line in (ASSETS / 'cmudict.dict').read_text().splitlines():
        word, phones = line.split(' ', 1)
        word = re.sub(r'\(\d+\)$', '', word).lower()
        cmu.setdefault(word, []).append(phones.split('#', 1)[0].strip())
    dictionaries['cmudict-arpabet'] = {key: ', '.join(values) for key, values in cmu.items()}

    corpus = json.loads((ROOT / 'tests/performance/dictionary-tech-corpus.json').read_text())
    stats = {}
    for name, entries in dictionaries.items():
        # Match JavaScript code-unit sorting rather than locale-aware ordering.
        pairs = sorted(entries.items(), key=lambda item: item[0].encode('utf-16-be'))
        text = ''.join(key + '\t' + value.replace('\n', ' ').replace('\t', ' ') + '\n' for key, value in pairs)
        (ASSETS / f'{name}.normalized.tsv').write_text(text)
        shards = [''] * 64
        for line in text.splitlines(keepends=True):
            shards[bucket(line.split('\t', 1)[0])] += line
        shard_dir = ASSETS / (name + '-shards')
        shard_dir.mkdir(exist_ok=True)
        for index, shard in enumerate(shards):
            (shard_dir / f'{index}.tsv').write_text(shard)
        # Range shards preserve adjacent vocabulary and compress better than hashing.
        lines = text.splitlines(keepends=True)
        chunk_size = (len(lines) + 63) // 64
        ranges = [''.join(lines[index:index+chunk_size]) for index in range(0, len(lines), chunk_size)]
        range_dir = ASSETS / (name + '-ranges')
        range_dir.mkdir(exist_ok=True)
        starts = [chunk.split('\t', 1)[0] for chunk in ranges]
        (range_dir / 'index.json').write_text(json.dumps(starts, ensure_ascii=False))
        for index, shard in enumerate(ranges):
            (range_dir / f'{index}.tsv').write_text(shard)
        stats[name] = dict(entries=len(entries), bytes=len(text.encode()), gzipBytes=len(gzip.compress(text.encode(), mtime=0)),
                           shardGzipBytes=sum(len(gzip.compress(s.encode(), mtime=0)) for s in shards),
                           rangeGzipBytes=sum(len(gzip.compress(s.encode(), mtime=0)) for s in ranges) + len(gzip.compress(json.dumps(starts, ensure_ascii=False).encode(), mtime=0)),
                           maxRangeUtf16Bytes=max(len(s.encode('utf-16-le')) for s in ranges),
                           maxShardUtf16Bytes=max(len(s.encode('utf-16-le')) for s in shards),
                           entriesWithStress=sum('ˈ' in v or 'ˌ' in v for v in entries.values()),
                           groups={group: dict(total=len(words), matches={word: entries[word.lower()] for word in words if word.lower() in entries}) for group, words in corpus.items()})
    summary = dict(scope='101 hand-picked technology terms; lowercase exact headword matching, NOT pronunciation accuracy or article-weighted coverage',
                   sources=sources, dictionaries=stats, ecdictTotalHeadwords=len(all_ecdict),
                   ecdictChineseDefinitions=sum(all_ecdict.values()),
                   ecdictDefinitionAudit=definition_audit,
                   ecdictCompactSizes={name: dict(entries=len(rows), bytes=len(''.join(rows).encode()), gzipBytes=len(gzip.compress(''.join(rows).encode(), mtime=0))) for name, rows in [('all', compact_all), ('frequency-or-tagged', compact_core)]},
                   ecdictDefinitionMatches={group: [word for word in words if all_ecdict.get(word.lower())] for group, words in corpus.items()})
    (REPORT / 'coverage.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    for name, stat in stats.items():
        print(name, stat['entries'], stat['bytes'], stat['gzipBytes'], 'stress', stat['entriesWithStress'],
              {group: len(value['matches']) for group, value in stat['groups'].items()})


if __name__ == '__main__':
    main()
