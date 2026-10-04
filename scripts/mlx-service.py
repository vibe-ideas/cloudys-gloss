"""Manage the current user's local MLX LaunchAgent (macOS Apple Silicon)."""
import argparse
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
MODEL = "mlx-community/Qwen2.5-3B-Instruct-4bit"
PORT = 8080


def paths(home):
    data = home / "Library/Application Support/CloudysGloss"
    return data, home / "Library/LaunchAgents" / (LABEL + ".plist"), home / "Library/Logs/CloudysGloss"


def build_plist(home):
    data, _, logs = paths(home)
    return {
        "Label": LABEL,
        "ProgramArguments": [str(data / "mlx-venv/bin/python"), "-m", "mlx_lm.server",
                             "--model", MODEL, "--host", "127.0.0.1", "--port", str(PORT),
                             "--max-tokens", "4096"],
        "WorkingDirectory": str(data),
        "EnvironmentVariables": {"HF_HUB_OFFLINE": "1", "PYTHONUNBUFFERED": "1",
                                 "HF_HUB_CACHE": str(home / ".cache/huggingface/hub")},
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
    body = json.dumps({"model": MODEL, "max_tokens": 16, "temperature": 0,
                       "messages": [{"role": "user", "content": "Say hello in Chinese."}]}).encode()
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=body,
                                             headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=min(10, max(1, deadline - time.monotonic()))) as response:
                result = json.load(response)
            if result["choices"][0]["message"]["content"].strip():
                print("MLX 已启动，并通过真实生成验证。Base URL: http://127.0.0.1:8080/v1", flush=True)
                return
            last_error = "模型返回空内容"
        except (OSError, ValueError, KeyError, IndexError) as error:
            last_error = str(error)
        time.sleep(1)
    raise RuntimeError(f"启动验证失败：{last_error}。请检查 ~/Library/Logs/CloudysGloss/mlx.stderr.log")


def start(home):
    data, plist, _ = paths(home)
    if not plist.exists() or not (data / "mlx-venv/bin/python").exists():
        raise RuntimeError("尚未安装，请运行 pnpm model:install")
    if not loaded():
        assert_port_free()
    run("launchctl", "enable", target())
    if loaded():
        run("launchctl", "kickstart", target())
    else:
        run("launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist))
    verify_generation()


def stop():
    # Disable as well as unload: KeepAlive and the next login must not undo an explicit stop.
    run("launchctl", "disable", target())
    if loaded():
        run("launchctl", "bootout", target())
    print("MLX 服务已停止，登录自启已暂停。pnpm model:start 可恢复。")


def install(home):
    data, plist, logs = paths(home)
    if plist.exists():
        start(home)
        return
    assert_port_free()
    uv = shutil.which("uv")
    if not uv:
        raise RuntimeError("未找到 uv。请先运行 brew install uv，或参照 docs/guides/model-service.md")
    data.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    plist.parent.mkdir(parents=True, exist_ok=True)
    python = data / "mlx-venv/bin/python"
    if not python.exists():
        subprocess.run([uv, "venv", "--managed-python", "--python", "3.12", str(data / "mlx-venv")], check=True)
    print("安装独立 MLX 环境并预下载模型；首次运行需要联网。", flush=True)
    subprocess.run([uv, "pip", "install", "--python", str(python), "mlx-lm==0.32.0", "mlx==0.32.3"], check=True)
    subprocess.run([str(python), "-c", "from huggingface_hub import snapshot_download; "
                    "import sys; snapshot_download(sys.argv[1], allow_patterns=['*.json','*.safetensors','*.jinja','*.model','*.txt'])", MODEL],
                   env={**os.environ, "HF_HUB_CACHE": str(home / ".cache/huggingface/hub"), "HF_HUB_OFFLINE": "0"}, check=True)
    temporary = plist.with_suffix(".plist.tmp")
    temporary.write_bytes(plistlib.dumps(build_plist(home)))
    temporary.chmod(0o600)
    temporary.replace(plist)
    start(home)
    print(f"登录自启已安装：{plist}")


def status(home):
    _, plist, logs = paths(home)
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
    parser.add_argument("action", choices=["install", "start", "stop", "status", "uninstall"])
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("MLX 自启服务仅支持 Apple Silicon macOS。其他平台请使用 Ollama。")
    home = Path.home()
    if args.action == "install":
        install(home)
    elif args.action == "start":
        start(home)
    elif args.action == "stop":
        stop()
    elif args.action == "status":
        status(home)
    else:
        stop()
        paths(home)[1].unlink(missing_ok=True)
        print("自启配置已移除；保留模型缓存、独立 Python 环境和日志，便于重新安装。")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print(str(error), file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.strip(), file=sys.stderr)
        sys.exit(1)
