import { useEffect, useRef, useState } from 'preact/hooks';
import { send } from '../messaging';
import { importDictionary } from './client';
import type { ImportedDictionary, LocalDefinition } from './store';
import type { ImportProgress } from './stardict';

export function DictionarySettings() {
  const [items, setItems] = useState<ImportedDictionary[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<ImportProgress>();
  const [status, setStatus] = useState(''); const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false); const [word, setWord] = useState('');
  const [answers, setAnswers] = useState<LocalDefinition[]>([]); const [queried, setQueried] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);
  const refresh = async () => setItems(await send<ImportedDictionary[]>({ type: 'lexicon:list' }));
  useEffect(() => { void refresh().catch((e: Error) => { setError(true); setStatus(e.message); }); return () => controller.current?.abort(); }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(false); setStatus('');
    try { await action(); } catch (e) { setError(true); setStatus(e instanceof Error ? e.message : '词库操作失败'); }
    finally { setBusy(false); setProgress(undefined); }
  };
  return <section class="card" aria-labelledby="dictionary-heading">
    <h2 id="dictionary-heading">我的离线词库</h2>
    <p class="muted">划词后先看本地词库释义，AI 随后补充语境解释。词库文件保存在当前浏览器，不上传到模型服务。</p>
    <label>选择词库文件<input name="dictionaryFiles" type="file" multiple accept=".ifo,.idx,.dict,.syn,.gz,.dz" disabled={busy}
      onChange={event => setFiles(Array.from(event.currentTarget.files ?? []))} /></label>
    <p class="muted"><small>先解压下载包，再同时选择同名的 .ifo、.idx（或 .idx.gz）、.dict（或 .dict.dz / .dict.gz），有 .syn 时一起选择。支持 StarDict 2.4.2 / 3.0.0 文本词库；暂不支持 MDX、DSL 和音视频资源。</small></p>
    <p class="muted"><small>最多 5 个词库；单库 20 万条正文，正文解压后不超过 64 MiB，所选文件合计不超过 80 MiB。保留词库原有版权与来源信息。</small></p>
    <div class="actions">
      <button type="button" class="primary" disabled={busy || !files.length} onClick={() => void perform(async () => {
        const abort = new AbortController(); controller.current = abort;
        const result = await importDictionary(files, abort.signal, setProgress);
        await refresh(); setAnswers([]); setQueried(false); setStatus(`已导入「${result.name}」· ${result.entries.toLocaleString()} 条词条`);
      })}>导入词库</button>
      {progress && <button type="button" onClick={() => { controller.current?.abort(new Error('已取消导入，原有词库未受影响')); setStatus('正在取消并清理未完成的导入…'); }}>取消导入</button>}
    </div>
    {progress && <div aria-live="polite"><p>{progress.phase} · {progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</p><progress max={progress.total || 1} value={progress.completed} style={{ width: '100%' }} /></div>}
    <p data-testid="dictionary-status" class={error ? 'error' : 'muted'} aria-live="polite">{status}</p>
    <div data-testid="dictionary-list">
      {!items.length && <p class="muted">尚未导入词库。内置音标和 AI 词卡仍可照常使用。</p>}
      {items.map(item => <article key={item.id} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '16px 0', overflowWrap: 'anywhere' }}>
        <strong>{item.name}</strong><p class="muted">{item.entries.toLocaleString()} 条词条 · {(item.bytes / 1048576).toFixed(1)} MiB 原始正文与索引 · {item.enabled ? '已启用' : '已停用'}</p>
        {item.description && <details><summary>词库说明与来源</summary><p style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{item.description}</p></details>}
        <div class="actions">
          <button type="button" disabled={busy} onClick={() => void perform(async () => {
            await send({ type: 'lexicon:enable', dictionaryId: item.id, enabled: !item.enabled }); await refresh(); setAnswers([]); setQueried(false);
          })}>{item.enabled ? '停用' : '启用'} {item.name}</button>
          {deleting === item.id ? <><button type="button" disabled={busy} onClick={() => void perform(async () => {
            await send({ type: 'lexicon:delete', dictionaryId: item.id }); await refresh(); setDeleting(undefined); setAnswers([]); setQueried(false); setStatus(`已删除「${item.name}」`);
          })}>确认删除 {item.name}</button><button type="button" disabled={busy} onClick={() => setDeleting(undefined)}>保留词库</button></> :
            <button type="button" disabled={busy} onClick={() => setDeleting(item.id)}>删除 {item.name}</button>}
        </div>
      </article>)}
    </div>
    <label>试查一个词<input name="dictionaryQuery" value={word} maxLength={200} placeholder="例如 algorithm、GPU" onInput={event => { setWord(event.currentTarget.value); setQueried(false); }} /></label>
    <div class="actions"><button type="button" disabled={busy || !word.trim()} onClick={() => void perform(async () => {
      setAnswers(await send<LocalDefinition[]>({ type: 'lexicon:lookup', id: crypto.randomUUID(), word: word.trim() })); setQueried(true);
    })}>查询本地词库</button></div>
    <div data-testid="dictionary-results" aria-live="polite">{queried && !answers.length && <p class="muted">已启用的词库没有收录这个词。</p>}
      {queried && answers.map((answer, index) => <details open key={index}><summary>{answer.dictionary} · {answer.headword}</summary>
        {answer.matchedAs !== answer.headword && <p class="muted">别名：{answer.matchedAs}</p>}
        {answer.phonetic && <p>词库读音（未标注口音）：{answer.phonetic}</p>}
        <p style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', overflowWrap: 'anywhere' }}>{answer.text}</p>
        {answer.truncated && <small>长词条仅显示前 12,000 字符。</small>}
      </details>)}
    </div>
  </section>;
}
