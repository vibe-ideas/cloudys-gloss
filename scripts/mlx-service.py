"""Manage the current user's local MLX LaunchAgent (macOS Apple Silicon)."""
import argparse
import hashlib
import tarfile
import tempfile
import re
import json
import os
import platform
import plistlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

LABEL = "com.cloudys-gloss.mlx"
MODEL = "Qwen/Qwen3-1.7B-MLX-4bit"
PORT = 8080
VERSION = "26.10.1"
ARCHIVE_SHA256 = "e53056e481364ff72188fafea8b3eb0aeb0b5b7cebcd6e6e7d26bf1ce4223873"
ARCHIVE_URL = f"https://github.com/ddalcu/mlx-serve/releases/download/v{VERSION}/mlx-serve-bin-macos-arm64.tar.gz"


def paths(home):
    data = home / "Library/Application Support/CloudysGloss"
    return data, home / "Library/LaunchAgents" / (LABEL + ".plist"), home / "Library/Logs/CloudysGloss"


def executable(home):
    return paths(home)[0] / "mlx-serve" / VERSION / "mlx-serve"


def model_path(home):
    return paths(home)[0] / "models" / MODEL.split("/")[-1]


def installed(home):
    return executable(home).is_file() and (model_path(home) / "config.json").is_file()


def server_args(home, port=PORT):
    return [str(executable(home)), "--model", str(model_path(home)), "--serve",
            "--host", "127.0.0.1", "--port", str(port), "--ctx-size", "8192",
            "--max-tokens", "4096", "--max-concurrent", "1",
            "--prefix-cache-entries", "1", "--prefix-cache-mem", "128MB", "--no-drafter", "--reasoning-budget", "0"]


def build_plist(home):
    data, _, logs = paths(home)
    return {
        "Label": LABEL,
        "ProgramArguments": server_args(home),
        "WorkingDirectory": str(data),
        "EnvironmentVariables": {"MLX_SERVE_CACHE_LIMIT": str(256 * 1024 * 1024)},
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "ProcessType": "Background",
        "StandardOutPath": str(logs / "mlx.stdout.log"),
        "StandardErrorPath": str(logs / "mlx.stderr.log"),
    }


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True)


def target():
    return f"gui/{os.getuid()}/{LABEL}"


def loaded():
    return run("launchctl", "print", target(), check=False).returncode == 0


def wait_unloaded(timeout=10):
    # bootout can return before launchd finishes removing the old job.
    deadline = time.monotonic() + timeout
    while loaded():
        if time.monotonic() >= deadline:
            raise RuntimeError("旧模型服务尚未退出，请稍后重试")
        time.sleep(0.05)


def bootstrap(home):
    # launchd can briefly reject re-registration after a successful bootout.
    for attempt in range(20):
        result = run("launchctl", "bootstrap", f"gui/{os.getuid()}", str(paths(home)[1]), check=False)
        if result.returncode == 0:
            return
        if result.returncode != 5 or attempt == 19:
            raise RuntimeError(f"注册模型服务失败：{result.stderr.strip()}（{result.returncode}）")
        time.sleep(0.25)


def port_free():
    try:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", PORT))
        return True
    except OSError:
        return False


def assert_port_free():
    if not port_free():
        raise RuntimeError("8080 端口已被其他服务占用。请先停止手动启动的 MLX；不会自动结束未知进程。")


def verify_generation(timeout=120):
    deadline = time.monotonic() + timeout
    last_error = "服务尚未响应"
    body = json.dumps({"model": MODEL, "max_tokens": 128, "temperature": 0,
                       "messages": [{"role": "system", "content": "Translate into Simplified Chinese. Output only the translation."},
                                    {"role": "user", "content": "Hello."}]}).encode()
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=body,
                                             headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=min(10, max(1, deadline - time.monotonic()))) as response:
                result = json.load(response)
            if result["choices"][0]["message"]["content"].strip() and result["choices"][0].get("finish_reason") != "length":
                print("mlx-serve 已启动，并通过真实生成验证。Base URL: http://127.0.0.1:8080/v1", flush=True)
                return
            last_error = "模型返回空内容"
        except (OSError, ValueError, KeyError, IndexError) as error:
            last_error = str(error)
        time.sleep(1)
    raise RuntimeError(f"启动验证失败：{last_error}。请检查 ~/Library/Logs/CloudysGloss/mlx.stderr.log")


def start(home):
    data, plist, _ = paths(home)
    if not plist.exists() or not installed(home):
        raise RuntimeError("尚未安装，请运行 pnpm model:install")
    if not loaded():
        assert_port_free()
    # CLI start also restores login startup after the browser disabled it.
    config = plistlib.loads(plist.read_bytes())
    if not config.get("RunAtLoad") or not config.get("KeepAlive"):
        config.update(RunAtLoad=True, KeepAlive=True)
        temporary = plist.with_suffix(".plist.tmp")
        temporary.write_bytes(plistlib.dumps(config))
        temporary.chmod(0o600)
        temporary.replace(plist)
        if loaded():
            run("launchctl", "bootout", target())
            wait_unloaded()
    run("launchctl", "enable", target())
    if loaded():
        run("launchctl", "kickstart", target())
    else:
        bootstrap(home)
    verify_generation()


def stop():
    # Disable as well as unload: KeepAlive and the next login must not undo an explicit stop.
    run("launchctl", "disable", target())
    if loaded():
        run("launchctl", "bootout", target())
    print("MLX 服务已停止，登录自启已暂停。pnpm model:start 可恢复。")


def autostart_enabled(home):
    plist = paths(home)[1]
    if not plist.exists():
        return True
    disabled = run("launchctl", "print-disabled", f"gui/{os.getuid()}", check=False)
    return bool(plistlib.loads(plist.read_bytes()).get("RunAtLoad")) and not re.search(
        r'"' + re.escape(LABEL) + r'"\s*=>\s*(?:true|disabled)', disabled.stdout)


def write_plist(path, config):
    temporary = path.with_suffix(".install.tmp")
    temporary.write_bytes(plistlib.dumps(config))
    temporary.chmod(0o600)
    temporary.replace(path)


def extract_runtime(archive, destination):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError("mlx-serve 安装包 SHA256 不匹配，拒绝安装")
    with tempfile.TemporaryDirectory(dir=destination.parent) as temp:
        with tarfile.open(archive) as bundle:
            # Only ordinary files/directories inside the known release root.
            for item in bundle.getmembers():
                pieces = Path(item.name).parts
                if not pieces or pieces[0] != "mlx-serve-macos-arm64" or ".." in pieces or not (item.isfile() or item.isdir()):
                    raise RuntimeError("mlx-serve 安装包包含异常路径或文件类型")
            bundle.extractall(temp, filter="data")
        shutil.move(str(Path(temp) / "mlx-serve-macos-arm64"), destination)


def prepare_runtime(home):
    data, _, _ = paths(home)
    if executable(home).exists():
        return
    folder = executable(home).parent
    folder.parent.mkdir(parents=True, exist_ok=True)
    archive = data / f"mlx-serve-{VERSION}.tar.gz"
    if not archive.exists():
        print(f"下载官方 mlx-serve {VERSION} 安装包…", flush=True)
        pending = archive.with_suffix(".download")
        try:
            with urllib.request.urlopen(ARCHIVE_URL, timeout=120) as response, pending.open("wb") as output:
                shutil.copyfileobj(response, output)
            if hashlib.sha256(pending.read_bytes()).hexdigest() != ARCHIVE_SHA256:
                raise RuntimeError("mlx-serve 下载校验失败，请重试")
            pending.replace(archive)
        finally:
            pending.unlink(missing_ok=True)
    extract_runtime(archive, folder)
    run(str(executable(home)), "--version")


def prepare_model(home):
    data, _, _ = paths(home)
    uv = shutil.which("uv")
    python = data / "bridge-venv/bin/python"
    if not python.exists():
        if not uv:
            raise RuntimeError("请先安装 uv：brew install uv")
        subprocess.run([uv, "venv", "--managed-python", "--python", "3.12", str(python.parent.parent)], check=True)
    cache = home / ".cache/huggingface/hub" / ("models--" + MODEL.replace("/", "--"))
    ref = cache / "refs/main"
    snapshot = cache / "snapshots" / ref.read_text().strip() if ref.exists() else None
    if snapshot is None or not (snapshot / "config.json").exists() or not list(snapshot.glob("*.safetensors")):
        if not uv:
            raise RuntimeError("未找到缓存权重，请安装 uv 后重试")
        command = [uv, "run", "--no-project", "--python", str(python), "--with", "huggingface-hub==0.36.0",
                   "python", "-c", "from huggingface_hub import snapshot_download; import sys; "
                   "print(snapshot_download(sys.argv[1], allow_patterns=['*.json','*.safetensors','*.jinja','*.model','*.txt']))", MODEL]
        result = run(*command)
        snapshot = Path(result.stdout.strip().splitlines()[-1])
    link = model_path(home)
    link.parent.mkdir(parents=True, exist_ok=True)
    if not link.exists():
        if link.is_symlink():
            link.unlink()
        link.symlink_to(snapshot, target_is_directory=True)


def activate(home, config):
    _, plist, _ = paths(home)
    previous = plist.read_bytes() if plist.exists() else None
    was_loaded = loaded()
    was_enabled = autostart_enabled(home)
    if not was_loaded:
        assert_port_free()
    if previous and not (plist.with_suffix(".before-mlx-serve.plist")).exists():
        backup = plist.with_suffix(".before-mlx-serve.plist")
        backup.write_bytes(previous)
        backup.chmod(0o600)
    try:
        if was_loaded:
            run("launchctl", "bootout", target())
            wait_unloaded()
        assert_port_free()
        write_plist(plist, config)
        run("launchctl", "enable", target())
        bootstrap(home)
        run("launchctl", "kickstart", target())
        verify_generation()
    except Exception:
        if loaded():
            run("launchctl", "bootout", target())
            wait_unloaded()
        if previous:
            write_plist(plist, plistlib.loads(previous))
            run("launchctl", "enable" if was_enabled else "disable", target())
            if was_loaded:
                # Restore an on-demand job without changing its login preference.
                run("launchctl", "enable", target())
                bootstrap(home)
                run("launchctl", "kickstart", target())
        else:
            plist.unlink(missing_ok=True)
        raise


def install(home):
    data, plist, logs = paths(home)
    data.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    plist.parent.mkdir(parents=True, exist_ok=True)
    # Prepare and validate all dependencies before stopping the existing server.
    prepare_runtime(home)
    prepare_model(home)
    config = build_plist(home)
    config.update(RunAtLoad=autostart_enabled(home), KeepAlive=autostart_enabled(home))
    activate(home, config)
    print(f"mlx-serve {VERSION} 已安装；保留原登录自启偏好。")


def foreground(home):
    if not installed(home):
        raise RuntimeError("请先运行 pnpm model:install")
    assert_port_free()
    os.execve(str(executable(home)), server_args(home), {**os.environ, "MLX_SERVE_CACHE_LIMIT": str(256 * 1024 * 1024)})


def status(home):
    _, plist, logs = paths(home)
    print(f"推理服务：mlx-serve {VERSION} · {executable(home)}")
    print(f"自启配置：{plist}（{'已安装' if plist.exists() else '未安装'}）")
    result = run("launchctl", "print", target(), check=False)
    if result.returncode == 0:
        shown = set()
        for line in result.stdout.splitlines():
            key = line.strip().split(" =", 1)[0]
            if key in ("state", "pid", "last exit code") and key not in shown:
                print(line.strip())
                shown.add(key)
    else:
        print("当前未加载；运行 pnpm model:start 可恢复服务与自启。")
    disabled = run("launchctl", "print-disabled", f"gui/{os.getuid()}", check=False)
    for line in disabled.stdout.splitlines():
        if LABEL in line:
            print("launchd 禁用状态：" + line.strip())
    print(f"日志目录：{logs}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "start", "stop", "status", "uninstall", "run"])
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("MLX 自启服务仅支持 Apple Silicon macOS。其他平台请使用 Ollama。")
    if args.action in ("install", "start", "run") and tuple(map(int, platform.mac_ver()[0].split(".")[:2])) < (26, 2):
        raise RuntimeError("mlx-serve 26.10.1 需要 macOS 26.2 或更新版本。")
    home = Path.home()
    if args.action == "install":
        install(home)
    elif args.action == "start":
        start(home)
    elif args.action == "stop":
        stop()
    elif args.action == "run":
        foreground(home)
    elif args.action == "status":
        status(home)
    else:
        stop()
        paths(home)[1].unlink(missing_ok=True)
        print("自启配置已移除；保留模型缓存、mlx-serve、浏览器助手环境和日志，便于重新安装。")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print(str(error), file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.strip(), file=sys.stderr)
        sys.exit(1)
