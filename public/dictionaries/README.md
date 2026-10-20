# Offline English pronunciation data

These assets contain offline pronunciation and general English-Chinese definitions; none are AI-generated.

## Definitions

`definitions/` contains 57,932 entries selected from [ECDICT](https://github.com/skywind3000/ECDICT)
at revision `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`, distributed under the included
`ecdict-license.txt` (MIT). `definitions/source.json` records the input checksum and selection rule.
Keep entries with Chinese definitions and upstream exam tags, Oxford flags, or BNC/FRQ rank
1–50,000. This selection is independent of test words. Only ASCII headwords of at most 100
characters are included; definitions are bounded to 4,000 characters. Exact case-insensitive
lookup does not guess lemmas or context-specific senses. Older technical meanings can be
incomplete: the UI labels these as general dictionary entries, separate from AI context.

Rebuild from the pinned upstream `ecdict.csv` with
`python3 scripts/build-definitions.py /path/to/ecdict.csv`. The command verifies the source
checksum, emits 128 sorted ranges, and does not access the network. Generated assets are
committed, so normal builds require no download. Background reads only the relevant range,
with at most two concurrent reads and a 256 KiB UTF-16 text cache budget (not total JS heap).

## Pronunciation

- `us.tsv`: General American, from [ipa-dict](https://github.com/open-dict-data/ipa-dict), based on CMUdict / cmudict-ipa with syllabify stress processing.
- `uk.tsv`: Received Pronunciation / Standard Southern British, from [Britfone](https://github.com/JoseLlarena/Britfone).
- `sources.json`: pinned upstream revisions, source SHA256 values, generated asset hashes and sizes.
- `*-license.txt`: complete upstream MIT and CMU license notices. The GPL-licensed `ipa-dict/en_UK` data is **not** included.

Rebuild with `python3 scripts/build-pronunciation.py`. Verified source downloads are cached in `artifacts/pronunciation-sources`; subsequent builds can use `--offline`. Only the build command downloads upstream data. The installed extension reads packaged files without an external dictionary API.

The generated UTF-8 TSV files are sorted by JavaScript UTF-16 string order. Headwords use lowercase NFC. Duplicate pronunciations are removed while distinct alternatives retain upstream order. Britfone's numbered pronunciation variants are collected under the same headword, underscores become word spaces, and phoneme-separator spaces are removed. No pronunciation is inferred from spelling or converted from one accent to another.

The two sources use different phonemic transcription conventions. For example, Britfone deliberately uses `/ɐ/` instead of traditional `/ʌ/`; these symbols are preserved. Multiple readings such as *read* and *record* are returned together because these datasets do not reliably map them to sentence context. Missing words, dialects or whole phrases remain missing. Separate word entries are not concatenated and presented as attested phrase pronunciations.

Upstream data can still contain errors and omissions. Dictionary provenance is not a claim of perfect coverage or accuracy.
