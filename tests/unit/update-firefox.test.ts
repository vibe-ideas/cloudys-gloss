// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function evaluate(body: string) {
  const setup = `import importlib.util, sys, json, tempfile, zipfile, subprocess, contextlib, io
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(sys.argv[1]).parent))
spec = importlib.util.spec_from_file_location('update_firefox', sys.argv[1])
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
def fixture(folder, version='0.1.0'):
    root = Path(folder) / 'Project With Spaces'
    root.mkdir()
    (root / 'package.json').write_text(json.dumps({'version':'0.1.0'}))
    (root / '.output').mkdir()
    with zipfile.ZipFile(root / '.output/cloudys-gloss-0.1.0-firefox.zip', 'w') as archive:
        archive.writestr('manifest.json', json.dumps({'version':version,'manifest_version':2,'browser_specific_settings':{'gecko':{'id':'cloudys-gloss@local.dev','update_url':updater.UPDATE_URL}}}))
    return root
`;
  return JSON.parse(execFileSync('python3', ['-c', setup + body, path.resolve('scripts/update-firefox.py')], { encoding: 'utf8' }));
}

describe('Firefox 本地更新', () => {
  it('检查与构建通过后打开校验后的 XPI，路径含空格仍指向正确文件', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:
    root = fixture(folder)
    app = Path(folder) / 'Firefox Developer Edition.app'; app.mkdir()
    with patch.object(updater.platform, 'system', return_value='Darwin'), patch.object(updater.shutil, 'which', return_value='/bin/pnpm'), patch.object(updater.subprocess, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
        xpi = updater.update(root, app=app)
    print(json.dumps({'steps':[call.args[0][1] for call in run.call_args_list], 'open':run.call_args.args[0], 'uri':xpi.as_uri(), 'same':xpi.read_bytes() == (root / '.output/cloudys-gloss-0.1.0-firefox.zip').read_bytes(), 'version':json.loads((root/'package.json').read_text())['version']}))`);
    expect(result.steps).toEqual(['check', 'zip:firefox', '-a']);
    expect(result.open).toEqual(['/usr/bin/open', '-a', expect.stringContaining('Firefox Developer Edition.app'), result.uri]);
    expect(result.uri).toContain('Project%20With%20Spaces');
    expect(result.same).toBe(true); expect(result.version).toBe('0.1.0');
  });
  it('检查或构建失败时停止更新，不打开浏览器也不生成旧包的安装副本', () => {
    const result = evaluate(`results = []
for failure in [1,2]:
    with tempfile.TemporaryDirectory() as folder:
        root = fixture(folder)
        effects = [None] * (failure - 1) + [subprocess.CalledProcessError(1, 'pnpm')]
        with patch.object(updater.shutil, 'which', return_value='/bin/pnpm'), patch.object(updater.subprocess, 'run', side_effect=effects) as run:
            try: updater.update(root, open_browser=False)
            except subprocess.CalledProcessError: pass
        results.append({'calls':run.call_count,'installed':(root/'.output/local-install').exists()})
print(json.dumps(results))`);
    expect(result).toEqual([{ calls: 1, installed: false }, { calls: 2, installed: false }]);
  });
  it('构建包版本不一致时拒绝安装；仅打包模式通过校验后保留 XPI 且不打开浏览器', () => {
    const result = evaluate(`results = []
for version in ['0.0.9','0.1.0']:
    with tempfile.TemporaryDirectory() as folder:
        root = fixture(folder, version)
        with patch.object(updater.shutil, 'which', return_value='/bin/pnpm'), patch.object(updater.subprocess, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
            try:
                xpi = updater.update(root, open_browser=False)
                results.append({'accepted':True,'exists':xpi.exists(),'calls':run.call_count})
            except ValueError:
                results.append({'accepted':False,'calls':run.call_count})
print(json.dumps(results))`);
    expect(result).toEqual([{ accepted: false, calls: 2 }, { accepted: true, exists: true, calls: 2 }]);
  });
});
