// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function evaluate(body: string) {
  const setup = `import importlib.util, sys, json, tempfile, zipfile\nfrom pathlib import Path\nspec = importlib.util.spec_from_file_location('release', sys.argv[1])\nrelease = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(release)\n`;
  return execFileSync('python3', ['-c', setup + body, path.resolve('scripts/release.py')], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('GitHub Release 发布保护', () => {
  it('版本标签与 package.json 一致时允许发布，标签错配或浏览器不支持的版本被拒绝', () => {
    const rejected = evaluate(`print(release.validate_version('0.1.0', 'v0.1.0'))\nfor version, tag in [('0.1.0','v0.2.0'),('1.0.0-beta.1','v1.0.0-beta.1'),('01.0.0','v01.0.0'),('65536.0.0','v65536.0.0'),('0.0.0','v0.0.0')]:\n    try:\n        release.validate_version(version, tag)\n    except ValueError:\n        print('rejected')`);
    expect(rejected.split('\n')).toEqual(['0.1.0', ...Array(5).fill('rejected')]);
  });

  it('两个浏览器 ZIP 通过检查后仅输出安装包、校验和及安装说明，明确 Firefox 未签名', () => {
    const result = JSON.parse(evaluate(`import hashlib\nwith tempfile.TemporaryDirectory() as folder:\n    root = Path(folder)\n    (root / '.output').mkdir()\n    for browser, mv in [('chrome',3),('firefox',2)]:\n        with zipfile.ZipFile(root / f'.output/cloudys-gloss-0.1.0-{browser}.zip','w') as z:\n            z.writestr('manifest.json',json.dumps({'version':'0.1.0','manifest_version':mv,'browser_specific_settings':{'gecko':{'id':'cloudys-gloss@local.dev'}}}))\n    import contextlib, io\n    with contextlib.redirect_stdout(io.StringIO()):\n        release.prepare(root,'0.1.0')\n    out = root / '.output/release'\n    valid = all(hashlib.sha256((out / line.split()[1]).read_bytes()).hexdigest() == line.split()[0] for line in (out/'SHA256SUMS').read_text().splitlines())\n    print(json.dumps({'files':sorted(p.name for p in out.iterdir()),'checksumsValid':valid,'notes':(out/'RELEASE_NOTES.md').read_text()}))`));
    expect(result.files).toEqual(['RELEASE_NOTES.md', 'SHA256SUMS', 'cloudys-gloss-0.1.0-chrome.zip', 'cloudys-gloss-0.1.0-firefox-unsigned.zip']);
    expect(result.checksumsValid).toBe(true);
    expect(result.notes).toContain('未签名');
  });

  it('压缩包内版本过旧或 Firefox ID 改变时拒绝发布，不能只靠文件名判断', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:\n    archive = Path(folder) / 'cloudys-gloss-0.1.0-firefox.zip'\n    for version, identity in [('0.0.9','cloudys-gloss@local.dev'),('0.1.0','wrong@example.com')]:\n        with zipfile.ZipFile(archive,'w') as z:\n            z.writestr('manifest.json',json.dumps({'version':version,'manifest_version':2,'browser_specific_settings':{'gecko':{'id':identity}}}))\n        try:\n            release.validate_archive(archive,'0.1.0',2)\n        except ValueError:\n            print('rejected')`);
    expect(result.split('\n')).toEqual(['rejected', 'rejected']);
  });
});
