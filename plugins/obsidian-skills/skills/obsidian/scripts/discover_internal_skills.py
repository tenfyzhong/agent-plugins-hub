#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


DEFAULT_SKILLS_DIRECTORY = Path(__file__).resolve().parents[3] / "internal-skills"


def decode_inline_scalar(value):
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def parse_frontmatter(skill_file):
    lines = skill_file.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        raise ValueError(f"Missing YAML frontmatter: {skill_file}")

    try:
        frontmatter_end = lines.index("---", 1)
    except ValueError as error:
        raise ValueError(f"Unterminated YAML frontmatter: {skill_file}") from error

    fields = {}
    for line in lines[1:frontmatter_end]:
        if not line or line[0].isspace() or ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        if key in {"name", "description"}:
            fields[key] = decode_inline_scalar(raw_value)

    missing_fields = {"name", "description"} - fields.keys()
    if missing_fields:
        missing = ", ".join(sorted(missing_fields))
        raise ValueError(f"Missing {missing} in {skill_file}")
    return fields


def discover_skills(skills_directory):
    catalog = []
    for skill_file in sorted(skills_directory.glob("*/SKILL.md")):
        fields = parse_frontmatter(skill_file)
        catalog.append(
            {
                "name": fields["name"],
                "description": fields["description"],
                "path": str(skill_file.resolve()),
            }
        )
    if not catalog:
        raise ValueError(f"No internal skills found in {skills_directory}")
    return catalog


def main():
    parser = argparse.ArgumentParser(
        description="List bundled Obsidian skill metadata for on-demand routing."
    )
    parser.add_argument(
        "skills_directory",
        nargs="?",
        type=Path,
        default=DEFAULT_SKILLS_DIRECTORY,
    )
    arguments = parser.parse_args()
    print(json.dumps(discover_skills(arguments.skills_directory), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
