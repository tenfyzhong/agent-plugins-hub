#!/usr/bin/env bash

set -euo pipefail

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$script_directory/.." && pwd)

upstream_repository=${UPSTREAM_REPOSITORY:-https://github.com/larksuite/cli.git}
upstream_ref=${UPSTREAM_REF:-main}
skills_destination=${SKILLS_DESTINATION:-$repository_root/plugins/lark-cli-skills/internal-skills}
revision_file=${UPSTREAM_REVISION_FILE:-$repository_root/plugins/lark-cli-skills/.upstream-revision}
license_destination=${UPSTREAM_LICENSE_DESTINATION:-$repository_root/plugins/lark-cli-skills/LICENSE}

work_directory=$(mktemp -d)
cleanup() {
    find "$work_directory" -mindepth 1 -delete
    rmdir "$work_directory"
}
trap cleanup EXIT

upstream_checkout="$work_directory/lark-cli"
staged_skills="$work_directory/skills"

git clone \
    --depth 1 \
    --filter=blob:none \
    --sparse \
    --single-branch \
    --branch "$upstream_ref" \
    "$upstream_repository" \
    "$upstream_checkout"
git -C "$upstream_checkout" sparse-checkout set skills

upstream_skills="$upstream_checkout/skills"
if ! find "$upstream_skills" -mindepth 2 -name SKILL.md -print -quit | grep -q .; then
    printf 'No skills found in %s at %s\n' "$upstream_repository" "$upstream_ref" >&2
    exit 1
fi

mkdir -p "$staged_skills"
cp -a "$upstream_skills/." "$staged_skills/"
python3 "$script_directory/normalize_skills.py" "$staged_skills"

mkdir -p "$skills_destination"
find "$skills_destination" -mindepth 1 -delete
cp -a "$staged_skills/." "$skills_destination/"

mkdir -p "$(dirname -- "$license_destination")"
cp "$upstream_checkout/LICENSE" "$license_destination"

mkdir -p "$(dirname -- "$revision_file")"
git -C "$upstream_checkout" rev-parse HEAD > "$revision_file"

printf 'Synced Lark CLI skills from %s at %s\n' \
    "$upstream_repository" \
    "$(cat "$revision_file")"
