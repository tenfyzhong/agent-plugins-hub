import json
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE_FILE = REPOSITORY_ROOT / ".agents" / "plugins" / "marketplace.json"


class MarketplaceLayoutTest(unittest.TestCase):
    def test_marketplace_entries_follow_repo_layout(self):
        marketplace = json.loads(MARKETPLACE_FILE.read_text(encoding="utf-8"))
        plugin_names = [plugin["name"] for plugin in marketplace["plugins"]]

        self.assertEqual(len(plugin_names), len(set(plugin_names)))
        self.assertTrue(marketplace["name"])
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


if __name__ == "__main__":
    unittest.main()
