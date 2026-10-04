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
  it('下载包校验失败时拒绝解压，不创建可执行文件', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:\n    archive = Path(folder) / 'bad.tar.gz'\n    archive.write_bytes(b'corrupted')\n    destination = Path(folder) / 'runtime'\n    try: service.extract_runtime(archive, destination)\n    except RuntimeError as error: print(json.dumps({'error':str(error),'exists':destination.exists()}))`);
    expect(result.error).toContain('SHA256'); expect(result.exists).toBe(false);
  });
  it('新服务生成验证失败时恢复旧启动配置并重新启动原服务', () => {
    const result = evaluate(`import plistlib\nwith tempfile.TemporaryDirectory() as folder:\n    home = Path(folder)\n    plist = service.paths(home)[1]\n    plist.parent.mkdir(parents=True)\n    old = {'Label':service.LABEL,'ProgramArguments':['old-python','-m','mlx_lm.server'],'RunAtLoad':False,'KeepAlive':False}\n    plist.write_bytes(plistlib.dumps(old))\n    with patch.object(service, 'loaded', side_effect=[True, False]), patch.object(service, 'autostart_enabled', return_value=False), patch.object(service, 'assert_port_free'), patch.object(service, 'wait_unloaded'), patch.object(service, 'run'), patch.object(service, 'bootstrap') as bootstrap, patch.object(service, 'verify_generation', side_effect=RuntimeError('probe failed')):\n        try: service.activate(home, service.build_plist(home))\n        except RuntimeError: pass\n        print(json.dumps({'restored':plistlib.loads(plist.read_bytes()),'starts':bootstrap.call_count,'backup':plist.with_suffix('.before-mlx-serve.plist').exists()}))`);
    expect(result.restored.ProgramArguments).toEqual(['old-python', '-m', 'mlx_lm.server']);
    expect(result.restored.RunAtLoad).toBe(false); expect(result.restored.KeepAlive).toBe(false);
    expect(result.starts).toBe(2); expect(result.backup).toBe(true);
  });
  it('macOS 暂时拒绝重新注册服务时有限重试，成功后立即结束', () => {
    const result = evaluate(`from types import SimpleNamespace\nwith patch.object(service, 'run', side_effect=[SimpleNamespace(returncode=5, stderr='busy'), SimpleNamespace(returncode=0, stderr='')]) as run, patch.object(service.time, 'sleep') as sleep:\n    service.bootstrap(Path('/tmp'))\n    print(json.dumps({'attempts':run.call_count,'waits':sleep.call_count}))`);
    expect(result).toEqual({ attempts: 2, waits: 1 });
  });
  it('服务注册持续失败时停止重试并报告原因，避免无限等待', () => {
    const result = evaluate(`from types import SimpleNamespace\nwith patch.object(service, 'run', return_value=SimpleNamespace(returncode=5, stderr='denied')) as run, patch.object(service.time, 'sleep'):\n    try: service.bootstrap(Path('/tmp'))\n    except RuntimeError as error: print(json.dumps({'attempts':run.call_count,'error':str(error)}))`);
    expect(result.attempts).toBe(20); expect(result.error).toContain('denied');
  });
  it('用户目录含空格时，自启直接运行固定版本 mlx-serve 并且只监听本机', () => {
    const config = evaluate(`import plistlib\np = service.build_plist(Path('/Users/Reader With Spaces'))\nprint(json.dumps(plistlib.loads(plistlib.dumps(p))))`);
    const args: string[] = config.ProgramArguments;
    expect(args[0]).toBe('/Users/Reader With Spaces/Library/Application Support/CloudysGloss/mlx-serve/26.10.1/mlx-serve');
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect(args).not.toContain('sh');
    expect(args).not.toContain('mlx_lm.server');
    expect(args).toContain('--serve');
    expect(args[args.indexOf('--ctx-size') + 1]).toBe('8192');
    expect(config.EnvironmentVariables.MLX_SERVE_CACHE_LIMIT).toBe(String(256 * 1024 * 1024));
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
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:\n    location = Path(folder)\n    data, plist, _ = service.paths(location)\n    service.executable(location).parent.mkdir(parents=True)\n    service.executable(location).touch()\n    service.model_path(location).mkdir(parents=True)\n    (service.model_path(location) / 'config.json').touch()\n    plist.parent.mkdir(parents=True)\n    plist.touch()\n    with patch.object(service, 'loaded', return_value=False), patch.object(service, 'port_free', return_value=False), patch.object(service, 'run') as command:\n        try:\n            service.start(location)\n        except RuntimeError as error:\n            print(json.dumps({'error': str(error), 'commands': command.call_count}))`);
    expect(result.error).toContain('8080 端口已被其他服务占用');
    expect(result.commands).toBe(0);
  });
});
