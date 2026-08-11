#!/usr/bin/env python3

import argparse
import json
import re
from pathlib import Path
from string import Template


PLATFORMS = ("codex", "claude", "pi", "omp")
TEMPLATE_FILES = {
    "codex": "codex.toml.tmpl",
    "claude": "claude.md.tmpl",
    "pi": "pi.md.tmpl",
    "omp": "omp.md.tmpl",
}
EXTENSIONS = {"codex": ".toml", "claude": ".md", "pi": ".md", "omp": ".md"}
AGENT_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Generate native Engineering Delivery agent definitions."
    )
    parser.add_argument("--definitions", required=True, type=Path)
    parser.add_argument("--templates", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--platform", choices=("all", *PLATFORMS), default="all"
    )
    return parser.parse_args()


def load_definitions(definitions_file):
    definitions = json.loads(definitions_file.read_text(encoding="utf-8"))
    if definitions.get("schema_version") != 1:
        raise ValueError("Unsupported agent definition schema version")

    agents = definitions.get("agents")
    if not isinstance(agents, list) or not agents:
        raise ValueError("Agent definitions must contain a non-empty agents list")

    names = []
    for agent in agents:
        name = agent.get("name")
        if not isinstance(name, str) or not AGENT_NAME_PATTERN.fullmatch(name):
            raise ValueError(f"Invalid agent name: {name!r}")
        if not isinstance(agent.get("description"), str):
            raise ValueError(f"Agent {name} is missing a description")
        if not isinstance(agent.get("prompt"), str):
            raise ValueError(f"Agent {name} is missing a prompt")
        if '"""' in agent["prompt"]:
            raise ValueError(f'Agent {name} prompt cannot contain triple quotes')
        if set(agent.get("platforms", {})) != set(PLATFORMS):
            raise ValueError(f"Agent {name} must define all supported platforms")
        names.append(name)

    if len(names) != len(set(names)):
        raise ValueError("Agent names must be unique")
    return agents


def comma_separated(values):
    return ", ".join(values)


def yaml_boolean(value):
    return "true" if value else "false"


def yaml_list(key, values):
    if not values:
        return ""
    lines = [f"{key}:"]
    lines.extend(f"  - {value}" for value in values)
    return "\n".join(lines) + "\n"


def claude_context(agent, config):
    extra_frontmatter = yaml_list("skills", config.get("skills", []))
    return {
        "name": agent["name"],
        "description": agent["description"],
        "model": config["model"],
        "effort": config["effort"],
        "tools": comma_separated(config["tools"]),
        "extra_frontmatter": extra_frontmatter,
        "prompt": agent["prompt"],
    }


def codex_context(agent, config):
    return {
        "name_toml": json.dumps(agent["name"]),
        "description_toml": json.dumps(agent["description"]),
        "model_toml": json.dumps(config["model"]),
        "reasoning_toml": json.dumps(config["reasoning"]),
        "sandbox_mode_toml": json.dumps(config["sandbox_mode"]),
        "prompt": agent["prompt"],
    }


def pi_context(agent, config):
    extras = []
    if "acceptance_role" in config:
        extras.append(f"acceptanceRole: {config['acceptance_role']}")
    if config.get("skills"):
        extras.append(f"skills: {comma_separated(config['skills'])}")
    if "max_subagent_depth" in config:
        extras.append(f"maxSubagentDepth: {config['max_subagent_depth']}")
    extra_frontmatter = "\n".join(extras)
    if extra_frontmatter:
        extra_frontmatter += "\n"

    return {
        "name": agent["name"],
        "description": agent["description"],
        "model": config["model"],
        "thinking": config["thinking"],
        "tools": comma_separated(config["tools"]),
        "system_prompt_mode": config["system_prompt_mode"],
        "inherit_project_context": yaml_boolean(config["inherit_project_context"]),
        "inherit_skills": yaml_boolean(config["inherit_skills"]),
        "extra_frontmatter": extra_frontmatter,
        "prompt": agent["prompt"],
    }


def omp_context(agent, config):
    extras = []
    if "read_summarize" in config:
        extras.append(f"read-summarize: {yaml_boolean(config['read_summarize'])}")
    if config.get("spawns"):
        extras.append(yaml_list("spawns", config["spawns"]).rstrip())
    if config.get("autoload_skills"):
        extras.append(
            yaml_list("autoloadSkills", config["autoload_skills"]).rstrip()
        )
    extra_frontmatter = "\n".join(extras)
    if extra_frontmatter:
        extra_frontmatter += "\n"

    return {
        "name": agent["name"],
        "description": agent["description"],
        "model": config["model"],
        "thinking_level": config["thinking_level"],
        "tools": comma_separated(config["tools"]),
        "extra_frontmatter": extra_frontmatter,
        "prompt": agent["prompt"],
    }


CONTEXT_BUILDERS = {
    "codex": codex_context,
    "claude": claude_context,
    "pi": pi_context,
    "omp": omp_context,
}


def generate(agents, template_root, output_root, platforms):
    templates = {
        platform: Template(
            (template_root / TEMPLATE_FILES[platform]).read_text(encoding="utf-8")
        )
        for platform in platforms
    }

    generated_count = 0
    for platform in platforms:
        platform_output = output_root / platform
        platform_output.mkdir(parents=True, exist_ok=True)
        for agent in agents:
            context = CONTEXT_BUILDERS[platform](
                agent, agent["platforms"][platform]
            )
            rendered = templates[platform].substitute(context).rstrip() + "\n"
            output_file = platform_output / (
                agent["name"] + EXTENSIONS[platform]
            )
            output_file.write_text(rendered, encoding="utf-8")
            generated_count += 1
    return generated_count


def main():
    arguments = parse_arguments()
    agents = load_definitions(arguments.definitions)
    platforms = (
        PLATFORMS if arguments.platform == "all" else (arguments.platform,)
    )
    count = generate(
        agents, arguments.templates, arguments.output, platforms
    )
    print(f"Generated {count} agent definitions in {arguments.output}")


if __name__ == "__main__":
    main()
