import json
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE_FILE = REPOSITORY_ROOT / ".agents" / "plugins" / "marketplace.json"
CLAUDE_MARKETPLACE_FILE = REPOSITORY_ROOT / ".claude-plugin" / "marketplace.json"
MARKETPLACE_NAME = "tenfyzhong-agent-plugins-hub"
REPOSITORY_NAME = "agent-plugins-hub"
REPOSITORY_URL = "https://github.com/tenfyzhong/agent-plugins-hub"
GITHUB_USER = "tenfyzhong"


class MarketplaceLayoutTest(unittest.TestCase):
    def test_marketplace_entries_follow_repo_layout(self):
        marketplace = json.loads(MARKETPLACE_FILE.read_text(encoding="utf-8"))
        plugin_names = [plugin["name"] for plugin in marketplace["plugins"]]

        self.assertEqual(len(plugin_names), len(set(plugin_names)))
        self.assertEqual(marketplace["name"], MARKETPLACE_NAME)
        self.assertTrue(marketplace["interface"]["displayName"])

        for plugin in marketplace["plugins"]:
            with self.subTest(plugin=plugin["name"]):
                source = plugin["source"]
                expected_path = f"./plugins/{plugin['name']}"

                self.assertEqual(source, {"source": "local", "path": expected_path})
                self.assertIn(
                    plugin["policy"]["installation"],
                    {"AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"},
                )
                self.assertIn(
                    plugin["policy"]["authentication"], {"ON_INSTALL", "ON_USE"}
                )
                self.assertTrue(plugin["category"])

                plugin_root = REPOSITORY_ROOT / source["path"].removeprefix("./")
                manifest_file = plugin_root / ".codex-plugin" / "plugin.json"
                manifest = json.loads(manifest_file.read_text(encoding="utf-8"))

                self.assertEqual(plugin_root.name, plugin["name"])
                self.assertEqual(manifest["name"], plugin["name"])
                if "skills" in manifest:
                    skills_path = manifest["skills"]
                    self.assertTrue(skills_path.startswith("./"))
                    self.assertTrue(
                        (plugin_root / skills_path.removeprefix("./")).is_dir()
                    )

    def test_repository_identity_is_consistent(self):
        marketplace = json.loads(MARKETPLACE_FILE.read_text(encoding="utf-8"))
        package = json.loads(
            (REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8")
        )
        readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertEqual(marketplace["interface"]["displayName"], "Agent Plugins Hub")
        self.assertEqual(package["name"], REPOSITORY_NAME)
        self.assertIn("# Agent Plugins Hub", readme)
        self.assertIn(f"tenfyzhong/{REPOSITORY_NAME}", readme)

        for plugin in marketplace["plugins"]:
            for agent_directory in (".codex-plugin", ".claude-plugin"):
                manifest_file = (
                    REPOSITORY_ROOT
                    / "plugins"
                    / plugin["name"]
                    / agent_directory
                    / "plugin.json"
                )
                with self.subTest(manifest=manifest_file):
                    manifest = json.loads(
                        manifest_file.read_text(encoding="utf-8")
                    )

                    self.assertEqual(manifest["author"]["name"], GITHUB_USER)
                    self.assertEqual(manifest["repository"], REPOSITORY_URL)

        for extension in package["pi"].get("extensions", []):
            with self.subTest(extension=extension):
                self.assertTrue(extension.startswith("./"))
                self.assertTrue(
                    (REPOSITORY_ROOT / extension.removeprefix("./")).is_file()
                )


class ClaudeMarketplaceLayoutTest(unittest.TestCase):
    def test_marketplace_entries_follow_repo_layout(self):
        marketplace = json.loads(
            CLAUDE_MARKETPLACE_FILE.read_text(encoding="utf-8")
        )
        plugin_names = [plugin["name"] for plugin in marketplace["plugins"]]

        self.assertEqual(marketplace["name"], MARKETPLACE_NAME)
        self.assertTrue(marketplace["metadata"]["description"])
        self.assertEqual(marketplace["owner"]["name"], GITHUB_USER)
        self.assertEqual(len(plugin_names), len(set(plugin_names)))

        for plugin in marketplace["plugins"]:
            with self.subTest(plugin=plugin["name"]):
                expected_source = f"./plugins/{plugin['name']}"

                self.assertEqual(plugin["source"], expected_source)

                plugin_root = REPOSITORY_ROOT / expected_source.removeprefix("./")
                claude_manifest_file = (
                    plugin_root / ".claude-plugin" / "plugin.json"
                )
                claude_manifest = json.loads(
                    claude_manifest_file.read_text(encoding="utf-8")
                )
                codex_manifest = json.loads(
                    (
                        plugin_root / ".codex-plugin" / "plugin.json"
                    ).read_text(encoding="utf-8")
                )

                self.assertEqual(plugin_root.name, plugin["name"])
                self.assertEqual(claude_manifest["name"], plugin["name"])
                self.assertEqual(
                    codex_manifest["interface"]["developerName"], GITHUB_USER
                )
                self.assertEqual(
                    claude_manifest["version"], codex_manifest["version"]
                )
                self.assertEqual(
                    claude_manifest.get("skills"), codex_manifest.get("skills")
                )

                skills_path = claude_manifest.get("skills")
                if skills_path:
                    self.assertTrue(skills_path.startswith("./"))
                    self.assertTrue(
                        (plugin_root / skills_path.removeprefix("./")).is_dir()
                    )
                else:
                    self.assertTrue((plugin_root / "hooks" / "hooks.json").is_file())

    def test_lark_router_is_agent_neutral(self):
        router = (
            REPOSITORY_ROOT
            / "plugins"
            / "lark-cli-skills"
            / "skills"
            / "lark"
            / "SKILL.md"
        ).read_text(encoding="utf-8")

        self.assertNotIn("Codex", router)


if __name__ == "__main__":
    unittest.main()
