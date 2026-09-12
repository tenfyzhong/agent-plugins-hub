import copy
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "omp-conventions"
ENTRY = PLUGIN / "extensions" / "omp-conventions.ts"
RUNNER = """
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { default: register } = await import(pathToFileURL(process.argv[1]));
const handlers = new Map();
register({ on(event, handler) { handlers.set(event, handler); } });
const payload = JSON.parse(readFileSync(0, "utf8"));
const handler = handlers.get("before_provider_request");
const result = await handler({ type: "before_provider_request", payload });
const first = JSON.stringify(payload);
await handler({ type: "before_provider_request", payload });
console.log(JSON.stringify({
    events: [...handlers.keys()], payload,
    returnedPayload: result === payload,
    unchangedResult: result === undefined,
    idempotent: first === JSON.stringify(payload),
}));
"""


class OmpConventionsTest(unittest.TestCase):
    def run_extension(self, payload):
        completed = subprocess.run(
            ["node", "--input-type=module", "--eval", RUNNER, str(ENTRY)],
            input=json.dumps(payload), text=True, capture_output=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["events"], ["before_provider_request"])
        self.assertTrue(result["idempotent"])
        return result

    def test_renames_both_spellings_in_every_system_part(self):
        payload = {"request": {"systemInstruction": {"parts": [
            {"text": "<system-conventions>Keep all instructions.\n</system-conventions>"},
            {"text": "<system_conventions>Keep these too.</system_conventions>"},
            {"text": "system-conventions and system_conventions references"},
        ]}}}
        result = self.run_extension(payload)
        self.assertTrue(result["returnedPayload"])
        self.assertEqual(result["payload"]["request"]["systemInstruction"]["parts"], [
            {"text": "<conventions>Keep all instructions.\n</conventions>"},
            {"text": "<conventions>Keep these too.</conventions>"},
            {"text": "conventions and conventions references"},
        ])

    def test_preserves_messages_tools_metadata_and_non_text_parts(self):
        payload = {
            "model": "gemini-3.8-flash-high",
            "request": {
                "systemInstruction": {"role": "system", "parts": [
                    None, {}, {"text": 123}, {"inlineData": {"data": "system_conventions"}},
                    {"text": "<system-conventions>正文</system-conventions>", "extra": True},
                ]},
                "contents": [{"role": "user", "parts": [{"text": "system-conventions"}]}],
                "tools": [{"name": "system_conventions"}],
            },
        }
        expected = copy.deepcopy(payload)
        expected["request"]["systemInstruction"]["parts"][-1]["text"] = (
            "<conventions>正文</conventions>"
        )
        self.assertEqual(self.run_extension(payload)["payload"], expected)

    def test_ignores_missing_or_malformed_system_parts(self):
        for payload in [
            None, [], "system-conventions", {}, {"request": None},
            {"request": {"systemInstruction": None}},
            {"request": {"systemInstruction": {"parts": "system_conventions"}}},
            {"request": {"systemInstruction": {"parts": [None, {}, {"text": False}]}}},
        ]:
            with self.subTest(payload=payload):
                result = self.run_extension(payload)
                self.assertEqual(result["payload"], payload)
                self.assertTrue(result["unchangedResult"])

    def test_does_not_change_other_provider_payloads(self):
        for payload in [
            {"messages": [{"role": "system", "content": "system-conventions"}]},
            {"system": "system_conventions"},
            {"systemInstruction": {"parts": [{"text": "system-conventions"}]}},
        ]:
            with self.subTest(payload=payload):
                self.assertEqual(self.run_extension(payload)["payload"], payload)

    def test_unchanged_system_text_returns_no_override(self):
        payload = {"request": {"systemInstruction": {"parts": [
            {"text": "<conventions>Keep this.</conventions> <system-directive>"},
        ]}}}
        result = self.run_extension(payload)
        self.assertEqual(result["payload"], payload)
        self.assertTrue(result["unchangedResult"])

    def test_package_is_only_registered_for_omp(self):
        package = json.loads((PLUGIN / "package.json").read_text())
        self.assertEqual(package["name"], "omp-conventions")
        self.assertEqual(package["omp"]["extensions"], ["./extensions/omp-conventions.ts"])
        self.assertNotIn("pi", package)
        self.assertTrue(ENTRY.is_file())
        for catalog in [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"]:
            names = [entry["name"] for entry in json.loads((ROOT / catalog).read_text())["plugins"]]
            self.assertNotIn("omp-conventions", names)
        self.assertNotIn("omp-conventions", (ROOT / "package.json").read_text())
        for directory in [".codex-plugin", ".claude-plugin", "hooks"]:
            self.assertFalse((PLUGIN / directory).exists())


if __name__ == "__main__":
    unittest.main()
