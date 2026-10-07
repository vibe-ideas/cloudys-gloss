import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Build sorted ranges without shipping a second full copy of each dictionary. */
export async function generateDictionaryAssets(root: string, output: string) {
  await mkdir(output, { recursive: true });
  const assets: { absoluteSrc: string; relativeDest: string }[] = [];
  const dialects: Record<string, { first: string; file: string }[]> = {};
  for (const dialect of ['us', 'uk']) {
    const text = await readFile(resolve(root, `public/dictionaries/${dialect}.tsv`), 'utf8');
    const lines = text.trimEnd().split('\n');
    const size = Math.ceil(lines.length / 64);
    dialects[dialect] = [];
    for (let offset = 0; offset < lines.length; offset += size) {
      const file = `${dialect}-${dialects[dialect].length}.tsv`;
      const chunk = lines.slice(offset, offset + size).join('\n') + '\n';
      const absoluteSrc = resolve(output, file);
      await writeFile(absoluteSrc, chunk);
      dialects[dialect].push({ first: lines[offset]!.split('\t')[0]!, file });
      assets.push({ absoluteSrc, relativeDest: `dictionaries/ranges/${file}` });
    }
  }
  const absoluteSrc = resolve(output, 'index.json');
  await writeFile(absoluteSrc, JSON.stringify({ version: 1, dialects }));
  assets.push({ absoluteSrc, relativeDest: 'dictionaries/ranges/index.json' });
  return assets;
}
