import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import queue
import threading
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGINS = ("lark-cli-skills", "obsidian-skills", "agent-guard", "agent-notifier")


class AntigravityPluginsTest(unittest.TestCase):
    def test_native_manifests_match_shared_identity(self):
        for name in PLUGINS:
            with self.subTest(plugin=name):
                root = ROOT / "plugins" / name
                manifest = json.loads((root / ".antigravity-plugin/plugin.json").read_text())
                claude = json.loads((root / ".claude-plugin/plugin.json").read_text())
                for field in ("name", "version", "repository", "author"):
                    self.assertEqual(manifest[field], claude[field])
                self.assertTrue(manifest["displayName"])
                self.assertNotIn("skills", manifest)  # Default skills/ only; no mirrors.
        self.assertFalse((ROOT / "plugins/omp-conventions/.antigravity-plugin").exists())

    def run_guard(self, payload):
        root = ROOT / "plugins/agent-guard"
        hooks = json.loads((root / "hooks.json").read_text())
        entry = hooks["agent-guard"]["PreToolUse"][0]
        self.assertEqual(entry["matcher"], "^run_command$")
        result = subprocess.run(entry["hooks"][0]["command"], shell=True, cwd=root,
                                input=json.dumps(payload), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_guard_denies_dangerous_native_command(self):
        result = self.run_guard({"toolCall": {"name": "run_command", "args": {
            "CommandLine": "git reset --hard HEAD"}}})
        self.assertEqual(result["decision"], "deny")
        self.assertIn("blocked", result["reason"])
        self.assertNotIn("hookSpecificOutput", result)

    def test_guard_preserves_normal_permissions(self):
        for call in ({"name": "run_command", "args": {"CommandLine": "git status"}},
                     {"name": "view_file", "args": {"CommandLine": "rm -rf /"}}, {}):
            with self.subTest(call=call):
                self.assertEqual(self.run_guard({"toolCall": call}), {"decision": "allow"})

    def test_notifier_maps_native_payload_and_skips_busy_or_headless(self):
        module = (ROOT / "plugins/agent-notifier/lib/antigravity.mjs").as_uri()
        script = """
import assert from 'node:assert/strict';
const { antigravityNotification } = await import(process.argv[1]);
const payload = {fullyIdle: true, conversationId: 'session', workspacePaths: ['/workspace'],
                 transcriptPath: '/logs/transcript.jsonl', modelName: 'model'};
const interactive = {readParentCommands: () => ['/opt/homebrew/bin/agy --model model']};
assert.deepEqual(antigravityNotification(payload, interactive), {
    host: 'Antigravity', event: 'Stop', sessionId: 'session', cwd: '/workspace',
    transcriptPath: '/logs/transcript.jsonl', model: 'model'
});
for (const fullyIdle of [false, undefined]) {
    assert.equal(antigravityNotification({...payload, fullyIdle}, interactive), undefined);
}
for (const command of ['agy -p hello', '/bin/agy --print=hello', 'agy acp',
                       'agy --prompt hello', 'agy --input-format stream-json']) {
    assert.equal(antigravityNotification(payload, {readParentCommands: () => [command]}), undefined);
}
assert.ok(antigravityNotification(payload, {readParentCommands: () => ['agy -i hello']}));
"""
        result = subprocess.run(["node", "--input-type=module", "-e", script, module],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_notifier_hook_returns_without_continuing(self):
        root = ROOT / "plugins/agent-notifier"
        hooks = json.loads((root / "hooks.json").read_text())
        handler = hooks["agent-notifier"]["Stop"][0]
        self.assertNotIn("hooks", handler)
        result = subprocess.run(handler["command"], shell=True, cwd=root,
                                input=json.dumps({"fullyIdle": False}), text=True,
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"decision": "allow"})

    def test_notifier_delivers_native_stop_to_local_webhook(self):
        received = queue.Queue()

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.put(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                root = ROOT / "plugins/agent-notifier"
                command = json.loads((root / "hooks.json").read_text())["agent-notifier"]["Stop"][0]["command"]
                env = {**os.environ,
                       "AGENT_NOTIFIER_WEBHOOK_URL": f"http://127.0.0.1:{server.server_port}",
                       "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"}
                payload = {"fullyIdle": True, "conversationId": "agy-test",
                           "workspacePaths": ["/test/workspace"], "modelName": "test-model"}
                result = subprocess.run(command, shell=True, cwd=root, env=env,
                                        input=json.dumps(payload), text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), {"decision": "allow"})
                notification = received.get(timeout=10)
                self.assertEqual(notification["host"], "Antigravity")
                self.assertEqual(notification["sessionId"], "agy-test")
                self.assertEqual(notification["cwd"], "/test/workspace")
                self.assertEqual(notification["model"], "test-model")
            finally:
                server.shutdown()
                thread.join()

    @unittest.skipUnless(shutil.which("agy"), "agy CLI is not installed")
    def test_native_cli_validates_and_installs_in_isolated_home(self):
        with tempfile.TemporaryDirectory(prefix="agy-plugins-test-") as home:
            env = {**os.environ, "HOME": home, "XDG_CONFIG_HOME": home + "/.config"}
            for name in PLUGINS:
                root = ROOT / "plugins" / name
                for args in (("validate", "--json", str(root)), ("install", str(root))):
                    result = subprocess.run(["agy", "plugin", *args], env=env,
                                            text=True, capture_output=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    if args[0] == "validate":
                        report = json.loads(result.stdout)
                        warnings = [item for item in report.get("findings", [])
                                    if item["severity"] != "note"]
                        expected = ([{"severity": "warning", "file": "hooks/hooks.json",
                                      "message": "never loaded: plugin hooks are read only from hooks.json at the plugin root"}]
                                    if name in ("agent-guard", "agent-notifier") else [])
                        self.assertEqual(warnings, expected)
            result = subprocess.run(["agy", "plugin", "list", "--json"], env=env,
                                    text=True, capture_output=True, check=True)
            installed = {item["name"]: item for item in json.loads(result.stdout)}
            self.assertEqual(set(installed), set(PLUGINS))
            for name in PLUGINS:
                self.assertTrue(installed[name]["enabled"])
                self.assertTrue(installed[name]["path"].startswith(home + "/"))
            self.assertEqual(installed["lark-cli-skills"]["skills"], ["lark"])
            self.assertEqual(installed["obsidian-skills"]["skills"], ["obsidian"])
            for name in ("agent-guard", "agent-notifier"):
                self.assertEqual(installed[name]["hooks"], [name])
