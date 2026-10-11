"""Generate Firefox's native update feed without storing repository credentials."""
import hashlib
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ADDON_ID = "cloudys-gloss@local.dev"


def require_https(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
            parsed.password or parsed.fragment or parsed.query or
            any(character.isspace() for character in value)):
        raise ValueError("更新地址必须是无凭据、无查询参数的 HTTPS URL")
    return value


def create_update_manifest(archive, version, update_url, update_link):
    """Fail before publishing a feed that cannot update the packaged add-on."""
    require_https(update_url)
    require_https(update_link)
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("更新版本必须为三段数字")
    parts = [int(part) for part in version.split(".")]
    if max(parts) > 65535 or not any(parts):
        raise ValueError("更新版本超出浏览器支持范围")
    archive = Path(archive)
    with zipfile.ZipFile(archive) as package:
        if package.testzip():
            raise ValueError("XPI 内容损坏")
        manifest = json.loads(package.read("manifest.json"))
    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    if manifest.get("version") != version or gecko.get("id") != ADDON_ID:
        raise ValueError("XPI 的版本或扩展 ID 与更新清单不一致")
    if gecko.get("update_url") != update_url:
        raise ValueError("XPI 未配置相同的稳定更新地址")
    update = {"version": version, "update_link": update_link,
              "update_hash": "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest()}
    compatibility = {key: gecko[key] for key in ("strict_min_version", "strict_max_version") if key in gecko}
    if compatibility:
        update["applications"] = {"gecko": compatibility}
    return {"addons": {ADDON_ID: {"updates": [update]}}}
