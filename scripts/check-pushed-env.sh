#!/usr/bin/env bash
# Rejects a push when any outgoing commit contains a .env file (except .env.example).
# Git feeds the pre-push hook one line per ref: <local ref> <local sha> <remote ref> <remote sha>.
# Checking every outgoing commit, not only the index, also stops a .env that was committed
# and then untracked: the history would still publish it.
set -euo pipefail

zero='0000000000000000000000000000000000000000'
found=0

while read -r _local_ref local_sha _remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue
  if [ "$remote_sha" = "$zero" ]; then
    range=("$local_sha" --not --remotes)
  else
    range=("$remote_sha..$local_sha")
  fi
  while read -r commit; do
    hits=$(git ls-tree -r --name-only "$commit" |
      grep -E '(^|/)\.env(\.[^/]*)?$' | grep -vE '(^|/)\.env\.example$' || true)
    if [ -n "$hits" ]; then
      echo "push rejected: commit $commit contains: $hits" >&2
      found=1
    fi
  done < <(git rev-list "${range[@]}")
done

if [ "$found" -ne 0 ]; then
  echo "Remove the file from those commits (rewrite the unpushed history) before pushing." >&2
  exit 1
fi
