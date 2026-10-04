"""Run the fixed quality corpus against cached MLX models, one server at a time."""
import json
import importlib.util
import os
import socket
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def main():
    backend = os.environ.get("QUALITY_BACKEND", "mlx-serve")
    if backend not in ("mlx-serve", "mlx-lm"):
        raise SystemExit("QUALITY_BACKEND must be mlx-serve or mlx-lm")
    python = os.environ.get("MLX_PYTHON")
    if backend == "mlx-lm" and not python:
        raise SystemExit("Historical mlx-lm runs require MLX_PYTHON")
    spec = importlib.util.spec_from_file_location("service", Path(__file__).resolve().parents[2] / "scripts/mlx-service.py")
    service = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(service)
    thinking = os.environ.get("QUALITY_THINKING", "disabled")
    if thinking not in ("enabled", "disabled"):
        raise SystemExit("QUALITY_THINKING must be enabled or disabled")
    models = os.environ.get("QUALITY_MODELS", "mlx-community/Qwen2.5-3B-Instruct-4bit,mlx-community/Qwen2.5-1.5B-Instruct-4bit,Qwen/Qwen3-1.7B-MLX-4bit").split(",")
    output = Path(os.environ.get("QUALITY_OUTPUT", f"artifacts/quality/{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"))
    output.mkdir(parents=True, exist_ok=False)
    port = int(os.environ.get("QUALITY_PORT", "18082"))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))
    versions = f"mlx-serve {service.VERSION}" if backend == "mlx-serve" else subprocess.check_output(
        [python, "-c", 'import importlib.metadata as m; print("mlx",m.version("mlx"),"mlx-lm",m.version("mlx-lm"))'], text=True).strip()
    manifest = []
    for index, model in enumerate(models):
        # Require an existing snapshot so download latency cannot masquerade as inference latency.
        cache = Path.home() / ".cache/huggingface/hub" / ("models--" + model.replace("/", "--"))
        model_path = str(cache / "snapshots" / (cache / "refs/main").read_text().strip())
        if not (Path(model_path) / "config.json").exists():
            raise RuntimeError(f"Download {model} before benchmarking")
        revision = Path(model_path).name
        model_output = output / f"{index}-{model.replace('/', '--')}"
        model_output.mkdir()
        command = [python, "-m", "mlx_lm.server", "--model", model_path, "--host", "127.0.0.1", "--port", str(port),
                   "--max-tokens", "4096", "--decode-concurrency", "1", "--prompt-concurrency", "1", "--prompt-cache-size", "0",
                   "--chat-template-args", json.dumps({"enable_thinking": thinking == "enabled"})]
        if backend == "mlx-serve":
            command = service.server_args(Path.home(), port)
            command[command.index("--model") + 1] = model_path
            command += ["--reasoning-budget", "-1" if thinking == "enabled" else "0"]
        with (model_output / "server.log").open("w") as log:
            server = subprocess.Popen(command, stdout=log, stderr=log, env={**os.environ, "MLX_SERVE_CACHE_LIMIT": str(256 * 1024 * 1024)})
            try:
                base = f"http://127.0.0.1:{port}/v1"
                for _ in range(240):
                    if server.poll() is not None:
                        raise RuntimeError(f"Server exited: {model_output / 'server.log'}")
                    try:
                        with urllib.request.urlopen(base + "/models", timeout=0.5):
                            break
                    except (OSError, TimeoutError):
                        time.sleep(0.5)
                else:
                    raise RuntimeError("Server startup timed out")
                # Use the pinned local path both in warmup and provider requests, avoiding another Hub resolution.
                body = json.dumps({"model": model_path, "temperature": 0, "max_tokens": 32,
                    "messages": [{"role": "user", "content": "Translate hello into Chinese."}]}).encode()
                request = urllib.request.Request(base + "/chat/completions", data=body, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=120) as response:
                    response.read()
                env = {**os.environ, "MODEL_BASE_URL": base, "MODEL_NAME": model_path, "MODEL_LABEL": model,
                       "MODEL_API_KEY": "", "MODEL_REVISION": revision, "QUALITY_OUTPUT": str(model_output),
                       "QUALITY_RUNTIME": versions, "QUALITY_PROMPT_CACHE": "1 entry / 128MB" if backend == "mlx-serve" else "disabled", "QUALITY_THINKING": thinking}
                print(f"Evaluating {model} @ {revision}", flush=True)
                result = subprocess.run(["pnpm", "test:quality"], env=env, check=False)
                manifest.append({"model": model, "revision": revision, "directory": model_output.name, "exitCode": result.returncode})
                (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
    print(f"Results: {output}")
    raise SystemExit(1 if any(item["exitCode"] for item in manifest) else 0)


if __name__ == "__main__":
    main()
