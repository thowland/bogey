#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Closes a sprint (implementation plan §1.5):
#
#   scripts/close-sprint.sh <branch> <message-file>
#
#   1. Take the merge lock, so concurrent sessions merge one at a time.
#   2. In the branch's checkout: merge master in and run the gate on the combined code.
#   3. In the main checkout: --no-ff merge into master with the message file plus the coverage
#      figures, run the gate again, and undo the merge if it fails.
#   4. Tag sprint-NN (sprint branches only) and deploy master (NO_DEPLOY=1 skips).
#
# The message file holds the merge subject and summary; the coverage line is appended.
set -euo pipefail

branch="${1:-}"
message="${2:-}"
[[ -n "$branch" && -f "$message" ]] || { echo "usage: $0 <branch> <message-file>" >&2; exit 2; }
message="$(cd "$(dirname "$message")" && pwd)/$(basename "$message")"

common="$(git rev-parse --path-format=absolute --git-common-dir)"
main="$(dirname "$common")"
lock="$common/bogey-merge.lock"

# The checkout that has the branch: a worktree, or the main checkout itself (Sprint 0).
work="$(git -C "$main" worktree list --porcelain | awk -v b="refs/heads/$branch" '
  /^worktree / { path = substr($0, 10) } $0 == "branch " b { print path }')"
[[ -n "$work" ]] || { echo "ERROR: $branch is not checked out anywhere." >&2; exit 1; }

until mkdir "$lock" 2>/dev/null; do
  echo "Waiting for the merge lock ($(cat "$lock/owner" 2>/dev/null || echo unknown))..."
  sleep 20
done
echo "$branch $$" > "$lock/owner"
trap 'rm -rf "$lock"' EXIT

clean() { [[ -z "$(git -C "$1" status --porcelain)" ]]; }
clean "$work" || { echo "ERROR: uncommitted changes in $work." >&2; exit 1; }

echo "== Merging master into $branch and running the gate"
if ! git -C "$work" merge master --no-edit; then
  git -C "$work" merge --abort || true
  echo "ERROR: master does not merge cleanly into $branch. Resolve on the branch, then rerun." >&2
  exit 1
fi
(cd "$work" && pnpm gate)

coverage="$(cd "$work" && node -e "
  const t = require('./coverage/coverage-summary.json').total;
  console.log('Coverage: L ' + t.lines.pct + '% / S ' + t.statements.pct + '% / F ' + t.functions.pct + '% / B ' + t.branches.pct + '%');
")"

echo "== Merging $branch into master"
if [[ "$work" == "$main" ]]; then
  git -C "$main" checkout master
fi
clean "$main" || { echo "ERROR: uncommitted changes in $main." >&2; exit 1; }
[[ "$(git -C "$main" rev-parse --abbrev-ref HEAD)" == "master" ]] ||
  { echo "ERROR: $main is not on master." >&2; exit 1; }
{ cat "$message"; printf '\n%s\n' "$coverage"; } > "$common/bogey-merge-message"
git -C "$main" merge --no-ff "$branch" -F "$common/bogey-merge-message"
rm -f "$common/bogey-merge-message"

if ! (cd "$main" && pnpm install --frozen-lockfile && pnpm gate); then
  echo "ERROR: the gate failed on master after the merge; undoing it." >&2
  git -C "$main" reset --hard ORIG_HEAD
  exit 1
fi

if [[ "$branch" =~ ^sprint/([0-9]+)- ]]; then
  git -C "$main" tag "sprint-${BASH_REMATCH[1]}"
fi

if [[ "${NO_DEPLOY:-0}" != "1" ]]; then
  (cd "$main" && SKIP_VERIFY=1 pnpm deploy:site)
fi
echo "Closed $branch. $coverage"
