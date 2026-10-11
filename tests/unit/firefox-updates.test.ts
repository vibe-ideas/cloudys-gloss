// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function evaluate(body: string) {
  const setup = `import importlib.util, sys, json, tempfile, zipfile, hashlib
from pathlib import Path
spec = importlib.util.spec_from_file_location('updates', sys.argv[1])
updates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updates)
url = 'https://updates.example.com/updates.json'
link = 'https://updates.example.com/v0.2.0/addon.xpi'
def archive(folder, **overrides):
    manifest = {'version':'0.2.0','manifest_version':2,'browser_specific_settings':{'gecko':{'id':updates.ADDON_ID,'strict_min_version':'140.0','update_url':url}}}
    manifest.update(overrides)
    target = Path(folder) / 'addon.xpi'
    with zipfile.ZipFile(target, 'w') as package:
        package.writestr('manifest.json', json.dumps(manifest))
    return target
`;
  return JSON.parse(execFileSync('python3', ['-c', setup + body, path.resolve('scripts/firefox_updates.py')], { encoding: 'utf8' }));
}

describe('Firefox 自托管更新清单', () => {
  it('发布已配置更新地址的 XPI 时，清单指向该版本并携带真实校验和与浏览器兼容范围', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:
    target = archive(folder)
    manifest = updates.create_update_manifest(target, '0.2.0', url, link)
    print(json.dumps({'manifest':manifest,'hash':'sha256:'+hashlib.sha256(target.read_bytes()).hexdigest()}))`);
    expect(result.manifest).toEqual({ addons: { 'cloudys-gloss@local.dev': { updates: [{
      version: '0.2.0', update_link: 'https://updates.example.com/v0.2.0/addon.xpi',
      update_hash: result.hash, applications: { gecko: { strict_min_version: '140.0' } },
    }] } } });
  });

  it('XPI 版本、扩展 ID 或更新地址不匹配时拒绝生成清单，防止推送错包', () => {
    const result = evaluate(`results = []
with tempfile.TemporaryDirectory() as folder:
    for override in [{'version':'0.1.9'}, {'browser_specific_settings':{'gecko':{'id':'other@example.com','update_url':url}}}, {'browser_specific_settings':{'gecko':{'id':updates.ADDON_ID}}}, {'browser_specific_settings':{'gecko':{'id':updates.ADDON_ID,'update_url':'https://wrong.example.com/updates.json'}}}]:
        target = archive(folder, **override)
        try: updates.create_update_manifest(target, '0.2.0', url, link)
        except ValueError: results.append('rejected')
print(json.dumps(results))`);
    expect(result).toEqual(Array(4).fill('rejected'));
  });

  it('更新地址或安装包链接使用 HTTP、嵌入凭据或查询令牌时拒绝发布', () => {
    const result = evaluate(`results = []
with tempfile.TemporaryDirectory() as folder:
    target = archive(folder)
    for unsafe in ['http://updates.example.com/feed.json', 'https://user:secret@example.com/feed.json', 'https://example.com/feed.json?token=secret', 'https://example.com/feed.json#fragment', 'https://exa mple.com/feed.json']:
        for feed, package in [(unsafe,link),(url,unsafe)]:
            try: updates.create_update_manifest(target, '0.2.0', feed, package)
            except ValueError: results.append('rejected')
print(json.dumps(results))`);
    expect(result).toEqual(Array(10).fill('rejected'));
  });
});
