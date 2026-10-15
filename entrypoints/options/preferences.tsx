import type { Settings } from '../../src/core/schema';
import { Row } from './field';
import type { SettingsForm } from './use-settings';

export function Preferences({ form: { settings, update } }: { form: SettingsForm }) {
  return <section id="preferences" tabIndex={-1} class="card" aria-labelledby="preferences-heading">
    <header class="card-head"><h2 id="preferences-heading">阅读偏好</h2></header>
    <div class="rows">
      <Row label="词卡与悬浮球外观" hint="更新后刷新网页生效。">
        <select name="theme" value={settings.theme} onChange={(event) => update('theme', event.currentTarget.value as Settings['theme'])}>
          <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
        </select>
      </Row>
      <Row label="输入框快捷翻译" hint="连按四下空格，把当前输入框译为英文并替换，可撤销；按 Esc 或继续输入即取消。">
        <select name="inputTranslation" value={String(settings.inputTranslation)} onChange={(event) => update('inputTranslation', event.currentTarget.value === 'true')}>
          <option value="true">开启</option><option value="false">关闭</option>
        </select>
      </Row>
      <Row label="本地模型按需启动" hint="翻译未命中缓存时，自动启动 8080 端口上的默认 MLX 模型。">
        <select name="autoStartLocalModel" value={String(settings.autoStartLocalModel)} onChange={(event) => update('autoStartLocalModel', event.currentTarget.value === 'true')}>
          <option value="true">开启</option><option value="false">仅手动</option>
        </select>
      </Row>
    </div>
  </section>;
}
