import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = REPOSITORY_ROOT / "plugins" / "obsidian-skills"
PLUGIN_MANIFEST = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
REGISTERED_SKILLS_ROOT = PLUGIN_ROOT / "skills"
INTERNAL_SKILLS_ROOT = PLUGIN_ROOT / "internal-skills"
ROUTER_ROOT = REGISTERED_SKILLS_ROOT / "obsidian"
DISCOVERY_SCRIPT = ROUTER_ROOT / "scripts" / "discover_internal_skills.py"


class ObsidianLazyLoadingTest(unittest.TestCase):
    def test_validation_accepts_new_upstream_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / "plugins" / "obsidian-skills"
            shutil.copytree(PLUGIN_ROOT, plugin)
            tests = root / "tests"
            tests.mkdir()
            test_file = tests / Path(__file__).name
            shutil.copy2(__file__, test_file)
            added_skill = plugin / "internal-skills" / "new-upstream-skill"
            added_skill.mkdir()
            (added_skill / "SKILL.md").write_text(
                "---\nname: new-upstream-skill\n"
                "description: A newly synchronized workflow.\n---\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    str(test_file),
                    "ObsidianLazyLoadingTest.test_only_obsidian_router_skill_is_registered",
                    "ObsidianLazyLoadingTest.test_router_discovers_internal_skill_metadata_on_demand",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_only_obsidian_router_skill_is_registered(self):
        manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
        registered_skills = sorted(
            path.parent.name for path in REGISTERED_SKILLS_ROOT.glob("*/SKILL.md")
        )

        self.assertEqual(manifest["skills"], "./skills/")
        self.assertEqual(registered_skills, ["obsidian"])
        self.assertTrue(INTERNAL_SKILLS_ROOT.is_dir())
        self.assertTrue(list(INTERNAL_SKILLS_ROOT.glob("*/SKILL.md")))

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
        self.assertEqual(
            {Path(item["path"]) for item in catalog},
            {path.resolve() for path in internal_skill_files},
        )
        self.assertEqual(len({item["name"] for item in catalog}), len(catalog))
        self.assertTrue(
            all(set(item) == {"name", "description", "path"} for item in catalog)
        )
        self.assertTrue(all(item["name"] for item in catalog))
        self.assertTrue(all(item["description"] for item in catalog))
        self.assertTrue(all(Path(item["path"]).is_file() for item in catalog))

    def test_router_is_agent_neutral_and_mentions_vault_context(self):
        router = (ROUTER_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertNotIn("Codex", router)
        self.assertIn("Obsidian", router)
        self.assertIn("vault", router.lower())
        self.assertIn("current directory", router)
        self.assertIn("agent/", router)


if __name__ == "__main__":
    unittest.main()
