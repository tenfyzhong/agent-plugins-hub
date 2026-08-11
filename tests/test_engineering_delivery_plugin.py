import json
import os
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = REPOSITORY_ROOT / "plugins" / "engineering-delivery"
INSTALL_SCRIPT = PLUGIN_ROOT / "scripts" / "install-agents.sh"
UNINSTALL_SCRIPT = PLUGIN_ROOT / "scripts" / "uninstall-agents.sh"
GENERATOR_SCRIPT = PLUGIN_ROOT / "scripts" / "generate-agents.py"
DEFINITIONS_FILE = PLUGIN_ROOT / "agent-templates" / "agents.json"
PLATFORM_TEMPLATE_ROOT = PLUGIN_ROOT / "agent-templates" / "templates"
RAW_SCRIPT_BASE = (
    "https://raw.githubusercontent.com/tenfyzhong/agent-plugins-hub/"
    "main/plugins/engineering-delivery/scripts"
)
EXPECTED_AGENTS = {
    "ed-backend-explorer",
    "ed-debugger",
    "ed-docs",
    "ed-frontend-explorer",
    "ed-implementer",
    "ed-main",
    "ed-planner",
    "ed-requirements",
    "ed-reviewer",
    "ed-tester",
}
PLATFORMS = {
    "codex": ("*.toml", Path(".codex/agents")),
    "claude": ("*.md", Path(".claude/agents")),
    "pi": ("*.md", Path(".pi/agent/agents")),
    "omp": ("*.md", Path(".omp/agent/agents")),
}


class EngineeringDeliveryPluginLayoutTest(unittest.TestCase):
    def test_plugin_exposes_skill_and_single_source_agent_definitions(self):
        codex_manifest = json.loads(
            (PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(
                encoding="utf-8"
            )
        )
        claude_manifest = json.loads(
            (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(codex_manifest["name"], "engineering-delivery")
        self.assertEqual(claude_manifest["name"], "engineering-delivery")
        self.assertEqual(codex_manifest["skills"], "./skills/")
        self.assertEqual(claude_manifest["skills"], "./skills/")
        self.assertTrue(
            (PLUGIN_ROOT / "skills" / "engineering-delivery" / "SKILL.md").is_file()
        )
        self.assertEqual(list((PLUGIN_ROOT / "agents").rglob("*.md")), [])
        self.assertTrue(GENERATOR_SCRIPT.is_file())

        definitions = json.loads(DEFINITIONS_FILE.read_text(encoding="utf-8"))
        self.assertEqual(definitions["schema_version"], 1)
        self.assertEqual(
            {agent["name"] for agent in definitions["agents"]}, EXPECTED_AGENTS
        )
        for agent in definitions["agents"]:
            with self.subTest(agent=agent["name"]):
                self.assertIsInstance(agent["prompt"], str)
                self.assertTrue(
                    all(
                        "prompt" not in config
                        for config in agent["platforms"].values()
                    )
                )
        self.assertEqual(
            {path.name for path in PLATFORM_TEMPLATE_ROOT.glob("*.tmpl")},
            {
                "claude.md.tmpl",
                "codex.toml.tmpl",
                "omp.md.tmpl",
                "pi.md.tmpl",
            },
        )

        for platform in PLATFORMS:
            with self.subTest(platform=platform):
                self.assertFalse(
                    (PLUGIN_ROOT / "agent-templates" / platform).exists()
                )

    def test_generator_creates_all_native_agents(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory) / "generated"
            subprocess.run(
                [
                    "python3",
                    str(GENERATOR_SCRIPT),
                    "--definitions",
                    str(DEFINITIONS_FILE),
                    "--templates",
                    str(PLATFORM_TEMPLATE_ROOT),
                    "--output",
                    str(output_root),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            for platform, (pattern, _) in PLATFORMS.items():
                with self.subTest(platform=platform):
                    generated = (output_root / platform).glob(pattern)
                    self.assertEqual(
                        {path.stem for path in generated}, EXPECTED_AGENTS
                    )

            planner = (output_root / "codex" / "ed-planner.toml").read_text(
                encoding="utf-8"
            )

            for generated_codex_agent in (output_root / "codex").glob("*.toml"):
                with self.subTest(codex_agent=generated_codex_agent.stem):
                    tomllib.loads(
                        generated_codex_agent.read_text(encoding="utf-8")
                    )

            self.assertIn('model = "gpt-5.6-sol"', planner)
            self.assertIn('model_reasoning_effort = "xhigh"', planner)

    def test_readme_documents_curl_install_and_uninstall(self):
        readme = (PLUGIN_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn(
            f"curl -fsSL {RAW_SCRIPT_BASE}/install-agents.sh | bash",
            readme,
        )
        self.assertIn(
            f"curl -fsSL {RAW_SCRIPT_BASE}/uninstall-agents.sh | bash",
            readme,
        )


class EngineeringDeliveryAgentScriptsTest(unittest.TestCase):
    def run_script(self, script, agent_home, state_home, *arguments):
        environment = os.environ.copy()
        environment["ENGINEERING_DELIVERY_HOME"] = str(agent_home)
        environment["XDG_STATE_HOME"] = str(state_home)
        return subprocess.run(
            ["bash", str(script), *arguments],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )

    def run_script_from_stdin(
        self, script, agent_home, state_home, *arguments
    ):
        environment = os.environ.copy()
        environment["ENGINEERING_DELIVERY_HOME"] = str(agent_home)
        environment["ENGINEERING_DELIVERY_SOURCE_BASE_URL"] = PLUGIN_ROOT.as_uri()
        environment["XDG_STATE_HOME"] = str(state_home)
        return subprocess.run(
            ["bash", "-s", "--", *arguments],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            input=script.read_text(encoding="utf-8"),
            text=True,
        )

    def test_install_preserves_customizations_and_uninstall_backs_them_up(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            agent_home = temporary_root / "agent-home"
            state_home = temporary_root / "state"

            self.run_script(INSTALL_SCRIPT, agent_home, state_home)

            for platform, (pattern, relative_target) in PLATFORMS.items():
                with self.subTest(platform=platform):
                    installed = (agent_home / relative_target).glob(pattern)
                    self.assertEqual(
                        {path.stem for path in installed}, EXPECTED_AGENTS
                    )

            customized = agent_home / ".codex/agents/ed-planner.toml"
            customized.write_text(
                customized.read_text(encoding="utf-8") + "# customized\n",
                encoding="utf-8",
            )

            reinstall = self.run_script(
                INSTALL_SCRIPT, agent_home, state_home
            )
            self.assertIn("preserved customized", reinstall.stdout)
            self.assertTrue(
                customized.read_text(encoding="utf-8").endswith("# customized\n")
            )

            uninstall = self.run_script(
                UNINSTALL_SCRIPT, agent_home, state_home
            )
            self.assertIn("backed up customized", uninstall.stdout)

            for _, (pattern, relative_target) in PLATFORMS.items():
                self.assertEqual(list((agent_home / relative_target).glob(pattern)), [])

            backups = list(
                (state_home / "engineering-delivery" / "backups").rglob(
                    "ed-planner.toml"
                )
            )
            self.assertEqual(len(backups), 1)
            self.assertTrue(
                backups[0].read_text(encoding="utf-8").endswith("# customized\n")
            )

    def test_install_and_uninstall_run_from_stdin_without_local_context(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            agent_home = temporary_root / "agent-home"
            state_home = temporary_root / "state"

            self.run_script_from_stdin(
                INSTALL_SCRIPT, agent_home, state_home
            )

            for platform, (pattern, relative_target) in PLATFORMS.items():
                with self.subTest(platform=platform):
                    installed = (agent_home / relative_target).glob(pattern)
                    self.assertEqual(
                        {path.stem for path in installed}, EXPECTED_AGENTS
                    )

            self.run_script_from_stdin(
                UNINSTALL_SCRIPT, agent_home, state_home
            )

            for _, (pattern, relative_target) in PLATFORMS.items():
                self.assertEqual(list((agent_home / relative_target).glob(pattern)), [])


if __name__ == "__main__":
    unittest.main()
