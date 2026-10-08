import { useEffect, useRef, useState } from 'preact/hooks';
import { send } from '../messaging';
import { importDictionary } from './client';
import { DictionaryLookup } from './lookup';
import type { ImportedDictionary } from './store';
import type { ImportProgress } from './stardict';

const MAX_DICTIONARIES = 5;
const ACCEPT = '.ifo,.idx,.dict,.syn,.gz,.dz';

export function DictionarySettings() {
  const [items, setItems] = useState<ImportedDictionary[]>([]);
  const [files, setFiles] = useState<File[]>([]); const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>();
  const [status, setStatus] = useState(''); const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState<string>();
  const [version, setVersion] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const refresh = async () => { setItems(await send<ImportedDictionary[]>({ type: 'lexicon:list' })); setVersion((value) => value + 1); };
  useEffect(() => { void refresh().catch((e: Error) => { setError(true); setStatus(e.message); }); return () => controller.current?.abort(); }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(false); setStatus('');
    try { await action(); } catch (e) { setError(true); setStatus(e instanceof Error ? e.message : '词库操作失败'); }
    finally { setBusy(false); setProgress(undefined); }
  };
  const importFiles = () => perform(async () => {
    const abort = new AbortController(); controller.current = abort;
    const result = await importDictionary(files, abort.signal, setProgress);
    await refresh(); setFiles([]); setStatus(`已导入「${result.name}」· ${result.entries.toLocaleString()} 条词条`);
  });
  return <section class="card" aria-labelledby="dictionary-heading">
    <header class="card-head split"><div><h2 id="dictionary-heading">我的离线词库</h2>
      <p class="muted">划词时先显示本地释义，AI 随后补充语境解释。词库只保存在当前浏览器，不会上传。</p></div>
      <span class="pill count" title="已导入词库数量">{items.length} / {MAX_DICTIONARIES}</span></header>
    <label class={`dropzone${dragging ? ' dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) setFiles(Array.from(event.dataTransfer?.files ?? [])); }}>
      <input class="visually-hidden" name="dictionaryFiles" type="file" multiple accept={ACCEPT} disabled={busy} onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))} />
      <strong>{files.length ? `已选择 ${files.length} 个文件` : '拖入或点击选择 StarDict 词库文件'}</strong>
      <small>{files.length ? files.map((file) => file.name).join('、') : '同时选择同名的 .ifo、.idx、.dict（可为压缩格式），有 .syn 时一起选择'}</small>
    </label>
    <details class="hint"><summary>支持的格式与限制</summary>
      <p class="muted">支持 StarDict 2.4.2 / 3.0.0 文本词库，.idx 与 .dict 可为 .gz / .dz 压缩；暂不支持 MDX、DSL 和音视频资源。最多 {MAX_DICTIONARIES} 个词库；单库 20 万条正文，正文解压后不超过 64 MiB，所选文件合计不超过 80 MiB。请保留词库原有的版权与来源信息。</p>
    </details>
    <div class="actions">
      <button type="button" class="primary" disabled={busy || !files.length} onClick={() => void importFiles()}>导入词库</button>
      {progress && <button type="button" onClick={() => { controller.current?.abort(new Error('已取消导入，原有词库未受影响')); setStatus('正在取消并清理未完成的导入…'); }}>取消导入</button>}
    </div>
    {progress && <div class="progress" aria-live="polite"><small>{progress.phase} · {progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</small><progress max={progress.total || 1} value={progress.completed} /></div>}
    <p data-testid="dictionary-status" class={error ? 'error' : 'muted'} aria-live="polite">{status}</p>
    <ul class="dictionary-list" data-testid="dictionary-list">
      {!items.length && <li class="muted empty">尚未导入词库。内置音标和 AI 词卡仍可照常使用。</li>}
      {items.map((item) => <li key={item.id} class={item.enabled ? '' : 'disabled'}>
        <div class="dictionary-meta"><strong>{item.name}</strong>
          <small>{item.entries.toLocaleString()} 条词条 · {(item.bytes / 1048576).toFixed(1)} MiB · {item.enabled ? '已启用' : '已停用'}</small>
          {item.description && <details><summary>词库说明与来源</summary><p class="description">{item.description}</p></details>}</div>
        <div class="dictionary-actions">{deleting === item.id ? <>
          <button type="button" class="danger" aria-label={`确认删除 ${item.name}`} disabled={busy} onClick={() => void perform(async () => {
            await send({ type: 'lexicon:delete', dictionaryId: item.id }); await refresh(); setDeleting(undefined); setStatus(`已删除「${item.name}」`);
          })}>确认删除</button>
          <button type="button" class="ghost" aria-label={`保留 ${item.name}`} disabled={busy} onClick={() => setDeleting(undefined)}>取消</button>
        </> : <>
          <button type="button" aria-label={`${item.enabled ? '停用' : '启用'} ${item.name}`} disabled={busy} onClick={() => void perform(async () => {
            await send({ type: 'lexicon:enable', dictionaryId: item.id, enabled: !item.enabled }); await refresh();
          })}>{item.enabled ? '停用' : '启用'}</button>
          <button type="button" class="ghost" aria-label={`删除 ${item.name}`} disabled={busy} onClick={() => setDeleting(item.id)}>删除</button>
        </>}</div>
      </li>)}
    </ul>
    <DictionaryLookup version={version} />
  </section>;
}
