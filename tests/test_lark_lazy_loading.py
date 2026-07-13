import json
import subprocess
import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = REPOSITORY_ROOT / "plugins" / "lark-cli-skills"
PLUGIN_MANIFEST = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
REGISTERED_SKILLS_ROOT = PLUGIN_ROOT / "router-skills"
INTERNAL_SKILLS_ROOT = PLUGIN_ROOT / "skills"
ROUTER_ROOT = REGISTERED_SKILLS_ROOT / "lark"
DISCOVERY_SCRIPT = ROUTER_ROOT / "scripts" / "discover_internal_skills.py"


class LarkLazyLoadingTest(unittest.TestCase):
    def test_only_router_skill_is_registered(self):
        manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
        registered_skills = sorted(
            path.parent.name for path in REGISTERED_SKILLS_ROOT.glob("*/SKILL.md")
        )

        self.assertEqual(manifest["skills"], "./router-skills/")
        self.assertEqual(registered_skills, ["lark"])
        self.assertTrue(INTERNAL_SKILLS_ROOT.is_dir())
        self.assertGreaterEqual(
            len(list(INTERNAL_SKILLS_ROOT.glob("*/SKILL.md"))),
            20,
        )

    def test_router_discovers_internal_skill_metadata_on_demand(self):
        result = subprocess.run(
            [sys.executable, str(DISCOVERY_SCRIPT)],
            check=True,
            capture_output=True,
            text=True,
        )
        catalog = json.loads(result.stdout)
        internal_skill_files = sorted(INTERNAL_SKILLS_ROOT.glob("*/SKILL.md"))

        self.assertEqual(len(catalog), len(internal_skill_files))
        self.assertTrue(
            all(set(item) == {"name", "description", "path"} for item in catalog)
        )
        self.assertTrue(all(item["name"] for item in catalog))
        self.assertTrue(all(item["description"] for item in catalog))
        self.assertTrue(all(Path(item["path"]).is_file() for item in catalog))
        self.assertIn("lark-doc", {item["name"] for item in catalog})


if __name__ == "__main__":
    unittest.main()
