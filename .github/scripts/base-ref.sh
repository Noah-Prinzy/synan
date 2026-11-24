#!/usr/bin/env bash
# Prints the commit this run compares with (step output `ref`): the pull request's base, or the
# previous tip of the pushed branch. Empty for a new branch, or when that commit cannot be fetched
# (e.g. after a force-push); the checks then skip their comparison and say so.
set -euo pipefail
base="${BASE_SHA:-}"
if [[ -z "$base" || "$base" =~ ^0+$ ]]; then
  echo "No base commit (new branch or first push): comparisons with the base are skipped."
  echo "ref=" >> "$GITHUB_OUTPUT"
  exit 0
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  git fetch --no-tags --depth=1 origin "$base" || true
fi
if git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Comparing with $base"
  echo "ref=$base" >> "$GITHUB_OUTPUT"
else
  echo "::warning title=comparison base::$base is not reachable; comparisons with the base are skipped."
  echo "ref=" >> "$GITHUB_OUTPUT"
fi
