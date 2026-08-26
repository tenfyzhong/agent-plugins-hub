import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = REPOSITORY_ROOT / "scripts" / "sync_obsidian_skills.sh"


class SyncObsidianSkillsTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.upstream = self.root / "upstream"
        self.destination = self.root / "plugin" / "internal-skills"
        self.revision_file = self.root / "plugin" / ".upstream-revision"
        self.license_file = self.root / "plugin" / "LICENSE"

        self.run_command("git", "init", "--initial-branch=main", str(self.upstream))
        self.run_git("config", "user.name", "Test User")
        self.run_git("config", "user.email", "test@example.com")
        self.run_git("config", "commit.gpgsign", "false")
        self.run_git("config", "core.hooksPath", ".git/disabled-hooks")

    def run_command(self, *command, env=None):
        return subprocess.run(command, check=True, capture_output=True, env=env, text=True)

    def run_git(self, *arguments):
        return self.run_command("git", "-C", str(self.upstream), *arguments)

    def commit(self, message):
        self.run_git("add", "--all")
        self.run_git("commit", "-m", message)
        return self.run_git("rev-parse", "HEAD").stdout.strip()

    def sync(self):
        environment = os.environ.copy()
        environment.update(
            {
                "UPSTREAM_REPOSITORY": str(self.upstream),
                "UPSTREAM_REF": "main",
                "SKILLS_DESTINATION": str(self.destination),
                "UPSTREAM_REVISION_FILE": str(self.revision_file),
                "UPSTREAM_LICENSE_DESTINATION": str(self.license_file),
            }
        )
        self.run_command("bash", str(SYNC_SCRIPT), env=environment)

    def test_mirrors_upstream_skills_and_records_revision(self):
        alpha = self.upstream / "skills" / "alpha"
        alpha.mkdir(parents=True)
        (alpha / "SKILL.md").write_text("# Alpha  \n", encoding="utf-8")
        (self.upstream / "LICENSE").write_text("Upstream license\n", encoding="utf-8")
        (self.upstream / "README.md").write_text("not a skill\n", encoding="utf-8")
        first_revision = self.commit("Add alpha skill")

        self.sync()

        self.assertEqual(
            (self.destination / "alpha" / "SKILL.md").read_text(encoding="utf-8"),
            "# Alpha\n",
        )
        self.assertFalse((self.destination / "README.md").exists())
        self.assertEqual(self.license_file.read_text(encoding="utf-8"), "Upstream license\n")
        self.assertEqual(self.revision_file.read_text(encoding="utf-8"), first_revision + "\n")

        shutil.rmtree(alpha)
        beta = self.upstream / "skills" / "beta"
        beta.mkdir(parents=True)
        (beta / "SKILL.md").write_text("# Beta\n", encoding="utf-8")
        second_revision = self.commit("Replace alpha with beta")

        self.sync()

        self.assertFalse((self.destination / "alpha").exists())
        self.assertEqual(
            (self.destination / "beta" / "SKILL.md").read_text(encoding="utf-8"),
            "# Beta\n",
        )
        self.assertEqual(self.revision_file.read_text(encoding="utf-8"), second_revision + "\n")


if __name__ == "__main__":
    unittest.main()
