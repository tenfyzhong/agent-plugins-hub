#!/usr/bin/env python3

import argparse
import stat
from pathlib import Path


TEXT_SUFFIXES = {".html", ".json", ".md", ".py", ".txt", ".xml", ".yaml", ".yml"}


def normalize_file(path):
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return

    lines = [line.rstrip(" \t") for line in content.splitlines()]
    normalized = "\n".join(lines).rstrip("\n")
    if normalized:
        normalized += "\n"

    if normalized != content:
        path.write_text(normalized, encoding="utf-8")

    if normalized.startswith("#!"):
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def normalize_skills(skills_directory):
    for path in sorted(skills_directory.rglob("*")):
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            normalize_file(path)


def main():
    parser = argparse.ArgumentParser(
        description="Normalize text and script modes in synchronized skills."
    )
    parser.add_argument("skills_directory", type=Path)
    arguments = parser.parse_args()
    normalize_skills(arguments.skills_directory)


if __name__ == "__main__":
    main()
