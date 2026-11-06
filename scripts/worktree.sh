#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Worktrees for concurrent sprints (implementation plan §1.1, §4).
#
#   scripts/worktree.sh start sprint/NN-name    branch from master into ../bogey-worktrees/
#   scripts/worktree.sh finish sprint/NN-name   remove the worktree (the branch is kept)
#   scripts/worktree.sh list
#
# Each worktree gets its own node_modules and its own ports (scripts/ports.mjs).
set -euo pipefail

main="$(git rev-parse --path-format=absolute --git-common-dir)"
main="$(dirname "$main")"
root="$(dirname "$main")/bogey-worktrees"
command="${1:-}"
branch="${2:-}"
path="$root/${branch//\//-}"

case "$command" in
  start)
    [[ -n "$branch" ]] || { echo "usage: $0 start <branch>" >&2; exit 2; }
    mkdir -p "$root"
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$main" worktree add "$path" "$branch"
    else
      git -C "$main" worktree add -b "$branch" "$path" master
    fi
    (cd "$path" && pnpm install --frozen-lockfile)
    base="$(cd "$path" && node -e "import('./scripts/ports.mjs').then(m => console.log(JSON.stringify(m.ports())))")"
    echo "Worktree ready: $path"
    echo "Ports: $base"
    echo "Start a Claude Code session there: cd \"$path\" && claude"
    ;;
  finish)
    [[ -n "$branch" ]] || { echo "usage: $0 finish <branch>" >&2; exit 2; }
    git -C "$main" worktree remove "$path"
    echo "Removed $path (branch $branch kept)."
    ;;
  list)
    git -C "$main" worktree list
    ;;
  *)
    echo "usage: $0 start|finish <branch> | list" >&2
    exit 2
    ;;
esac
