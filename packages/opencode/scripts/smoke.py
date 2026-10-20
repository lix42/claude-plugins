"""Exercise a private OpenCode server without models, GitHub, or user config.

Usage: python3 packages/opencode/scripts/smoke.py [installed-package-directory]
Leaves diagnostics in its printed temporary directory; never changes global config.
"""
import json
import argparse
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
from processes import server_url, stop_process

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("package", nargs="?", type=Path, default=Path(__file__).resolve().parents[3])
parser.add_argument("--git", help="Install this Git package target into the isolated global config")
parser.add_argument("--disable-panel", action="store_true", help="Check capability discovery with the server panel disabled (local package only)")
args = parser.parse_args()
if args.git and args.disable_panel:
    parser.error("--disable-panel is a local-package smoke check; run Git installation separately")
package = args.package.resolve()
binary = shutil.which("opencode")
if not binary:
    raise SystemExit("OpenCode V2 is required")
directory = Path(tempfile.mkdtemp(prefix="lix42-opencode-", dir=os.environ.get("OPENCODE_TEST_TMP"))).resolve()
project = directory / "project"
project.mkdir()
(project / "opencode.json").write_text(json.dumps({
    "$schema": "https://opencode.ai/config.json",
    "plugins": [] if args.git else [{"package": str(package), "options": {"prPanel": not args.disable_panel}}],
}))
env = os.environ.copy()
for key, folder in {
    "HOME": "home", "XDG_CONFIG_HOME": "config", "XDG_DATA_HOME": "data",
    "XDG_CACHE_HOME": "cache", "XDG_STATE_HOME": "state",
}.items():
    env[key] = str(directory / folder)
env["OPENCODE_DB"] = ":memory:"
env["OPENCODE_PASSWORD"] = secrets.token_urlsafe(32)
print(f"Isolated diagnostics: {directory}", flush=True)

if args.git:
    installed = subprocess.run([binary, "plugin", "add", args.git], cwd=project, env=env,
                               text=True, capture_output=True, timeout=180)
    if installed.returncode:
        raise RuntimeError(f"Git installation failed: {installed.stdout}\n{installed.stderr}")
    print("PASS Git package installation into isolated global config", flush=True)

with (directory / "server.stderr").open("w") as log:
    server = subprocess.Popen([binary, "serve", "--stdio", "--port", "0"],
                              cwd=project, env=env, text=True,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log)
    try:
        url = server_url(server)

        def api(method, path, data=None, located=True):
            command = [binary, "api", "--server", url, method, path]
            if data is not None:
                command += ["--data", json.dumps(data)]
            if located:
                command += ["--param", f"location[directory]={project}"]
            result = subprocess.run(command, cwd=project, env=env, text=True,
                                    capture_output=True, timeout=90)
            if result.returncode:
                raise RuntimeError(f"{path}: {result.stdout}\n{result.stderr}")
            return json.loads(result.stdout) if result.stdout.strip() else None

        session = api("post", "/api/session", {"location": {"directory": str(project)}}, False)["data"]["id"]
        # Registry reads do not wait for lazy plugin activation. Bounded readiness
        # requests avoid launching a model merely to warm the plugin runtime.
        for attempt in range(60):
            registered = api("get", "/api/skill")["data"]
            if any(item["id"] == "task-tracking" for item in registered):
                break
        else:
            raise RuntimeError(f"Plugin did not activate: {api('get', '/api/plugin')}")
        expected = {
            "/api/skill": {"task-tracking", "start-task", "ship", "drive-pr", "rebase", "review-changes", "review-fix-loop"},
            "/api/agent": {"ship/review-bugs", "ship/review-security", "ship/review-error-handling",
                           "ship/review-tests", "ship/review-conventions", "ship/review-types",
                           "ship/review-docs", "ship/rebase-scout"},
            "/api/command": {"tasks-setup", "tasks-next", "tasks-update", "tasks-done", "tasks-group",
                             "tasks-migrate", "start-task", "ship", "ship-config", "drive-pr", "rebase", "review-changes", "review-fix-loop"},
        }
        for path, required in expected.items():
            entries = api("get", path)["data"]
            ids = {item.get("id", item.get("name")) for item in entries}
            assert required <= ids, f"{path}: missing {required - ids}"
            print(f"PASS {path}: {len(required)} bundled definitions", flush=True)
        # With gh absent, branch discovery safely produces an empty panel.
        status = api("post", "/api/rpc/lix42.pr-panel/status", {"input": {}})["output"]
        assert status["enabled"] is not args.disable_panel
        if not args.disable_panel:
            state = api("post", "/api/rpc/lix42.pr-panel/state", {"input": {"sessionID": session}})["output"]
            assert state["prs"] == [] and state["agent"] is True
        print("PASS PR-panel RPC and cleanup", flush=True)
    finally:
        stop_process(server)
