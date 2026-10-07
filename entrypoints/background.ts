import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { ImportedDictionaryStore } from '../src/dictionaries/store';
import { defaults, RequestSchema, SettingsSchema, type Response } from '../src/schema';
import { PackagedPronunciationDictionary } from '../src/packaged-pronunciation';
import { NativeSpeech } from '../src/native-speech';
import { TranslationService } from '../src/service';
import { LocalModelManager, NATIVE_HOST, migrateManagedPreset } from '../src/local-model';

export default defineBackground(() => {
  const dictionaries = new ImportedDictionaryStore();
  let activeImports = 0;
  const nativeSpeech = new NativeSpeech((message) => browser.runtime.sendNativeMessage(NATIVE_HOST, message));
  const useNativeSpeech = import.meta.env.FIREFOX ? browser.runtime.getPlatformInfo().then(platform => platform.os === 'mac') : Promise.resolve(false);
  const localModel = new LocalModelManager((message) => browser.runtime.sendNativeMessage(NATIVE_HOST, message));
  const pronunciation = new PackagedPronunciationDictionary(async (path) => {
    const url = browser.runtime.getURL(`/dictionaries/${path}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('离线音标词典无法加载');
    return response.text();
  });
  const service = new TranslationService(undefined, (config, signal) => localModel.ensure(config, signal), pronunciation);
  const pending = new Map<string, { controller: AbortController; tabId?: number }>();
  const presetReady = (async () => {
    const stored = await browser.storage.local.get(['settings', 'modelPresetVersion']);
    if (stored.modelPresetVersion !== 2) {
      const current = SettingsSchema.parse(stored.settings ?? defaults);
      await browser.storage.local.set({ settings: migrateManagedPreset(current), modelPresetVersion: 2 });
    }
  })();
  const settings = async () => {
    await presetReady;
    return SettingsSchema.parse((await browser.storage.local.get('settings')).settings ?? defaults);
  };
  // Extension API activity keeps MV3 alive during slow local inference.
  const keepalive = setInterval(() => { if (pending.size || activeImports) void browser.runtime.getPlatformInfo(); }, 20000);
  void keepalive;
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'dictionary-import') {
      if (!port.sender?.url?.startsWith(browser.runtime.getURL('/'))) { port.disconnect(); return; }
      const controller = new AbortController(); let started = false;
      port.onDisconnect.addListener(() => controller.abort(new Error('导入窗口已关闭')));
      const post = (value: unknown) => { try { port.postMessage(value); } catch { controller.abort(); } };
      port.onMessage.addListener((raw: unknown) => {
        if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'cancel') { controller.abort(new Error('已取消导入，原有词库未受影响')); return; }
        if (started) return;
        const parsed = z.object({ type: z.literal('import'), id: z.string().uuid() }).safeParse(raw);
        if (!parsed.success) { post({ type: 'error', error: '无效的导入请求' }); return; }
        started = true; activeImports++;
        void dictionaries.import(parsed.data.id, controller.signal, data => post({ type: 'progress', data }))
          .then(data => post({ type: 'done', data }))
          .catch((error: unknown) => post({ type: 'error', error: error instanceof Error ? error.message : '词库导入失败' }))
          .finally(() => { activeImports--; });
      });
      return;
    }
    if (port.name !== 'translation-stream') return;
    const controller = new AbortController();
    let started = false; let key: string | undefined;
    const disconnect = () => { controller.abort(new Error('页面已关闭或停止翻译')); if (key) pending.delete(key); };
    port.onDisconnect.addListener(disconnect);
    const post = (message: unknown) => { if (!controller.signal.aborted) { try { port.postMessage(message); } catch { disconnect(); } } };
    port.onMessage.addListener((raw: unknown) => {
      if (started || controller.signal.aborted) return; started = true;
      const parsed = RequestSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== 'translate') { post({ type: 'error', error: '无效的翻译请求' }); return; }
      const request = parsed.data; const sender = port.sender;
      const owner = `${sender?.tab?.id ?? 'extension'}:${sender?.frameId ?? 0}:${sender?.documentId ?? ''}`;
      const candidate = `${owner}:${request.id}`;
      if (pending.has(candidate) || [...pending.keys()].filter((item) => item.startsWith(`${owner}:`)).length >= 12) {
        post({ type: 'error', error: '当前页面请求过多，请稍后重试' }); return;
      }
      key = candidate; pending.set(key, { controller, tabId: sender?.tab?.id });
      void (async () => {
        try {
          const config = await settings(); controller.signal.throwIfAborted();
          const translations = await service.translate(config, request.texts, controller.signal,
            (index, text, confirmed) => post({ type: 'item', index, text, confirmed }), request.bypassCache, request.priority);
          post({ type: 'done', translations });
        } catch (error) { post({ type: 'error', error: error instanceof Error ? error.message : '翻译失败' }); }
        finally { if (key) pending.delete(key); }
      })();
    });
  });
  browser.runtime.onMessage.addListener((raw, sender): Promise<Response<unknown>> | undefined => {
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) return undefined;
    const request = parsed.data;
    const owner = `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:${sender.documentId ?? ''}`;
    const privileged = !sender.tab && !!sender.url?.startsWith(browser.runtime.getURL('/'));
    return (async (): Promise<Response<unknown>> => {
      try {
        if (['lexicon:list', 'lexicon:delete', 'lexicon:enable', 'settings:get', 'settings:save', 'connection:test', 'cache:clear', 'model:control'].includes(request.type) && !privileged) {
          // Options tabs have a sender.tab on Firefox. Verify the extension origin too.
          if (!sender.url?.startsWith(browser.runtime.getURL('/'))) throw new Error('此操作仅允许在扩展设置页执行');
        }
        if (request.type === 'preferences') { const value = await settings(); return { ok: true, data: { theme: value.theme } }; }
        if (request.type === 'settings:get') return { ok: true, data: await settings() };
        if (request.type === 'lexicon:list') return { ok: true, data: await dictionaries.list() };
        if (request.type === 'lexicon:delete') { await dictionaries.remove(request.dictionaryId); return { ok: true, data: null }; }
        if (request.type === 'lexicon:enable') { await dictionaries.enable(request.dictionaryId, request.enabled); return { ok: true, data: null }; }
        if (request.type === 'settings:open') { await browser.runtime.openOptionsPage(); return { ok: true, data: null }; }
        if (request.type === 'settings:save') { await presetReady; await browser.storage.local.set({ settings: request.settings }); return { ok: true, data: null }; }
        if (request.type === 'cache:clear') { await service.clear(); return { ok: true, data: null }; }
        if (request.type === 'model:control') return { ok: true, data: await localModel.control(request.action, request.enabled) };
        const key = `${owner}:${request.id}`;
        if (request.type === 'cancel') { pending.get(key)?.controller.abort(new Error('请求已取消')); return { ok: true, data: null }; }
        if (pending.has(key)) throw new Error('重复请求');
        if ([...pending.keys()].filter((item) => item.startsWith(`${owner}:`)).length >= 12) throw new Error('当前页面请求过多，请稍后重试');
        const controller = new AbortController();
        pending.set(key, { controller, tabId: sender.tab?.id });
        try {
          if (request.type === 'lexicon:lookup') return { ok: true, data: await dictionaries.lookup(request.word, controller.signal) };
          if (request.type === 'pronunciation') {
            const ipa = await pronunciation.lookup(request.word, controller.signal);
            controller.signal.throwIfAborted();
            return { ok: true, data: ipa };
          }
          if (request.type === 'speech:play') {
            const native = await useNativeSpeech; controller.signal.throwIfAborted();
            return { ok: true, data: native ? await nativeSpeech.play(request.word, request.locale, controller.signal) : { backend: 'browser' } };
          }
          const config = request.type === 'connection:test' ? request.settings : await settings();
          const data = request.type === 'translate' ? await service.translate(config, request.texts, controller.signal, undefined, request.bypassCache, request.priority)
            : request.type === 'dictionary' ? await service.dictionary(config, request.word, request.context, controller.signal)
              : await service.test(config, controller.signal);
          return { ok: true, data };
        } finally { pending.delete(key); }
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '请求已取消' }; }
    })();
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    for (const job of pending.values()) if (job.tabId === tabId) job.controller.abort(new Error('页面已关闭'));
  });
});
