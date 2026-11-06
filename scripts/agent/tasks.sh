#!/usr/bin/env bash
# Coordination helper for the two Kosha build agents (see docs/agents/PROTOCOL.md).
#
# Task IDs look like A07 or B12. A task's branch is <agent>/<nn>-<slug>, e.g. a/07-registry; a
# batch of tasks lists them all, joined with +, e.g. a/10+11-settle-seed (PROTOCOL §6).
# A task counts as done only when a PR from a branch that lists it is merged into main.
# A cross-agent request is a GitHub issue, written as #12; it counts as done once it is closed.
#
#   scripts/agent/tasks.sh check A02 B00 #12   exit 0 only if every listed item is done
#   scripts/agent/tasks.sh wait  A02 #12       poll until `check` passes, then fetch origin (run in the background)
#   scripts/agent/tasks.sh status              list every agent PR with its state and base branch
set -euo pipefail

branch_pattern() { # A07 -> a jq regex matching a/07-…, a/06+07-… and a/07+08-…
  if [[ "$1" =~ ^#[0-9]+$ ]]; then return 0; fi
  if [[ ! "$1" =~ ^([ABab])([0-9][0-9])$ ]]; then
    echo "bad task id: $1 (expected something like A07 or B12)" >&2
    exit 2
  fi
  printf '^%s/([0-9]{2}\\\\+)*%s(\\\\+[0-9]{2})*-' \
    "$(tr 'AB' 'ab' <<<"${BASH_REMATCH[1]}")" "${BASH_REMATCH[2]}"
}

is_merged() {
  local pattern count
  if [[ "$1" =~ ^#([0-9]+)$ ]]; then
    [[ "$(gh issue view "${BASH_REMATCH[1]}" --json state --jq .state)" == "CLOSED" ]]
    return
  fi
  pattern=$(branch_pattern "$1")
  count=$(gh pr list --state merged --base main --limit 300 --json headRefName \
    --jq "[.[] | select(.headRefName | test(\"$pattern\"))] | length")
  [[ "$count" -gt 0 ]]
}

cmd_check() {
  local missing=() id
  for id in "$@"; do branch_pattern "$id" >/dev/null; done # validate before polling
  for id in "$@"; do
    is_merged "$id" || missing+=("$id")
  done
  if ((${#missing[@]} > 0)); then
    echo "waiting on: ${missing[*]}"
    return 1
  fi
  echo "merged into main: $*"
}

cmd_wait() {
  until cmd_check "$@"; do
    sleep "${POLL_SECONDS:-60}"
  done
  git fetch --quiet origin
}

cmd_status() {
  gh pr list --state all --limit 300 \
    --json number,state,isDraft,headRefName,baseRefName,title \
    --jq '.[] | select(.headRefName | test("^[ab]/([0-9]{2}(\\+[0-9]{2})*|r[0-9]+)-"))
          | [.headRefName, (if .isDraft then "DRAFT" else .state end),
             ("#" + (.number | tostring)), ("base:" + .baseRefName), .title] | @tsv' |
    sort
}

case "${1:-}" in
  check) shift; [[ $# -gt 0 ]] || { echo "usage: $0 check <TASK_ID>..." >&2; exit 2; }; cmd_check "$@" ;;
  wait) shift; [[ $# -gt 0 ]] || { echo "usage: $0 wait <TASK_ID>..." >&2; exit 2; }; cmd_wait "$@" ;;
  status) cmd_status ;;
  *) echo "usage: $0 {check|wait|status} [TASK_ID...]" >&2; exit 2 ;;
esac
