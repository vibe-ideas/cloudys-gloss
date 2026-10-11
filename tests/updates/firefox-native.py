"""Smoke-test the published Firefox update feed in a disposable Developer Edition profile.

No access to the user's Firefox profile; no model calls or third-party Python dependencies.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "data/firefox-update.json").read_text())
MARKER = "native-update-settings-retained"


class Marionette:
    def __init__(self, port, process):
        deadline = time.monotonic() + 30
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=1)
                break
            except OSError:
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("Disposable Firefox did not start")
                time.sleep(0.2)
        self.sock.settimeout(120)
        self.stream = self.sock.makefile("rb")
        self.index = 0
        self.read()
        self.command("WebDriver:NewSession", {"capabilities": {}})
        self.command("WebDriver:SetTimeouts", {"script": 110000})
        self.command("Marionette:SetContext", {"value": "chrome"})

    def read(self):
        prefix = b""
        while True:
            char = self.stream.read(1)
            if not char:
                raise RuntimeError("Firefox closed Marionette")
            if char == b":":
                return json.loads(self.stream.read(int(prefix)))
            prefix += char

    def command(self, name, parameters):
        self.index += 1
        data = json.dumps([0, self.index, name, parameters]).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        response = self.read()
        if response[1] != self.index or response[2]:
            raise RuntimeError(response)
        return response[3]

    def script(self, script, args=None):
        result = self.command("WebDriver:ExecuteAsyncScript", {
            "script": script, "args": args or [], "newSandbox": True,
            "sandbox": "system", "scriptTimeout": 110000,
        })["value"]
        if isinstance(result, dict) and "error" in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        self.stream.close()
        self.sock.close()


COMMON = "const done=arguments[arguments.length-1]; const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');"
INSTALL = COMMON + """
(async()=>{
 const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
 file.initWithPath(arguments[0]);
 const install=await AddonManager.getInstallForFile(file);
 install.addListener({onInstallEnded:(_,addon)=>done({version:addon.version}),onInstallFailed:i=>done({error:'Install failed '+i.error})});
 install.install();
})().catch(e=>done({error:String(e)}));
"""
UPDATE = COMMON + """
(async()=>{
 const addon=await AddonManager.getAddonByID(arguments[0]);
 let found=false;
 addon.findUpdates({
  onUpdateAvailable:(_,install)=>{found=true;install.addListener({onInstallEnded:(_,updated)=>done({version:updated.version,active:updated.isActive}),onDownloadFailed:i=>done({error:'Download failed '+i.error}),onInstallFailed:i=>done({error:'Upgrade failed '+i.error})});install.install();},
  onUpdateFinished:(_,status)=>{if(!found)done({error:'No newer version in public feed; status='+status});}
 },AddonManager.UPDATE_WHEN_USER_REQUESTED);
})().catch(e=>done({error:String(e)}));
"""
INFO = COMMON + """
AddonManager.getAddonByID(arguments[0]).then(a=>done(a?{version:a.version,active:a.isActive,temporary:a.temporarilyInstalled,url:a.optionsURL}:null)).catch(e=>done({error:String(e)}));
"""


def run(binary, profile, root, install_only, expected, restarting=False):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    prefs = {"marionette.port": port, "xpinstall.signatures.required": False,
             "extensions.update.enabled": True, "browser.shell.checkDefaultBrowser": False,
             "browser.startup.homepage_override.mstone": "ignore"}
    (profile / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()))
    client = None
    with (root / "firefox.log").open("a") as log:
        process = subprocess.Popen([binary, "-headless", "-no-remote", "-profile", str(profile), "--marionette"],
                                   env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}, stdout=log, stderr=log)
        try:
            client = Marionette(port, process)
            if not restarting:
                print("Installed fixture:", client.script(INSTALL, [str(root / "old.xpi")]), flush=True)
                time.sleep(1)
                if install_only:
                    return
                updated = client.script(UPDATE, [CONFIG["addonId"]])
                assert updated["version"] == expected and updated["active"], updated
                print("Native update:", updated, flush=True)
            info = client.script(INFO, [CONFIG["addonId"]])
            assert info and info["version"] == expected and info["active"] and not info["temporary"], info
            client.command("Marionette:SetContext", {"value": "content"})
            client.command("WebDriver:Navigate", {"url": info["url"]})
            # Inspect the actual product's settings UI, rather than fixture-owned storage.
            marker = client.script("""const done=arguments[arguments.length-1];let tries=0;const timer=setInterval(()=>{const values=Array.from(document.querySelectorAll('input')).map(i=>i.value);if(values.includes(arguments[0])||++tries>100){clearInterval(timer);done(values.includes(arguments[0]));}},100);""", [MARKER])
            assert marker, "Saved model setting was lost during update/restart"
            print("PASS: permanent version and model setting survived" + (" restart" if restarting else " native upgrade"), flush=True)
        except Exception:
            print((root / "firefox.log").read_text()[-4000:], flush=True)
            raise
        finally:
            if client:
                try:
                    client.command("Marionette:Quit", {"flags": ["eAttemptQuit"]})
                except (RuntimeError, OSError):
                    pass
                client.close()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firefox", default=os.environ.get("FIREFOX_BINARY", "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"))
    parser.add_argument("--expected", default=json.loads((ROOT / "package.json").read_text())["version"])
    parser.add_argument("--install-only", action="store_true", help="Validate the fixture before publishing the first update feed")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="gloss-native-update-") as temp:
        root = Path(temp)
        profile = root / "profile"
        profile.mkdir()
        manifest = {"manifest_version": 2, "name": "Cloudys Gloss update test fixture", "version": "0.0.1",
                    "permissions": ["storage", "nativeMessaging", "http://*/*", "https://*/*"], "background": {"scripts": ["background.js"]},
                    "browser_specific_settings": {"gecko": {"id": CONFIG["addonId"], "update_url": CONFIG["updateUrl"], "data_collection_permissions": {"required": ["websiteContent"]}}}}
        settings = {"settings": {"baseUrl": "http://127.0.0.1:8080/v1", "model": MARKER, "autoStartLocalModel": False}, "modelPresetVersion": 2}
        with zipfile.ZipFile(root / "old.xpi", "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("background.js", "browser.storage.local.set(" + json.dumps(settings) + ");")
        run(args.firefox, profile, root, args.install_only, args.expected)
        if not args.install_only:
            run(args.firefox, profile, root, False, args.expected, restarting=True)


if __name__ == "__main__":
    main()
