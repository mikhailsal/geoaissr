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
  # A remote tip missing locally (the branch moved since the last fetch) makes the range
  # unreadable; refuse the push rather than check nothing.
  if ! commits=$(git rev-list "${range[@]}"); then
    echo "push rejected: cannot list the outgoing commits of $local_sha; run git fetch and retry" >&2
    exit 1
  fi
  for commit in $commits; do
    # NUL-separated names: Git quotes non-ASCII paths in line output.
    hits=$(git ls-tree -r -z --name-only "$commit" |
      grep -zE '(^|/)\.env(\.[^/]*)?$' | grep -zvE '(^|/)\.env\.example$' | tr '\0' ' ' || true)
    if [ -n "$hits" ]; then
      echo "push rejected: commit $commit contains: ${hits% }" >&2
      found=1
    fi
  done
done

if [ "$found" -ne 0 ]; then
  echo "Remove the file from those commits (rewrite the unpushed history) before pushing." >&2
  exit 1
fi
