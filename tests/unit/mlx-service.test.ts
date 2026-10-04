// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts/mlx-service.py');
function evaluate(body: string) {
  const setup = `import importlib.util, json, sys, io, contextlib, tempfile\nfrom pathlib import Path\nfrom unittest.mock import patch\nspec = importlib.util.spec_from_file_location('service', sys.argv[1])\nservice = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(service)\n`;
  return JSON.parse(execFileSync('python3', ['-c', setup + body, script], { encoding: 'utf8' }));
}

describe('macOS 本地模型服务管理', () => {
  it('用户目录含空格时，自启直接运行独立环境并且只监听本机', () => {
    const config = evaluate(`import plistlib\np = service.build_plist(Path('/Users/Reader With Spaces'))\nprint(json.dumps(plistlib.loads(plistlib.dumps(p))))`);
    const args: string[] = config.ProgramArguments;
    expect(args[0]).toBe('/Users/Reader With Spaces/Library/Application Support/CloudysGloss/mlx-venv/bin/python');
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect(args).not.toContain('sh');
    expect(config.EnvironmentVariables.HF_HUB_OFFLINE).toBe('1');
    expect(config.RunAtLoad).toBe(true);
    expect(config.KeepAlive).toBe(true);
  });

  it('用户停止服务后先禁用自启再卸载进程，避免立即重启或下次登录恢复', () => {
    const calls = evaluate(`calls = []\nwith patch.object(service, 'loaded', return_value=True), patch.object(service, 'run', side_effect=lambda *args, **kw: calls.append(args)), contextlib.redirect_stdout(io.StringIO()):\n    service.stop()\nprint(json.dumps(calls))`);
    expect(calls.map((call: string[]) => call.slice(0, 2))).toEqual([
      ['launchctl', 'disable'], ['launchctl', 'bootout'],
    ]);
  });

  it('其他程序占用模型端口时拒绝启动，不结束该程序也不启用自启', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:\n    location = Path(folder)\n    data, plist, _ = service.paths(location)\n    (data / 'mlx-venv/bin').mkdir(parents=True)\n    (data / 'mlx-venv/bin/python').touch()\n    plist.parent.mkdir(parents=True)\n    plist.touch()\n    with patch.object(service, 'loaded', return_value=False), patch.object(service, 'port_free', return_value=False), patch.object(service, 'run') as command:\n        try:\n            service.start(location)\n        except RuntimeError as error:\n            print(json.dumps({'error': str(error), 'commands': command.call_count}))`);
    expect(result.error).toContain('8080 端口已被其他服务占用');
    expect(result.commands).toBe(0);
  });
});
