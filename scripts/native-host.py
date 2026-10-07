"""One-shot Native Messaging bridge for managed MLX and local speech rendering."""
import base64
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
import platform
import plistlib
import re
import shlex
import shutil
import struct
import subprocess
import tempfile
import wave
import sys
from pathlib import Path

HOST = "com.cloudys_gloss.mlx"
FIREFOX_ID = "cloudys-gloss@local.dev"
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("mlx_service", HERE / "mlx-service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


def chrome_id():
    key = json.loads((HERE / "native-key.json").read_text())["key"]
    digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
    return "".join(chr(ord("a") + int(char, 16)) for char in digest)


def manifests(home):
    base = home / "Library/Application Support"
    common = {"name": HOST, "description": "Cloudys Gloss local MLX manager",
              "path": str(base / "CloudysGloss/native-host/launch"), "type": "stdio"}
    result = {base / "Mozilla/NativeMessagingHosts" / (HOST + ".json"):
              {**common, "allowed_extensions": [FIREFOX_ID]}}
    for browser in ["Google/Chrome", "Google/ChromeForTesting", "Chromium"]:
        result[base / browser / "NativeMessagingHosts" / (HOST + ".json")] = {
            **common, "allowed_origins": [f"chrome-extension://{chrome_id()}/"]}
    return result


def install(home):
    data, plist, _ = service.paths(home)
    python = data / "bridge-venv/bin/python"
    if not python.exists():
        # Speech only needs the standard library; no model download is required.
        python = Path(sys.executable).resolve()
    # Provision the executable launch configuration during explicit installation.
    # Browser-spawned hosts must update this existing file, not create a new one.
    if plist.exists():
        config = plistlib.loads(plist.read_bytes())
        temporary = plist.with_suffix('.install.tmp')
        temporary.write_bytes(plistlib.dumps(config))
        temporary.chmod(0o600)
        temporary.replace(plist)
    dest = data / "native-host"
    dest.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ["native-host.py", "mlx-service.py", "native-key.json"]:
        shutil.copy2(HERE / name, dest / name)
    launcher = dest / "launch"
    launcher.write_text(f"#!/bin/sh\nexec {shlex.quote(str(python))} {shlex.quote(str(dest / 'native-host.py'))} \"$@\"\n")
    launcher.chmod(0o700)
    for path, manifest in manifests(home).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest, indent=2) + "\n")
        path.chmod(0o600)
    print(f"本地助手已安装，支持系统发音与 MLX 管理。Chrome ID: {chrome_id()}")


def autostart(home):
    _, path, _ = service.paths(home)
    if not path.exists():
        return False
    config = plistlib.loads(path.read_bytes())
    disabled = service.run("launchctl", "print-disabled", f"gui/{os.getuid()}", check=False)
    # Preserve the preference left by the existing CLI stop command as well.
    return bool(config.get("RunAtLoad")) and not re.search(
        r'"' + re.escape(service.LABEL) + r'"\s*=>\s*(?:true|disabled)', disabled.stdout)


def configure(home, enabled):
    _, path, _ = service.paths(home)
    config = plistlib.loads(path.read_bytes())
    config.update(RunAtLoad=enabled, KeepAlive=enabled)
    # macOS quarantines NEW files created by browser-descended processes.
    # Keep the preinstalled inode; do not strip quarantine or disable Gatekeeper.
    # Mutations are serialized by the service lock in dispatch().
    with path.open('r+b') as output:
        output.write(plistlib.dumps(config))
        output.truncate()
        output.flush()
        os.fsync(output.fileno())
    service.run("launchctl", "enable", service.target())


def status(home):
    data, plist, _ = service.paths(home)
    return {"installed": plist.exists() and service.installed(home),
            "running": bool(re.search(r"^\s*state = running$", service.run("launchctl", "print", service.target(), check=False).stdout, re.M)),
            "autostart": bool(autostart(home)),
            "runtime": f"mlx-serve {service.VERSION}",
            "model": service.MODEL, "baseUrl": f"http://127.0.0.1:{service.PORT}/v1"}


def speech(message):
    if set(message) != {"action", "word", "locale"}:
        raise ValueError("无效的发音请求")
    word = message.get("word")
    voices = {"en-US": "Samantha", "en-GB": "Daniel"}
    if not isinstance(word, str) or not 0 < len(word.strip()) <= 200 or any(ord(c) < 32 for c in word) or "[[" in word:
        raise ValueError("发音文字无效")
    if message.get("locale") not in voices:
        raise ValueError("不支持的发音口音")
    # Render only: Firefox plays the resulting PCM via its normal media path.
    # Text goes through stdin, never through a shell or command-line options.
    with tempfile.TemporaryDirectory(prefix="cloudys-gloss-speech-") as folder:
        path = Path(folder) / "word.wav"
        result = subprocess.run([
            "/usr/bin/say", "-v", voices[message["locale"]], "-r", "175",
            "-o", str(path), "--file-format=WAVE", "--data-format=LEI16@22050",
        ], input=word, text=True, capture_output=True, timeout=15)
        if result.returncode or not path.exists():
            raise RuntimeError("系统语音生成失败，请安装 Samantha（美式）或 Daniel（英式）语音")
        if path.stat().st_size > 600000:
            raise ValueError("发音过长，请选择较短的词组")
        with wave.open(str(path)) as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 22050:
                raise ValueError("系统语音格式无效")
        return {"audio": base64.b64encode(path.read_bytes()).decode(), "voice": voices[message["locale"]]}


def dispatch(home, message):
    if isinstance(message, dict) and message.get("action") == "speech":
        return speech(message)
    if not isinstance(message, dict) or set(message) - {"action", "enabled"}:
        raise ValueError("无效的服务管理请求")
    action = message.get("action")
    if action not in ("status", "start", "stop", "restart", "autostart"):
        raise ValueError("不支持的服务操作")
    if action == "autostart" and type(message.get("enabled")) is not bool:
        raise ValueError("自启开关必须为布尔值")
    if action == "status":
        return status(home)
    data, _, _ = service.paths(home)
    if not status(home)["installed"]:
        raise RuntimeError("尚未安装 MLX，请先运行 pnpm model:install")
    # Multiple tabs/browser processes must never start competing model servers.
    with (data / "native-service.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        enabled = autostart(home)
        running = service.loaded()
        if action in ("stop", "restart", "autostart") and running:
            service.run("launchctl", "bootout", service.target())
            service.wait_unloaded()
        if action == "autostart":
            enabled = message["enabled"]
        if action != "stop":
            # Check before modifying any launchd preference or loading a job.
            if not service.loaded() and (action != "autostart" or running):
                service.assert_port_free()
            configure(home, enabled)
            if action in ("start", "restart") or running:
                if not service.loaded():
                    service.bootstrap(home)
                # RunAtLoad=false allows login to remain off while starting now.
                service.run("launchctl", "kickstart", service.target())
                service.verify_generation()
        return status(home)


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            raise ValueError("Native Messaging 消息被截断")
        data.extend(chunk)
    return bytes(data)


def serve(home, source, output):
    try:
        size = struct.unpack("=I", read_exact(source, 4))[0]
        if not 0 < size <= 4096:
            raise ValueError("Native Messaging 消息大小无效")
        message = json.loads(read_exact(source, size))
        # stdout belongs exclusively to the framed protocol, including startup logs.
        with contextlib.redirect_stdout(sys.stderr):
            result = {"ok": True, "data": dispatch(home, message)}
    except Exception as error:
        result = {"ok": False, "error": str(error)}
    body = json.dumps(result, ensure_ascii=False).encode()
    output.write(struct.pack("=I", len(body)) + body)
    output.flush()


def main():
    if platform.system() != "Darwin":
        raise RuntimeError("本地助手仅支持 macOS；MLX 模型另外需要 Apple Silicon")
    if "--install" in sys.argv[1:]:
        install(Path.home())
    elif "--uninstall" in sys.argv[1:]:
        for path in manifests(Path.home()):
            path.unlink(missing_ok=True)
        print("已移除浏览器助手注册；模型服务与自启设置保持不变。")
    else:
        allowed = {FIREFOX_ID, f"chrome-extension://{chrome_id()}/"}
        if not allowed.intersection(sys.argv[1:]):
            raise RuntimeError("此助手只接受 Cloudys Gloss 扩展调用")
        serve(Path.home(), sys.stdin.buffer, sys.stdout.buffer)


if __name__ == "__main__":
    main()
