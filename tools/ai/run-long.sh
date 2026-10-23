#!/usr/bin/env bash
# A long self-play tuning run (for example a night on a Linux server), at low CPU priority.
# Usage, from the repo root:  tools/ai/run-long.sh <report.json> [tune.ts options]
# Starts tune.ts with --out <report.json>. If it stops with an error, it goes on from the last
# saved generation with --resume (up to 5 times). Output goes to <report.json>.log.
set -u
case "$1" in /*) out="$1" ;; *) out="$PWD/$1" ;; esac
shift
cd "$(dirname "$0")/.."
log="$out.log"
for try in 1 2 3 4 5; do
  if [ -f "$out" ]; then
    nice -n 15 node_modules/.bin/tsx ai/tune.ts --resume "$out" "$@" >>"$log" 2>&1 && exit 0
  else
    nice -n 15 node_modules/.bin/tsx ai/tune.ts --out "$out" "$@" >>"$log" 2>&1 && exit 0
  fi
  echo "$(date -u +%FT%TZ) tune.ts stopped (try $try of 5), going on in 30 s" >>"$log"
  sleep 30
done
echo "$(date -u +%FT%TZ) gave up after 5 tries" >>"$log"
exit 1
