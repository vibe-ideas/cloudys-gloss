// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function evaluate(body: string) {
  const setup = `import importlib.util, json, io, struct, tempfile, contextlib\nfrom pathlib import Path\nfrom unittest.mock import patch\nspec = importlib.util.spec_from_file_location('host', 'scripts/native-host.py')\nhost = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(host)\n`;
  return JSON.parse(execFileSync('python3', ['-c', setup + body], { encoding: 'utf8' }));
}
describe('浏览器本地模型助手', () => {
  it('旧版命令行暂停自启后，助手识别 launchd 的布尔与文字禁用状态', () => {
    const result = evaluate(`import plistlib\nfrom types import SimpleNamespace\nvalues = []\nwith tempfile.TemporaryDirectory() as folder:\n    home = Path(folder)\n    plist = host.service.paths(home)[1]\n    plist.parent.mkdir(parents=True)\n    plist.write_bytes(plistlib.dumps({'RunAtLoad':True}))\n    for value in ['true', 'disabled', 'false', 'enabled']:\n        with patch.object(host.service, 'run', return_value=SimpleNamespace(stdout='"' + host.service.LABEL + '" => ' + value)):\n            values.append(host.autostart(home))\nprint(json.dumps(values))`);
    expect(result).toEqual([false, false, true, true]);
  });
  it('注册 Chrome 与 Firefox 时只允许本扩展，用户路径含空格仍保留完整启动路径', () => {
    const result = evaluate(`print(json.dumps(list(host.manifests(Path('/Users/With Spaces')).values())))`);
    expect(result).toHaveLength(4);
    expect(result[0].allowed_extensions).toEqual(['cloudys-gloss@local.dev']);
    for (const item of result) expect(item.path).toBe('/Users/With Spaces/Library/Application Support/CloudysGloss/native-host/launch');
    expect(result[1].allowed_origins[0]).toMatch(/^chrome-extension:\/\/[a-p]{32}\/$/);
    expect(result[1].allowed_origins).toHaveLength(1);
  });
  it('非法命令、额外 shell 参数和非布尔自启开关被拒绝，不调用服务管理', () => {
    const result = evaluate(`errors = []\nwith patch.object(host, 'status') as status:\n    for message in [{'action':'exec'}, {'action':'start','command':'whoami'}, {'action':'autostart','enabled':'false'}]:\n        try: host.dispatch(Path('/tmp'), message)\n        except ValueError as error: errors.append(str(error))\n    print(json.dumps({'errors':errors,'calls':status.call_count}))`);
    expect(result.errors).toHaveLength(3); expect(result.calls).toBe(0);
  });
  it('消息截断或声明超过限制时返回带长度头的错误，不执行任何管理动作', () => {
    const result = evaluate(`results = []\nwith patch.object(host, 'dispatch') as dispatch:\n    for payload in [struct.pack('=I', 5000), struct.pack('=I', 8) + b'{}']:\n        output = io.BytesIO()\n        host.serve(Path('/tmp'), io.BytesIO(payload), output)\n        data = output.getvalue()\n        assert struct.unpack('=I', data[:4])[0] == len(data[4:])\n        results.append(json.loads(data[4:]))\n    print(json.dumps({'results':results,'calls':dispatch.call_count}))`);
    expect(result.results.every((item: { ok: boolean }) => !item.ok)).toBe(true); expect(result.calls).toBe(0);
  });
  it('浏览器停止模型时只卸载受管服务，保留原来的登录自启偏好', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:\n    home = Path(folder)\n    host.service.paths(home)[0].mkdir(parents=True)\n    with patch.object(host, 'status', return_value={'installed':True}), patch.object(host, 'autostart', return_value=True), patch.object(host.service, 'loaded', side_effect=[True, True, False]), patch.object(host.service, 'run') as run, patch.object(host, 'configure') as configure:\n        host.dispatch(home, {'action':'stop'})\n        print(json.dumps({'commands':[list(c.args) for c in run.call_args_list], 'configure':configure.call_count}))`);
    expect(result.commands).toHaveLength(1); expect(result.commands[0].slice(0, 2)).toEqual(['launchctl', 'bootout']);
    expect(result.configure).toBe(0);
  });
  it('关闭登录自启后从浏览器启动模型，仍保持自启关闭并验证真实生成', () => {
    const result = evaluate(`with tempfile.TemporaryDirectory() as folder:\n    home = Path(folder)\n    host.service.paths(home)[0].mkdir(parents=True)\n    with patch.object(host, 'status', return_value={'installed':True}), patch.object(host, 'autostart', return_value=False), patch.object(host.service, 'loaded', return_value=False), patch.object(host.service, 'assert_port_free'), patch.object(host.service, 'bootstrap') as bootstrap, patch.object(host.service, 'run') as run, patch.object(host, 'configure') as configure, patch.object(host.service, 'verify_generation') as verify:\n        host.dispatch(home, {'action':'start'})\n        print(json.dumps({'commands':[list(c.args)[:2] for c in run.call_args_list], 'enabled':configure.call_args.args[1], 'verified':verify.call_count, 'bootstrapped':bootstrap.call_count}))`);
    expect(result.enabled).toBe(false); expect(result.verified).toBe(1);
    expect(result.bootstrapped).toBe(1);
    expect(result.commands).toEqual([['launchctl', 'kickstart']]);
  });
});
