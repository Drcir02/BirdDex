#!/usr/bin/env bash
# Commits everything locally, writes a zip snapshot to checkpoints/, and pushes to GitHub when a remote exists.
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

# Bring in whatever is on GitHub but not here (for example the Pages workflow, which can only be added in GitHub's web editor)
# by putting our commits on top of it. Then the push below is a plain fast-forward. Done before the zip is named, because
# the rebase gives the commits new hashes.
online=no
has_remote=no
if git remote get-url origin >/dev/null 2>&1; then
  has_remote=yes
  if git fetch -q origin main 2>/dev/null; then
    online=yes
    if ! git merge-base --is-ancestor origin/main HEAD; then
      sync_log="$(mktemp)"
      if git rebase -q origin/main >"$sync_log" 2>&1; then
        echo "put our commits on top of the newer ones from GitHub"
      else
        git rebase --abort 2>/dev/null || true
        echo "GitHub has changes that clash with ours, so nothing is pushed until someone merges them. Last lines:"
        tail -n 3 "$sync_log"
        online=no
      fi
      rm -f "$sync_log"
    fi
  fi
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

# git push, tried up to four times when the network is the problem (not when GitHub refuses the push).
push() {
  local log delay=2 attempt
  log="$(mktemp)"
  for attempt in 1 2 3 4; do
    if git push -u origin "$1" >"$log" 2>&1; then
      rm -f "$log"
      return 0
    fi
    if ! grep -q -i -E "could not resolve|timed out|connection|rpc failed|unexpected disconnect|http 5|remote end hung up" "$log" || [ "$attempt" = 4 ]; then
      break
    fi
    sleep "$delay"
    delay=$((delay * 2))
  done
  echo "push failed (continuing). Last lines:"
  tail -n 3 "$log"
  rm -f "$log"
  return 1
}

# The GitHub App that lets Claude push cannot create or change workflow files (.github/workflows), and GitHub rejects a whole
# push if any commit in it touches one. That should not happen (the Pages workflow is kept in deploy/ and added by hand), but if
# a commit does touch one, publish a single snapshot commit on top of GitHub's main instead: our files, with the workflow
# folder exactly as GitHub has it. The detailed history then stays on this machine (and in the zips).
publish_snapshot() {
  local index tree new
  index="$(mktemp -u)"
  GIT_INDEX_FILE="$index" git read-tree HEAD
  GIT_INDEX_FILE="$index" git rm -q -r --cached --ignore-unmatch .github/workflows
  GIT_INDEX_FILE="$index" git read-tree --prefix=.github/workflows/ "origin/main:.github/workflows" 2>/dev/null || true
  tree="$(GIT_INDEX_FILE="$index" git write-tree)"
  rm -f "$index"
  if [ "$tree" = "$(git rev-parse "origin/main^{tree}")" ]; then
    echo "GitHub already has this exact snapshot"
    return 0
  fi
  new="$(git commit-tree "$tree" -p origin/main -m "$message" -m "$trailers")"
  if push "${new}:refs/heads/main"; then
    echo "pushed snapshot ${new:0:7} to origin/main (a commit here touches .github/workflows, so the detailed history was not pushed)"
  fi
}

publish() {
  if [ "$(git rev-parse origin/main)" = "$(git rev-parse HEAD)" ]; then
    echo "GitHub already has this commit"
  elif [ -n "$(git log --full-history --name-only --format= origin/main..HEAD -- .github/workflows)" ]; then
    publish_snapshot
  elif push "HEAD:main"; then
    echo "pushed ${hash} to origin/main"
  fi
}

if [ "$has_remote" = no ]; then
  echo "no GitHub remote yet; work is only on this machine and in the zip"
elif [ "$online" = yes ]; then
  publish
else
  echo "could not reach GitHub or merge with it (continuing); work is saved here and in the zip"
fi
