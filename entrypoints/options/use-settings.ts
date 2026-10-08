import { useEffect, useState } from 'preact/hooks';
import { defaults, SettingsSchema, type Settings } from '../../src/core/schema';
import { send } from '../../src/core/messaging';

export type Notice = { text: string; error: boolean };
export type SettingsForm = ReturnType<typeof useSettings>;
export type Update = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

/** Settings draft, its last saved copy, and the page-level actions that report into one status line. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [saved, setSaved] = useState<Settings>(defaults);
  const [notice, setNotice] = useState<Notice>({ text: '', error: false });
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  useEffect(() => {
    void send<Settings>({ type: 'settings:get' })
      .then((value) => { setSettings(value); setSaved(value); setReady(true); })
      .catch((error: Error) => setNotice({ text: error.message, error: true }));
  }, []);
  const replace = (next: Settings) => { setSettings(next); setNotice({ text: '', error: false }); };
  const update: Update = (key, value) => replace({ ...settings, [key]: value });
  const perform = async (action: 'save' | 'test' | 'clear') => {
    setBusy(true); setNotice({ text: action === 'test' ? '正在连接模型并验证翻译输出…' : '正在处理…', error: false });
    try {
      if (action === 'clear') { await send({ type: 'cache:clear' }); setNotice({ text: '本地翻译与词卡缓存已清空', error: false }); return; }
      const result = SettingsSchema.safeParse(settings);
      if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；'));
      if (action === 'save') {
        await send({ type: 'settings:save', settings: result.data }); setSaved(result.data);
        setNotice({ text: '设置已保存。新请求立即生效；主题更新请刷新网页。', error: false });
      } else {
        const started = performance.now(); await send({ type: 'connection:test', id: crypto.randomUUID(), settings: result.data });
        setNotice({ text: `连接成功，模型已返回有效中文译文 · ${((performance.now() - started) / 1000).toFixed(2)} 秒`, error: false });
      }
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '操作失败', error: true }); }
    finally { setBusy(false); }
  };
  return { settings, update, replace, perform, notice, busy, ready, dirty: ready && !same(settings, saved) };
}
