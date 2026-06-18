#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(cd "${script_dir}/.." && pwd)"
skill_dir="${plugin_root}/skills/dbcli"
skill_file="${skill_dir}/SKILL.md"
reference_file="${skill_dir}/reference.md"

usage() {
  cat <<'EOF'
Usage:
  install-skills.sh [all|codex|claude|copilot|antigravity|agy|cursor]

Installs the bundled dbcli skill files into agent-specific locations:
  codex        ~/.codex/skills/dbcli/
  claude       ~/.claude/skills/dbcli/
  copilot      ./.github/skills/dbcli/
  antigravity  ~/.gemini/antigravity-cli/skills/dbcli/
  cursor       ./.cursor/rules/dbcli.mdc + ./.cursor/skills/dbcli/reference.md

Default: all
EOF
}

copy_pair() {
  local target_dir="$1"
  mkdir -p "${target_dir}"
  cp "${skill_file}" "${target_dir}/SKILL.md"
  cp "${reference_file}" "${target_dir}/reference.md"
  printf 'installed %s\n' "${target_dir}"
}

install_cursor() {
  mkdir -p ".cursor/rules" ".cursor/skills/dbcli"
  cp "${skill_file}" ".cursor/rules/dbcli.mdc"
  cp "${reference_file}" ".cursor/skills/dbcli/reference.md"
  printf 'installed %s\n' ".cursor/rules/dbcli.mdc"
  printf 'installed %s\n' ".cursor/skills/dbcli/reference.md"
}

install_platform() {
  local platform="$1"
  case "${platform}" in
    codex)
      copy_pair "${HOME}/.codex/skills/dbcli"
      ;;
    claude)
      copy_pair "${HOME}/.claude/skills/dbcli"
      ;;
    copilot)
      copy_pair ".github/skills/dbcli"
      ;;
    antigravity|agy)
      copy_pair "${HOME}/.gemini/antigravity-cli/skills/dbcli"
      ;;
    cursor)
      install_cursor
      ;;
    all)
      install_platform codex
      install_platform claude
      install_platform copilot
      install_platform antigravity
      install_platform cursor
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      printf 'Unknown platform: %s\n\n' "${platform}" >&2
      usage >&2
      exit 2
      ;;
  esac
}

if [[ ! -f "${skill_file}" || ! -f "${reference_file}" ]]; then
  printf 'Missing bundled skill files under %s\n' "${skill_dir}" >&2
  exit 1
fi

install_platform "${1:-all}"
