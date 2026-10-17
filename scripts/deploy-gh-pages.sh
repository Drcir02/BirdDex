#!/usr/bin/env bash
# Fallback deploy that needs no GitHub Actions workflow: build here, then publish the finished files
# to the gh-pages branch. In the repo settings choose Pages, Deploy from a branch, gh-pages, / (root).
set -euo pipefail

remote="$(git config --get remote.origin.url)"
repo_name="$(basename -s .git "$remote")"

BASE_PATH="/${repo_name}/" npm run build

site="$(mktemp -d)"
cp -r dist/. "$site"
touch "$site/.nojekyll"

git -C "$site" init -q -b gh-pages
git -C "$site" add -A
git -C "$site" -c user.name="BirdDex deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git -C "$site" push -f "$remote" gh-pages
rm -rf "$site"
echo "Published to the gh-pages branch of ${repo_name}."
