# Offline English pronunciation data

These assets contain pronunciation data only; they are not AI-generated definitions.

- `us.tsv`: General American, from [ipa-dict](https://github.com/open-dict-data/ipa-dict), based on CMUdict / cmudict-ipa with syllabify stress processing.
- `uk.tsv`: Received Pronunciation / Standard Southern British, from [Britfone](https://github.com/JoseLlarena/Britfone).
- `sources.json`: pinned upstream revisions, source SHA256 values, generated asset hashes and sizes.
- `*-license.txt`: complete upstream MIT and CMU license notices. The GPL-licensed `ipa-dict/en_UK` data is **not** included.

Rebuild with `python3 scripts/build-pronunciation.py`. Verified source downloads are cached in `artifacts/pronunciation-sources`; subsequent builds can use `--offline`. Only the build command downloads upstream data. The installed extension reads packaged files without an external dictionary API.

The generated UTF-8 TSV files are sorted by JavaScript UTF-16 string order. Headwords use lowercase NFC. Duplicate pronunciations are removed while distinct alternatives retain upstream order. Britfone's numbered pronunciation variants are collected under the same headword, underscores become word spaces, and phoneme-separator spaces are removed. No pronunciation is inferred from spelling or converted from one accent to another.

The two sources use different phonemic transcription conventions. For example, Britfone deliberately uses `/ɐ/` instead of traditional `/ʌ/`; these symbols are preserved. Multiple readings such as *read* and *record* are returned together because these datasets do not reliably map them to sentence context. Missing words, dialects or whole phrases remain missing. Separate word entries are not concatenated and presented as attested phrase pronunciations.

Upstream data can still contain errors and omissions. Dictionary provenance is not a claim of perfect coverage or accuracy.
