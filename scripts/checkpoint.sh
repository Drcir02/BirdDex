#!/usr/bin/env bash
# Commits everything locally, writes a zip snapshot to checkpoints/, and publishes a snapshot to GitHub when a remote exists.
# Usage: scripts/checkpoint.sh "Commit message"
set -euo pipefail
cd "$(dirname "$0")/.."

message="${1:-Checkpoint}"
trailers=$'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01GPYicHDWdcQ3XaECHZQndd'

git add -A
if git diff --cached --quiet; then
  echo "nothing new to commit"
else
  git commit -q -m "$message" -m "$trailers"
fi

hash="$(git log -1 --format=%h)"
mkdir -p checkpoints
if [ ! -f "checkpoints/birddex-${hash}.zip" ]; then
  zip -q -r "checkpoints/birddex-${hash}.zip" . \
    -x "node_modules/*" "dist/*" "dist-e2e-*/*" ".venv/*" "public/models/*" "public/vendor/*" \
       "checkpoints/*" ".git/*" "test-results/*" "playwright-report/*"
fi
echo "commit: ${hash}"
echo "zip: checkpoints/birddex-${hash}.zip ($(du -h "checkpoints/birddex-${hash}.zip" | cut -f1))"

# The GitHub App that lets Claude push cannot create or change workflow files (.github/workflows), and GitHub rejects a whole
# push if any commit in it touches one. So we publish one snapshot commit per checkpoint on top of the remote's main, with
# workflow files left out. The detailed commit history stays on this machine (and in the zips).
publish() {
  git fetch -q origin main 2>/dev/null || { echo "could not reach GitHub (continuing)"; return 0; }
  local parent index tree new log
  parent="$(git rev-parse origin/main)"
  index="$(mktemp -u)"
  GIT_INDEX_FILE="$index" git read-tree HEAD
  GIT_INDEX_FILE="$index" git rm -q -r --cached --ignore-unmatch .github/workflows
  tree="$(GIT_INDEX_FILE="$index" git write-tree)"
  rm -f "$index"
  if [ "$tree" = "$(git rev-parse "${parent}^{tree}")" ]; then
    echo "GitHub already has this exact snapshot"
    return 0
  fi
  new="$(git commit-tree "$tree" -p "$parent" -m "$message" -m "$trailers")"
  log="$(mktemp)"
  if git push origin "${new}:refs/heads/main" >"$log" 2>&1; then
    echo "pushed snapshot ${new:0:7} to origin/main"
  else
    echo "push failed (continuing). Last lines:"
    tail -n 3 "$log"
  fi
  rm -f "$log"
}

if git remote get-url origin >/dev/null 2>&1; then
  publish
else
  echo "no GitHub remote yet; work is only on this machine and in the zip"
fi
