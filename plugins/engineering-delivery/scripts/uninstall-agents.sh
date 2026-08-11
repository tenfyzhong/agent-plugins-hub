#!/usr/bin/env bash

set -euo pipefail

agent_home="${ENGINEERING_DELIVERY_HOME:-${HOME:?HOME is not set}}"
state_home="${XDG_STATE_HOME:-${agent_home}/.local/state}"
selected_platform="all"
backup_run="$(date -u +%Y%m%dT%H%M%SZ)-$$"
repository_ref="${ENGINEERING_DELIVERY_REF:-main}"
source_base_url="${ENGINEERING_DELIVERY_SOURCE_BASE_URL:-https://raw.githubusercontent.com/tenfyzhong/agent-plugins-hub/${repository_ref}/plugins/engineering-delivery}"
local_plugin_root=""
work_directory=""
generated_root=""
agent_names=(
    ed-backend-explorer
    ed-debugger
    ed-docs
    ed-frontend-explorer
    ed-implementer
    ed-main
    ed-planner
    ed-requirements
    ed-reviewer
    ed-tester
)
platforms=(codex claude pi omp)

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    candidate_plugin_root="$(cd "${script_directory}/.." && pwd)"
    if [[ -f "${candidate_plugin_root}/agent-templates/agents.json" \
        && -d "${candidate_plugin_root}/agent-templates/templates" \
        && -f "${candidate_plugin_root}/scripts/generate-agents.py" ]]; then
        local_plugin_root="$candidate_plugin_root"
    fi
fi

cleanup_work_directory() {
    if [[ -n "$work_directory" && -d "$work_directory" ]]; then
        find "$work_directory" -type f -delete
        find "$work_directory" -depth -type d -exec rmdir {} \;
    fi
}

trap cleanup_work_directory EXIT

usage() {
    printf '%s\n' \
        "Usage: $0 [--platform codex|claude|pi|omp|all]" \
        "" \
        "Uninstall Engineering Delivery agents." \
        "Customized files are backed up before removal."
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)
            if [[ $# -lt 2 ]]; then
                usage >&2
                exit 2
            fi
            selected_platform="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown argument: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

case "$selected_platform" in
    codex|claude|pi|omp|all)
        ;;
    *)
        printf 'Unsupported platform: %s\n' "$selected_platform" >&2
        usage >&2
        exit 2
        ;;
esac

target_directory() {
    case "$1" in
        codex)
            printf '%s/.codex/agents\n' "$agent_home"
            ;;
        claude)
            printf '%s/.claude/agents\n' "$agent_home"
            ;;
        pi)
            printf '%s/.pi/agent/agents\n' "$agent_home"
            ;;
        omp)
            printf '%s/.omp/agent/agents\n' "$agent_home"
            ;;
    esac
}

agent_filename() {
    local platform="$1"
    local agent_name="$2"
    local extension="md"

    if [[ "$platform" == codex ]]; then
        extension="toml"
    fi
    printf '%s.%s\n' "$agent_name" "$extension"
}

ensure_work_directory() {
    if [[ -z "$work_directory" ]]; then
        work_directory="$(mktemp -d "${TMPDIR:-/tmp}/engineering-delivery.XXXXXX")"
        generated_root="${work_directory}/generated"
    fi
}

download_source() {
    local relative_path="$1"
    local destination_file
    local source_url

    destination_file="${work_directory}/source/${relative_path}"
    source_url="${source_base_url}/${relative_path}"
    mkdir -p "$(dirname "$destination_file")"
    curl --fail --location --silent --show-error \
        --output "$destination_file" "$source_url"
    if [[ ! -s "$destination_file" ]]; then
        printf 'Downloaded source is empty: %s\n' "$source_url" >&2
        exit 1
    fi
}

generate_agents() {
    local definitions_file
    local templates_root
    local generator_file
    local template_name

    command -v python3 >/dev/null 2>&1 || {
        printf 'python3 is required to generate agent configurations.\n' >&2
        exit 1
    }

    ensure_work_directory
    if [[ -n "$local_plugin_root" ]]; then
        definitions_file="${local_plugin_root}/agent-templates/agents.json"
        templates_root="${local_plugin_root}/agent-templates/templates"
        generator_file="${local_plugin_root}/scripts/generate-agents.py"
    else
        download_source "agent-templates/agents.json"
        for template_name in codex.toml claude.md pi.md omp.md; do
            download_source "agent-templates/templates/${template_name}.tmpl"
        done
        download_source "scripts/generate-agents.py"
        definitions_file="${work_directory}/source/agent-templates/agents.json"
        templates_root="${work_directory}/source/agent-templates/templates"
        generator_file="${work_directory}/source/scripts/generate-agents.py"
    fi

    python3 "$generator_file" \
        --definitions "$definitions_file" \
        --templates "$templates_root" \
        --output "$generated_root" \
        --platform "$selected_platform"
}

template_file() {
    local platform="$1"
    local filename="$2"

    printf '%s/%s/%s\n' "$generated_root" "$platform" "$filename"
}

backup_file() {
    local platform="$1"
    local source_file="$2"
    local backup_directory="${state_home}/engineering-delivery/backups/${backup_run}/${platform}/agents"
    local backup_path

    backup_path="${backup_directory}/$(basename "$source_file")"

    mkdir -p "$backup_directory"
    cp -p "$source_file" "$backup_path"
    printf '%s\n' "$backup_path"
}

uninstall_platform() {
    local platform="$1"
    local agent_name
    local filename
    local destination_directory
    local source_file
    local destination_file
    local backup_path

    destination_directory="$(target_directory "$platform")"

    for agent_name in "${agent_names[@]}"; do
        filename="$(agent_filename "$platform" "$agent_name")"
        source_file="$(template_file "$platform" "$filename")"
        destination_file="${destination_directory}/${filename}"
        [[ -e "$destination_file" ]] || continue

        if cmp -s "$source_file" "$destination_file"; then
            rm "$destination_file"
            printf 'removed: %s\n' "$destination_file"
        else
            backup_path="$(backup_file "$platform" "$destination_file")"
            rm "$destination_file"
            printf 'backed up customized: %s -> %s\n' "$destination_file" "$backup_path"
        fi
    done
}

generate_agents

for platform in "${platforms[@]}"; do
    if [[ "$selected_platform" == all || "$selected_platform" == "$platform" ]]; then
        uninstall_platform "$platform"
    fi
done
