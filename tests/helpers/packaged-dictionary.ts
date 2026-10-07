import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateDictionaryAssets } from '../../scripts/dictionary-assets';
import { PackagedPronunciationDictionary } from '../../src/packaged-pronunciation';

/** Test the same packaged data and reader used by background, never test-only IPA answers. */
export async function packagedDictionary() {
  const output = resolve('artifacts/dictionary-test-assets');
  await mkdir(output, { recursive: true });
  await generateDictionaryAssets(process.cwd(), output);
  return new PackagedPronunciationDictionary(path => readFile(path.startsWith('ranges/')
    ? resolve(output, path.slice(7)) : resolve('public/dictionaries', path), 'utf8'));
}
