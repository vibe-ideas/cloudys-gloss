"""Build a bounded, reproducible general English-Chinese dictionary from ECDICT."""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

REVISION = 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b'
SHA256 = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'
source = Path(sys.argv[1])
if hashlib.sha256(source.read_bytes()).hexdigest() != SHA256:
    raise ValueError('ECDICT source checksum mismatch')
output = Path(__file__).resolve().parent.parent / 'public/dictionaries/definitions'
output.mkdir(parents=True, exist_ok=True)
entries = {}
with source.open() as handle:
    for row in csv.DictReader(handle):
        word = row['word'].strip().lower()
        text = row['translation'].replace('\\n', '\n').strip()
        # Frequency/tags select independently of evaluation words. No invented senses or IPA.
        if not (row['tag'] or row['oxford'] == '1' or any(0 < int(row[k] or '0') <= 50000 for k in ('bnc', 'frq'))):
            continue
        if not re.fullmatch(r"[a-z][a-z0-9 .'&+/-]{0,99}", word) or not re.search('[\u3400-\u9fff]', text):
            continue
        entries.setdefault(word, text[:4000])
rows = sorted(entries.items())
index = []
size = (len(rows) + 127) // 128
for offset in range(0, len(rows), size):
    file = f'{len(index)}.json'
    chunk = rows[offset:offset + size]
    (output / file).write_text(json.dumps(chunk, ensure_ascii=False, separators=(',', ':')) + '\n')
    index.append({'first': chunk[0][0], 'file': file})
(output / 'index.json').write_text(json.dumps({'version': 1, 'ranges': index}, separators=(',', ':')) + '\n')
(output / 'source.json').write_text(json.dumps({
    'repository': 'https://github.com/skywind3000/ECDICT', 'revision': REVISION,
    'inputSha256': SHA256, 'entries': len(rows), 'license': '../ecdict-license.txt',
    'selection': 'Chinese definition, ASCII headword, tag/oxford or BNC/FRQ rank 1–50000',
    'scope': 'General dictionary; not a context-specific technology glossary',
}, ensure_ascii=False, indent=2) + '\n')
print(f'{len(rows)} entries in {len(index)} ranges')
