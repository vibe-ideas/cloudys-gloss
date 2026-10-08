import { useEffect, useState } from 'preact/hooks';
import { send } from '../core/messaging';
import type { LocalDefinition } from './store';

/** Try a word against enabled dictionaries. `version` changes whenever the library changes, which clears stale results. */
export function DictionaryLookup({ version }: { version: number }) {
  const [word, setWord] = useState(''); const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<LocalDefinition[]>([]); const [queried, setQueried] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setAnswers([]); setQueried(false); }, [version]);
  const lookup = async () => {
    if (busy || !word.trim()) return;
    setBusy(true); setError('');
    try { setAnswers(await send<LocalDefinition[]>({ type: 'lexicon:lookup', id: crypto.randomUUID(), word: word.trim() })); setQueried(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '查询失败'); }
    finally { setBusy(false); }
  };
  return <div class="lookup">
    <form class="search-row" role="search" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
      <input name="dictionaryQuery" aria-label="试查一个词" value={word} maxLength={200} placeholder="试查一个词，例如 algorithm、GPU"
        onInput={(event) => { setWord(event.currentTarget.value); setQueried(false); }} />
      <button type="button" aria-label="查询本地词库" disabled={busy || !word.trim()} onClick={() => void lookup()}>查询</button>
    </form>
    <div data-testid="dictionary-results" aria-live="polite">
      {error && <p class="error">{error}</p>}
      {queried && !answers.length && <p class="muted">已启用的词库没有收录这个词。</p>}
      {queried && answers.map((answer, index) => <details class="definition" open key={index}>
        <summary>{answer.headword}<span class="muted">{answer.dictionary}</span></summary>
        {answer.matchedAs !== answer.headword && <p class="muted">别名：{answer.matchedAs}</p>}
        {answer.phonetic && <p>词库读音（未标注口音）：{answer.phonetic}</p>}
        <p class="definition-text">{answer.text}</p>
        {answer.truncated && <small>长词条仅显示前 12,000 字符。</small>}
      </details>)}
    </div>
  </div>;
}
