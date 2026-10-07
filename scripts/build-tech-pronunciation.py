"""Compile the reviewed, attributed Wiktionary source excerpts without network access."""
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def compile_entries(manifest, base):
    entries = []
    provenance = []
    for source in manifest['sources']:
        word = source['word']
        if word in manifest['review']['excludedWords']:
            continue
        values = {'us': [], 'uk': [], 'general': []}
        selected = []
        for sound in source.get('sounds', []):
            ipa = sound['ipa']
            tags = set(sound.get('tags', []))
            # Do not expand abbreviated pronunciations, infer missing dialects,
            # strip stress, or turn narrow/regional/joking variants into defaults.
            if not (ipa.startswith('/') and ipa.endswith('/')) or '-' in ipa or sound.get('note') or tags & {'proscribed', 'dialectal'}:
                continue
            dialects = []
            if tags & {'US', 'General-American'}:
                dialects.append('us')
            if tags & {'UK', 'Received-Pronunciation'}:
                dialects.append('uk')
            if not tags:
                dialects.append('general')
            for dialect in dialects:
                if ipa not in values[dialect]:
                    values[dialect].append(ipa)
            if dialects:
                selected.append(sound)
        key = word.lower()
        for dialect in ['us', 'uk']:
            if key in base[dialect]:
                values[dialect] = []
        if key in base['us'] and key in base['uk']:
            values['general'] = []
        if not any(values.values()):
            continue
        ipa = {dialect: ', '.join(values[dialect]) for dialect in ['us', 'uk']}
        if values['general']:
            ipa['general'] = ', '.join(values['general'])
        if any(len(value) > 200 for value in ipa.values()):
            raise ValueError(f'Too many variants for {word}; review rather than truncate')
        entries.append({'word': key, 'ipa': ipa})
        provenance.append({key: source[key] for key in ['word', 'url', 'sha256']} | {'sounds': selected})
    assert len({entry['word'] for entry in entries}) == len(entries)
    return sorted(entries, key=lambda entry: entry['word']), provenance


def main():
    source_file = ROOT / 'data/pronunciation/technology-sources.json'
    manifest = json.loads(source_file.read_text())
    base = {dialect: dict(line.split('\t', 1) for line in (ROOT / f'public/dictionaries/{dialect}.tsv').read_text().splitlines()) for dialect in ['us', 'uk']}
    entries, sources = compile_entries(manifest, base)
    target = ROOT / 'public/dictionaries'
    asset = json.dumps({'version': 1, 'entries': entries}, ensure_ascii=False, separators=(',', ':')) + '\n'
    (target / 'technology.json').write_text(asset)
    attribution = {key: manifest[key] for key in ['source', 'license', 'licenseUrl', 'retrieved', 'review']}
    attribution.update({'sourceManifestSha256': hashlib.sha256(source_file.read_bytes()).hexdigest(),
                        'assetSha256': hashlib.sha256(asset.encode()).hexdigest(), 'entries': sources})
    (target / 'technology-sources.json').write_text(json.dumps(attribution, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(entries)} supplement entries, {len(asset.encode())} bytes; base US/UK files unchanged')


if __name__ == '__main__':
    main()
